/**
 * Minimal CSV reader for files exported from Excel or Google Sheets.
 * - Accepts "," or ";" as separator (French Excel uses ";"), chosen from the first line.
 * - Handles a leading BOM, CRLF line endings, quoted cells and "" inside quotes.
 * - Skips empty lines. Returns rows of raw strings.
 */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, '');
  const firstLine = input.split(/\r?\n/, 1)[0] ?? '';
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
      ? ';'
      : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    if (row.some((value) => value.trim() !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      endCell();
    } else if (char === '\n') {
      endRow();
    } else if (char !== '\r') {
      cell += char;
    }
  }
  if (inQuotes) throw new Error('CSV error: a quoted cell is never closed.');
  if (cell !== '' || row.length > 0) endRow();

  return rows;
}
