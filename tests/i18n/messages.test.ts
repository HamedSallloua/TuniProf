import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar.json';
import fr from '@/messages/fr.json';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') result[path] = value;
    else Object.assign(result, flatten(value, path));
  }
  return result;
}

const frFlat = flatten(fr);
const arFlat = flatten(ar);

/**
 * JSON.parse silently keeps the LAST of two identical keys in the same object, which would
 * hide a whole group of texts. This reads the raw file and reports such keys by their path.
 */
function findDuplicateKeys(source: string): string[] {
  const duplicates: string[] = [];
  const objects: { keys: Set<string>; path: string }[] = [];
  const trail: string[] = []; // keys leading to the object being read
  let lastKey = '';
  let i = 0;

  while (i < source.length) {
    const char = source[i];
    if (char === '"') {
      let text = '';
      i++;
      while (source[i] !== '"') {
        if (source[i] === '\\') i++;
        text += source[i++];
      }
      i++;
      let j = i;
      while (/\s/.test(source[j])) j++;
      if (source[j] === ':' && objects.length > 0) {
        const current = objects[objects.length - 1];
        if (current.keys.has(text)) {
          duplicates.push([current.path, text].filter(Boolean).join('.'));
        }
        current.keys.add(text);
        lastKey = text;
      }
    } else if (char === '{') {
      if (objects.length > 0) trail.push(lastKey);
      objects.push({ keys: new Set(), path: trail.join('.') });
      i++;
    } else if (char === '}') {
      objects.pop();
      if (objects.length > 0) trail.pop();
      i++;
    } else {
      i++;
    }
  }
  return duplicates;
}

describe('UI messages', () => {
  it('has no key written twice in the same group', () => {
    for (const file of ['fr', 'ar']) {
      const source = readFileSync(
        path.join(process.cwd(), 'messages', `${file}.json`),
        'utf8',
      );
      expect(findDuplicateKeys(source), file).toEqual([]);
    }
  });

  it('the duplicate detector itself works', () => {
    expect(findDuplicateKeys('{"a":{"b":1,"b":2},"c":{"b":1}}')).toEqual([
      'a.b',
    ]);
    expect(findDuplicateKeys('{"a":1,"a":2}')).toEqual(['a']);
    expect(findDuplicateKeys('{"a":{"b":1},"c":{"b":2}}')).toEqual([]);
    expect(findDuplicateKeys('{"x":{"y":{"z":1,"z":2}}}')).toEqual(['x.y.z']);
  });

  it('French and Arabic define exactly the same keys', () => {
    expect(Object.keys(arFlat).sort()).toEqual(Object.keys(frFlat).sort());
  });

  it('has no empty string', () => {
    for (const [key, value] of [
      ...Object.entries(frFlat),
      ...Object.entries(arFlat),
    ]) {
      expect(value.trim(), key).not.toBe('');
    }
  });

  it('uses the same placeholders and tags in both languages', () => {
    const placeholders = (text: string) =>
      (text.match(/\{\w+\}|<\/?\w+>/g) ?? []).sort();
    for (const key of Object.keys(frFlat)) {
      expect(placeholders(arFlat[key]), key).toEqual(placeholders(frFlat[key]));
    }
  });

  it('never hard-codes the brand name', () => {
    for (const [key, value] of [
      ...Object.entries(frFlat),
      ...Object.entries(arFlat),
    ]) {
      expect(value, key).not.toMatch(/tuniprof/i);
    }
  });

  it('contains no emoji (project rule)', () => {
    for (const [key, value] of [
      ...Object.entries(frFlat),
      ...Object.entries(arFlat),
    ]) {
      // Emoji_Presentation targets real emoji and lets plain symbols such as the copyright sign through.
      expect(value, key).not.toMatch(/[\p{Emoji_Presentation}️]/u);
    }
  });

  it('Arabic strings are written in Arabic script', () => {
    for (const [key, value] of Object.entries(arFlat)) {
      expect(value, key).toMatch(/\p{Script=Arabic}/u);
    }
  });
});
