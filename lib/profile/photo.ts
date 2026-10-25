import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

// Profile photos (spec 4.2): JPG or PNG, up to 2 MB, re-encoded and resized to 400 px.
// Re-encoding means nothing the teacher uploaded is ever served as is: no hidden data,
// no location in the metadata, no file that is not really an image.

export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const PHOTO_SIZE_PX = 400;

// Refuses images with an absurd number of pixels before decoding them (decompression bombs).
const MAX_INPUT_PIXELS = 36_000_000;

export type PhotoError = 'photoTooLarge' | 'photoType' | 'photoCorrupt';

function looksLikeJpeg(data: Buffer): boolean {
  return (
    data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
  );
}

function looksLikePng(data: Buffer): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return data.length > 8 && signature.every((byte, i) => data[i] === byte);
}

/**
 * Checks the bytes (never the file name or the declared type), then returns a 400 x 400
 * JPEG, cropped around the centre, with metadata removed and a white background.
 */
export async function processProfilePhoto(
  input: Buffer,
): Promise<
  { ok: true; data: Buffer; key: string } | { ok: false; error: PhotoError }
> {
  if (input.length > PHOTO_MAX_BYTES)
    return { ok: false, error: 'photoTooLarge' };
  if (!looksLikeJpeg(input) && !looksLikePng(input))
    return { ok: false, error: 'photoType' };

  try {
    const data = await sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: 'error',
    })
      .rotate() // applies the camera's orientation, then drops it
      .flatten({ background: '#ffffff' }) // transparent PNG -> white
      .resize(PHOTO_SIZE_PX, PHOTO_SIZE_PX, {
        fit: 'cover',
        position: 'centre',
      })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return { ok: true, data, key: `photos/${randomUUID()}.jpg` };
  } catch {
    return { ok: false, error: 'photoCorrupt' };
  }
}
