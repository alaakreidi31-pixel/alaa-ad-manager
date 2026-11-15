// Money helpers (ADR 0008): amounts are stored as WHOLE numbers in the
// smallest unit of their currency (cents for USD: 12.50 USD = 1250), and
// travel as decimal TEXT ("12.50"). No float is ever used.

export class MoneyFormatError extends Error {
  constructor(message: string) {
    super(message);
  }
}

// Decimals of a currency: 2 for USD and SAR, 0 for JPY, 3 for KWD.
export function currencyDigits(currency: string): number {
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

const AMOUNT = /^(\d{1,15})(?:\.(\d+))?$/;

// "150.5" USD -> 15050n. Refuses more decimals than the currency has.
export function toMinor(amount: string, currency: string): bigint {
  const match = AMOUNT.exec(amount.trim());
  if (!match) throw new MoneyFormatError('must be an amount like 150 or 150.50');
  const digits = currencyDigits(currency);
  const fraction = match[2] ?? '';
  if (fraction.length > digits) {
    throw new MoneyFormatError(`${currency} amounts have at most ${digits} decimals`);
  }
  return (
    BigInt(match[1] ?? '0') * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0')
  );
}

// 15050n USD -> "150.50"; 1500n JPY -> "1500".
export function fromMinor(minor: bigint, currency: string): string {
  const digits = currencyDigits(currency);
  if (digits === 0) return minor.toString();
  const text = minor.toString().padStart(digits + 1, '0');
  return `${text.slice(0, -digits)}.${text.slice(-digits)}`;
}
