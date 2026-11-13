import { describe, expect, it } from 'vitest';
import ar from './locales/ar.json';
import en from './locales/en.json';

// Turns { status: { title: "..." } } into { "status.title": "..." }
function flatten(tree: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null) {
      Object.assign(result, flatten(value as Record<string, unknown>, path));
    } else {
      result[path] = value;
    }
  }
  return result;
}

function placeholders(text: unknown): string[] {
  return typeof text === 'string'
    ? [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] ?? '')
    : [];
}

const arabic = flatten(ar);
const english = flatten(en);

describe('translation files (ar.json / en.json)', () => {
  it('Arabic and English have exactly the same keys', () => {
    const missingInArabic = Object.keys(english).filter((key) => !(key in arabic));
    const missingInEnglish = Object.keys(arabic).filter((key) => !(key in english));
    expect({ missingInArabic, missingInEnglish }).toEqual({
      missingInArabic: [],
      missingInEnglish: [],
    });
  });

  it('no translation is empty', () => {
    for (const [language, texts] of [
      ['ar', arabic],
      ['en', english],
    ] as const) {
      const empty = Object.entries(texts)
        .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
        .map(([key]) => `${language}: ${key}`);
      expect(empty).toEqual([]);
    }
  });

  it('both languages use the same {{placeholders}}', () => {
    const mismatched = Object.keys(english).filter(
      (key) =>
        placeholders(english[key]).sort().join(',') !== placeholders(arabic[key]).sort().join(','),
    );
    expect(mismatched).toEqual([]);
  });
});
