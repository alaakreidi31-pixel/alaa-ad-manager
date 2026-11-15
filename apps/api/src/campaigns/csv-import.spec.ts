import { describe, expect, it } from 'vitest';
import { CsvFormatError, parseCampaignCsv, splitCsv } from './csv-import';

// Shapes of real exports (names of columns as Meta and Google write them).
const META = [
  '\uFEFFReporting starts,Reporting ends,Campaign name,Campaign ID,Amount spent (USD),Impressions,Link clicks,Results',
  '2026-11-01,2026-11-01,Ramadan,120210000001,"1,234.50",15000,320,12',
  '2026-11-02,2026-11-02,Ramadan,120210000001,80.5,9000,150,',
].join('\r\n');

const GOOGLE = [
  'Campaign report',
  '"November 1, 2026 - November 2, 2026"',
  'Day,Campaign,Campaign ID,Cost,Impr.,Clicks,Conversions',
  '2026-11-01,Search brand,987654321,45.10,"2,000",88,2.50',
  '2026-11-02,Search brand,987654321,0,0,0,--',
  'Total: Account,--,--,45.10,"2,000",88,2.50',
].join('\n');

describe('CSV reports of Meta and Google', () => {
  it('splits quoted cells, separators and line endings', () => {
    expect(splitCsv('a,"b,c","d ""e"""\r\n1;2')).toEqual([['a', 'b,c', 'd "e"'], ['1;2']]);
    expect(splitCsv('x;y\n1;2')).toEqual([
      ['x', 'y'],
      ['1', '2'],
    ]);
  });

  it('reads a Meta export (BOM, thousands, empty results)', () => {
    const { rows, errors } = parseCampaignCsv(META);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      {
        line: 2,
        date: '2026-11-01',
        externalId: '120210000001',
        spend: '1234.50',
        impressions: 15000n,
        clicks: 320n,
        conversions: '12',
      },
      {
        line: 3,
        date: '2026-11-02',
        externalId: '120210000001',
        spend: '80.5',
        impressions: 9000n,
        clicks: 150n,
        conversions: '0',
      },
    ]);
  });

  it('reads a Google export: title lines above, total line ignored, "--" is 0', () => {
    const { rows, errors } = parseCampaignCsv(GOOGLE);
    expect(errors).toEqual([]);
    expect(
      rows.map((row) => [row.line, row.date, row.spend, row.impressions, row.conversions]),
    ).toEqual([
      [4, '2026-11-01', '45.10', 2000n, '2.50'],
      [5, '2026-11-02', '0', 0n, '0'],
    ]);
  });

  it('reads Arabic column names and semicolons', () => {
    const csv =
      'اليوم;معرف الحملة;المبلغ الذي تم إنفاقه (USD);مرات الظهور;النقرات;النتائج\n2026-11-03;55;10;100;5;1';
    expect(parseCampaignCsv(csv).rows[0]).toMatchObject({
      externalId: '55',
      spend: '10',
      clicks: 5n,
    });
  });

  it('reports each bad line with its number and reason, without stopping', () => {
    const csv = [
      'Day,Campaign ID,Cost,Impr.,Clicks',
      '03/11/2026,1,5,10,1',
      '2026-11-04,,5,10,1',
      '2026-11-05,1,abc,10,1',
      '2026-11-06,1,5,10.5,1',
      '2026-11-07,1,5,10,1',
      '2026-11-07,1,6,10,1',
    ].join('\n');
    const { rows, errors } = parseCampaignCsv(csv);
    expect(rows.map((row) => row.line)).toEqual([6]);
    expect(errors).toEqual([
      { line: 2, reason: 'bad_date', externalId: '1' },
      { line: 3, reason: 'missing_campaign_id' },
      { line: 4, reason: 'bad_number', externalId: '1' },
      { line: 5, reason: 'bad_number', externalId: '1' },
      { line: 7, reason: 'duplicate_row', externalId: '1' },
    ]);
  });

  it('refuses a file without the needed columns, naming them', () => {
    expect(() => parseCampaignCsv('')).toThrow(CsvFormatError);
    try {
      parseCampaignCsv('Day,Campaign name,Cost\n2026-11-01,A,5');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CsvFormatError);
      expect((error as CsvFormatError).missing).toEqual(['externalId', 'impressions', 'clicks']);
    }
  });

  it('refuses more than 2000 lines', () => {
    const lines = ['Day,Campaign ID,Cost,Impr.,Clicks'];
    for (let i = 0; i < 2001; i += 1) lines.push(`2026-01-01,${i},1,1,1`);
    expect(() => parseCampaignCsv(lines.join('\n'))).toThrow(CsvFormatError);
  });
});
