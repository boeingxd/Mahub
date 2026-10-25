// The CSV writer used by the section report download (task P4).
import { describe, expect, it } from 'vitest';
import { toCsv } from '../src/reports/csv.js';

const BOM = '﻿';

describe('toCsv', () => {
  it('starts with a byte-order mark, so Excel reads Thai names as UTF-8', () => {
    expect(toCsv(['a'], [])).toBe(`${BOM}a\r\n`);
    expect(toCsv(['name'], [['สมชาย ใจดี']])).toContain('สมชาย ใจดี');
  });

  it('writes a header row, then one line per row, ending each with CRLF', () => {
    expect(
      toCsv(
        ['student_no', 'rate_pct'],
        [
          ['6722780001', 88.9],
          ['6722780002', 0],
        ],
      ),
    ).toBe(`${BOM}student_no,rate_pct\r\n6722780001,88.9\r\n6722780002,0\r\n`);
  });

  it('leaves a missing value (null) as an empty cell', () => {
    expect(toCsv(['a', 'b'], [[null, 1]])).toBe(`${BOM}a,b\r\n,1\r\n`);
  });

  it('quotes cells with commas, quotes or line breaks, and doubles inner quotes', () => {
    const csv = toCsv(['name'], [['Smith, Jo'], ['say "hi"'], ['two\nlines']]);
    expect(csv).toBe(`${BOM}name\r\n"Smith, Jo"\r\n"say ""hi"""\r\n"two\nlines"\r\n`);
  });

  it('defuses spreadsheet formulas in names (CSV injection)', () => {
    // A student chooses their Google display name. If it starts with = + - or @,
    // Excel would run it as a formula when the instructor opens the file.
    for (const evil of ['=HYPERLINK("http://evil.test")', '+1+1', '-2+3', '@SUM(A1)', '\t=1+1', '\r=1+1']) {
      const csv = toCsv(['name'], [[evil]]);
      const cell = csv.slice(`${BOM}name\r\n`.length);
      expect(cell.startsWith("'") || cell.startsWith(`"'`), evil).toBe(true);
    }
  });

  it('does not touch real numbers, even negative ones', () => {
    expect(toCsv(['n'], [[-5]])).toBe(`${BOM}n\r\n-5\r\n`);
  });
});
