// CSV export of a report table (phase 7). Values are the API texts, unchanged.
// A byte-order mark lets Excel open Arabic text correctly.
export type CsvCell = string | number | null;

function cell(value: CsvCell): string {
  const text = value === null ? '' : String(value);
  // Quote when needed; a leading = + - @ is neutralised (spreadsheet formulas).
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  return `${String.fromCharCode(0xfeff)}${[header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

export function downloadCsv(fileName: string, header: string[], rows: CsvCell[][]): void {
  const blob = new Blob([toCsv(header, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
