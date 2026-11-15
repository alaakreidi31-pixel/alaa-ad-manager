import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

const BOM = String.fromCharCode(0xfeff);

describe('toCsv', () => {
  it('writes a byte-order mark, a header and CRLF rows, values unchanged', () => {
    expect(toCsv(['period', 'spend'], [['2026-10-05', '150.30']])).toBe(
      `${BOM}period,spend\r\n2026-10-05,150.30\r\n`,
    );
  });

  it('quotes commas, quotes and new lines; empty for null', () => {
    expect(toCsv(['a'], [['حملة, "رمضان"'], [null]])).toBe(`${BOM}a\r\n"حملة, ""رمضان"""\r\n\r\n`);
  });

  it('neutralises spreadsheet formulas but keeps negative numbers', () => {
    expect(toCsv(['a'], [['=HYPERLINK("x")'], ['-12.50']])).toBe(
      `${BOM}a\r\n"'=HYPERLINK(""x"")"\r\n-12.50\r\n`,
    );
  });
});
