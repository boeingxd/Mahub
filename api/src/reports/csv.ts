// A tiny CSV writer for the section report download.

// Excel only reads UTF-8 correctly if the file starts with this marker
// (a byte-order mark). Without it, Thai names show up as garbage.
const BOM = '﻿';

// A student picks their own Google display name. If a name starts with = + - or @,
// Excel and Google Sheets would run it as a formula when the instructor opens
// the file ("CSV injection"). A leading ' turns it back into plain text.
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: string | number | null): string {
  if (value === null) return '';
  let text = String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  // Quote the cell if it has a comma, a quote or a line break; double any inner quotes.
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const lines = [header, ...rows].map((row) => row.map(cell).join(','));
  return BOM + lines.map((line) => `${line}\r\n`).join('');
}
