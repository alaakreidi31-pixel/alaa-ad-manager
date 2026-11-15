import type { z } from 'zod';

// Expected invoice and payment failures; the controller turns them into
// HTTP answers. Most of them come from PostgreSQL itself (ADR 0020).

export class InvoiceValidationError extends Error {
  readonly fields: { field: string; message: string }[];

  constructor(error: z.ZodError | { field: string; message: string }) {
    super('Invalid invoice data');
    this.fields =
      'issues' in error
        ? error.issues.map((issue) => ({
            field: issue.path.join('.') || '(body)',
            message: issue.message,
          }))
        : [error];
  }
}

export class InvoiceNotFoundError extends Error {
  constructor() {
    super('Invoice not found');
  }
}

export class PaymentNotFoundError extends Error {
  constructor() {
    super('Payment not found');
  }
}

// The action does not fit the invoice status (e.g. issue twice, change an
// issued invoice, pay a draft, void a voided invoice).
export class InvoiceStateError extends Error {
  constructor(message = 'This action is not possible for this invoice') {
    super(message);
  }
}

export class InvoiceHasPaymentsError extends Error {
  constructor() {
    super('An invoice with payments cannot be voided: void the payments first');
  }
}

export class PaymentExceedsTotalError extends Error {
  constructor() {
    super('The payments would exceed the invoice total');
  }
}
