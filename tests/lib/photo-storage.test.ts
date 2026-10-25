import { crc32 } from 'node:zlib';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PHOTO_MAX_BYTES, processProfilePhoto } from '@/lib/profile/photo';
import { createLocalStorage } from '@/lib/storage/local';
import { isValidStorageKey } from '@/lib/storage/provider';

const jpeg = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#c0392b' } })
    .jpeg()
    .toBuffer();

describe('profile photo processing', () => {
  it('turns any JPEG into a 400 x 400 JPEG', async () => {
    const result = await processProfilePhoto(await jpeg(1200, 800));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const meta = await sharp(result.data).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 400, 400]);
    expect(result.key).toMatch(/^photos\/[0-9a-f-]{36}\.jpg$/);
  });

  it('accepts PNG, with transparency flattened on white', async () => {
    const png = await sharp({
      create: {
        width: 300,
        height: 300,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const result = await processProfilePhoto(png);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { data } = await sharp(result.data)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)].every((v) => v > 240)).toBe(true); // white, not black
  });

  it('removes metadata such as the camera location', async () => {
    const withExif = await sharp({
      create: { width: 500, height: 500, channels: 3, background: '#00f' },
    })
      .jpeg()
      .withExif({
        IFD0: { Copyright: 'secret-copyright', ImageDescription: 'GPS here' },
      })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined(); // the test file does carry metadata
    const result = await processProfilePhoto(withExif);
    if (!result.ok) throw new Error('should be accepted');
    expect((await sharp(result.data).metadata()).exif).toBeUndefined();
    expect(result.data.includes(Buffer.from('secret-copyright'))).toBe(false);
  });

  it('refuses files over 2 MB', async () => {
    const big = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.alloc(PHOTO_MAX_BYTES),
    ]);
    expect(await processProfilePhoto(big)).toEqual({
      ok: false,
      error: 'photoTooLarge',
    });
  });

  it('refuses anything that is not really a JPEG or PNG, whatever its name says', async () => {
    const notImages = [
      Buffer.from('just some text pretending to be a.jpg'),
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
      Buffer.from('GIF89a......'),
      await sharp({
        create: { width: 10, height: 10, channels: 3, background: '#fff' },
      })
        .webp()
        .toBuffer(),
      Buffer.alloc(0),
    ];
    for (const file of notImages) {
      expect(await processProfilePhoto(file)).toEqual({
        ok: false,
        error: 'photoType',
      });
    }
  });

  it('refuses a damaged file that only starts like a JPEG', async () => {
    const broken = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from('garbage'.repeat(50)),
    ]);
    expect(await processProfilePhoto(broken)).toEqual({
      ok: false,
      error: 'photoCorrupt',
    });
  });

  it('refuses an image that claims an enormous size, without decoding it', async () => {
    // A tiny PNG whose header says 100000 x 100000 pixels (a decompression bomb).
    const chunk = (type: string, data: Buffer) => {
      const body = Buffer.concat([Buffer.from(type), data]);
      const length = Buffer.alloc(4);
      length.writeUInt32BE(data.length);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(body));
      return Buffer.concat([length, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(100000, 0);
    ihdr.writeUInt32BE(100000, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // RGB
    const bomb = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk(
        'IDAT',
        Buffer.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01]),
      ),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    const started = Date.now();
    expect(await processProfilePhoto(bomb)).toEqual({
      ok: false,
      error: 'photoCorrupt',
    });
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe('storage keys', () => {
  it.each([
    'photos/3f2504e0-4f89-11d3-9a0c-0305e82c3301.jpg',
    'photos/a.jpg',
    'docs/x/y.png',
  ])('accepts %s', (key) => {
    expect(isValidStorageKey(key)).toBe(true);
  });

  it.each([
    '',
    '../secret',
    'photos/../../secret',
    '/etc/passwd',
    'C:\\Windows\\win.ini',
    'photos\\a.jpg',
    'photos/A.JPG',
    'photos//a.jpg',
    'photos/.hidden',
    'photos/a b.jpg',
    'photos',
  ])('refuses %j', (key) => {
    expect(isValidStorageKey(key)).toBe(false);
  });
});

describe('local storage', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'tuniprof-storage-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('stores, reads, serves a public address, and deletes', async () => {
    const storage = createLocalStorage(dir);
    const key = 'photos/11111111-1111-1111-1111-111111111111.jpg';
    expect(await storage.get(key)).toBeNull();

    await storage.put(key, Buffer.from('hello'), 'image/jpeg');
    const file = await storage.get(key);
    expect(file?.data.toString()).toBe('hello');
    expect(file?.contentType).toBe('image/jpeg');
    expect(storage.publicUrl(key)).toBe(`/media/${key}`);
    expect((await readFile(path.join(dir, key))).toString()).toBe('hello');

    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
    await storage.delete(key); // deleting twice is fine
  });

  it('never touches anything outside its folder', async () => {
    const storage = createLocalStorage(dir);
    for (const key of [
      '../escape.jpg',
      'photos/../../escape.jpg',
      '/abs/path.jpg',
    ]) {
      await expect(
        storage.put(key, Buffer.from('x'), 'image/jpeg'),
      ).rejects.toThrow(/Invalid storage key/);
      await expect(storage.get(key)).rejects.toThrow(/Invalid storage key/);
      await expect(storage.delete(key)).rejects.toThrow(/Invalid storage key/);
    }
  });
});
