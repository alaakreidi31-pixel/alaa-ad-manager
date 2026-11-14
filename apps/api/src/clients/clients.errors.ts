import type { z } from 'zod';

// Expected client-management failures; the controller turns them into HTTP answers.

export class ClientValidationError extends Error {
  readonly fields: { field: string; message: string }[];

  constructor(error: z.ZodError) {
    super('Invalid client data');
    this.fields = error.issues.map((issue) => ({
      field: issue.path.join('.') || '(body)',
      message: issue.message,
    }));
  }
}

export class ClientNotFoundError extends Error {
  constructor() {
    super('Client not found');
  }
}

// Archived clients are read-only (history).
export class ClientArchivedError extends Error {
  constructor() {
    super('This client is archived and cannot be changed');
  }
}

export class InvalidClientStatusChangeError extends Error {
  constructor(from: string, to: string) {
    super(`A client cannot go from ${from} to ${to}`);
  }
}

export class ClientUserNotFoundError extends Error {
  constructor() {
    super('User not found for this client');
  }
}

export class EmailTakenError extends Error {
  constructor() {
    super('An account with this email already exists');
  }
}

export class InvalidUserStatusChangeError extends Error {
  constructor(from: string, to: string) {
    super(`A user cannot go from ${from} to ${to}`);
  }
}
