import { describe, expect, it } from 'vitest';
import { parseCsv } from '@/lib/csv';

describe('parseCsv', () => {
  it('reads comma separated rows', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('reads semicolon separated rows (French Excel)', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('ignores a BOM, CRLF line endings and empty lines', () => {
    expect(parseCsv('﻿a;b\r\n\r\n1;2\r\n;\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles quotes, separators and doubled quotes inside cells', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
  });

  it('keeps Arabic text and empty cells', () => {
    expect(parseCsv('governorate;name_fr;name_ar\nTunis;Bab Souika;')).toEqual([
      ['governorate', 'name_fr', 'name_ar'],
      ['Tunis', 'Bab Souika', ''],
    ]);
  });

  it('refuses a quoted cell that is never closed', () => {
    expect(() => parseCsv('a,b\n"oops,2')).toThrow(/never closed/);
  });
});
