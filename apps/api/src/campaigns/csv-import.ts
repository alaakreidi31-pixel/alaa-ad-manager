// Reading the daily-numbers reports exported from Meta Ads Manager and
// Google Ads (step 4.3, ADR 0018). PURE functions: no database here.
//
// Supported: comma, semicolon or tab separated; quoted values; a UTF-8 BOM;
// title lines before the header (Google); total lines (Google); English or
// Arabic column names. Amounts stay TEXT (ADR 0008): never a float.

export type ImportColumn =
  'date' | 'externalId' | 'spend' | 'impressions' | 'clicks' | 'conversions';

export interface ParsedRow {
  // Line number in the file (1 = first line), shown to the user.
  line: number;
  date: string;
  externalId: string;
  spend: string;
  impressions: bigint;
  clicks: bigint;
  conversions: string;
}

export type RowProblem = 'bad_date' | 'bad_number' | 'missing_campaign_id' | 'duplicate_row';

export interface RowError {
  line: number;
  reason: RowProblem;
  externalId?: string;
}

export interface ParsedFile {
  rows: ParsedRow[];
  errors: RowError[];
}

export class CsvFormatError extends Error {
  constructor(
    readonly reason: 'empty' | 'missing_columns' | 'too_many_rows',
    readonly missing: ImportColumn[] = [],
  ) {
    super(`CSV file: ${reason}${missing.length ? ` (${missing.join(', ')})` : ''}`);
  }
}

export const MAX_IMPORT_ROWS = 2000;

// Known column names, compared in lower case without spaces at the ends.
// "startsWith" names cover "Amount spent (USD)", "Cost (SAR)"...
const NAMES: Record<ImportColumn, { exact: string[]; startsWith: string[] }> = {
  date: {
    exact: ['day', 'date', 'reporting starts', 'اليوم', 'التاريخ', 'يوم', 'بدء التقارير'],
    startsWith: [],
  },
  externalId: {
    exact: ['campaign id', 'campaign_id', 'معرف الحملة', 'معرّف الحملة', 'رقم الحملة'],
    startsWith: [],
  },
  spend: {
    exact: ['cost', 'spend', 'amount spent', 'التكلفة', 'الإنفاق', 'المبلغ الذي تم إنفاقه'],
    startsWith: ['amount spent', 'cost (', 'spend (', 'المبلغ الذي تم إنفاقه', 'التكلفة ('],
  },
  impressions: {
    exact: ['impressions', 'impr.', 'مرات الظهور', 'الظهور', 'مرات الظهور على الشاشة'],
    startsWith: [],
  },
  clicks: {
    exact: ['clicks', 'link clicks', 'clicks (all)', 'النقرات', 'نقرات الرابط', 'النقرات (الكل)'],
    startsWith: [],
  },
  conversions: {
    exact: ['conversions', 'results', 'التحويلات', 'النتائج', 'الإحالات الناجحة'],
    startsWith: [],
  },
};

// Conversions are optional (some reports have none): 0 when absent.
const REQUIRED: ImportColumn[] = ['date', 'externalId', 'spend', 'impressions', 'clicks'];

function columnOf(header: string): ImportColumn | null {
  const name = header.trim().toLowerCase().replace(/\s+/g, ' ');
  for (const [column, { exact, startsWith }] of Object.entries(NAMES) as [
    ImportColumn,
    (typeof NAMES)[ImportColumn],
  ][]) {
    if (exact.includes(name) || startsWith.some((prefix) => name.startsWith(prefix))) {
      return column;
    }
  }
  return null;
}

// Splits CSV text into lines of cells (RFC 4180 quotes, any line ending).
export function splitCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  // The separator used most in the first lines (Google puts a title first).
  const sample = clean.split(/\r?\n/, 15);
  const count = (separator: string) =>
    Math.max(...sample.map((line) => line.split(separator).length));
  const separator = [',', ';', '\t'].reduce((best, candidate) =>
    count(candidate) > count(best) ? candidate : best,
  );
  const lines: string[][] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (quoted) {
      if (char === '"' && clean[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === separator) {
      cells.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && clean[i + 1] === '\n') i += 1;
      cells.push(cell);
      lines.push(cells);
      cells = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell !== '' || cells.length > 0) {
    cells.push(cell);
    lines.push(cells);
  }
  return lines;
}

