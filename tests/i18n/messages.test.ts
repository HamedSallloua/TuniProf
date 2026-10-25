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

describe('UI messages', () => {
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
