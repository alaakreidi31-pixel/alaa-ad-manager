import { describe, expect, it } from 'vitest';
import { invoiceLabel } from './invoices-api';

describe('invoice labels', () => {
  it('says what the invoice needs now', () => {
    expect(invoiceLabel({ status: 'DRAFT', paymentState: 'unpaid', overdue: false })).toBe('draft');
    expect(invoiceLabel({ status: 'VOID', paymentState: 'paid', overdue: false })).toBe('void');
    expect(invoiceLabel({ status: 'ISSUED', paymentState: 'paid', overdue: true })).toBe('paid');
    expect(invoiceLabel({ status: 'ISSUED', paymentState: 'partial', overdue: true })).toBe(
      'overdue',
    );
    expect(invoiceLabel({ status: 'ISSUED', paymentState: 'partial', overdue: false })).toBe(
      'partial',
    );
    expect(invoiceLabel({ status: 'ISSUED', paymentState: 'unpaid', overdue: false })).toBe(
      'unpaid',
    );
  });
});