// "1,234.50", "$1,234.50", "1 234.5", "--" -> "1234.50"-like text, or null.
function cleanNumber(value: string): string | null {
  const text = value.trim().replace(/[\s,$€£¥]|ر\.س|SAR|USD|EUR/gi, '');
  if (text === '' || text === '--' || text === '-') return '0';
  return /^\d+(\.\d+)?$/.test(text) ? text : null;
}

// YYYY-MM-DD or YYYY/MM/DD only: 03/04/2026 could be March or April.
function cleanDate(value: string): string | null {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const date = `${match[1]}-${match[2]?.padStart(2, '0')}-${match[3]?.padStart(2, '0')}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date) ? date : null;
}

export function parseCampaignCsv(text: string): ParsedFile {
  const lines = splitCsv(text);
  if (lines.length === 0) throw new CsvFormatError('empty');

  // The header is the first line where every required column is found
  // (Google puts a title and a date range above it).
  let headerIndex = -1;
  let columns: Partial<Record<ImportColumn, number>> = {};
  let bestMissing: ImportColumn[] = REQUIRED;
  for (let index = 0; index < Math.min(lines.length, 15); index += 1) {
    const found: Partial<Record<ImportColumn, number>> = {};
    (lines[index] ?? []).forEach((header, position) => {
      const column = columnOf(header);
      if (column && found[column] === undefined) found[column] = position;
    });
    const missing = REQUIRED.filter((column) => found[column] === undefined);
    if (missing.length === 0) {
      headerIndex = index;
      columns = found;
      break;
    }
    if (missing.length < bestMissing.length) bestMissing = missing;
  }
  if (headerIndex < 0) throw new CsvFormatError('missing_columns', bestMissing);

  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  const seen = new Set<string>();
  const cellOf = (cells: string[], column: ImportColumn) => {
    const position = columns[column];
    return position === undefined ? '' : (cells[position] ?? '').trim();
  };

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const cells = lines[index] ?? [];
    const line = index + 1;
    if (cells.every((cell) => cell.trim() === '')) continue;
    const externalId = cellOf(cells, 'externalId');
    const rawDate = cellOf(cells, 'date');
    // Total lines ("Total: Account", "Total"): not a campaign day.
    if (
      /^(total|الإجمالي|المجموع)/i.test(rawDate) ||
      /^(total|الإجمالي|المجموع)/i.test(externalId)
    ) {
      continue;
    }
    if (externalId === '' || externalId === '--') {
      errors.push({ line, reason: 'missing_campaign_id' });
      continue;
    }
    const date = cleanDate(rawDate);
    if (!date) {
      errors.push({ line, reason: 'bad_date', externalId });
      continue;
    }
    const spend = cleanNumber(cellOf(cells, 'spend'));
    const impressions = cleanNumber(cellOf(cells, 'impressions'));
    const clicks = cleanNumber(cellOf(cells, 'clicks'));
    const conversions = cleanNumber(cellOf(cells, 'conversions'));
    if (
      spend === null ||
      impressions === null ||
      clicks === null ||
      conversions === null ||
      impressions.includes('.') ||
      clicks.includes('.') ||
      !/^\d{1,12}(\.\d{1,2})?$/.test(conversions)
    ) {
      errors.push({ line, reason: 'bad_number', externalId });
      continue;
    }
    // The same campaign and day twice: refused (never added up silently).
    const key = `${externalId}|${date}`;
    if (seen.has(key)) {
      errors.push({ line, reason: 'duplicate_row', externalId });
      continue;
    }
    seen.add(key);
    rows.push({
      line,
      date,
      externalId,
      spend,
      impressions: BigInt(impressions),
      clicks: BigInt(clicks),
      conversions,
    });
    if (rows.length + errors.length > MAX_IMPORT_ROWS) throw new CsvFormatError('too_many_rows');
  }
  return { rows, errors };
}
