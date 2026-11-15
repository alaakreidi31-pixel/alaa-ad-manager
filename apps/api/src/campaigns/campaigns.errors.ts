import type { z } from 'zod';

// Expected campaign failures; the controller turns them into HTTP answers.

export class CampaignValidationError extends Error {
  readonly fields: { field: string; message: string }[];

  constructor(error: z.ZodError | { field: string; message: string }) {
    super('Invalid campaign data');
    this.fields =
      'issues' in error
        ? error.issues.map((issue) => ({
            field: issue.path.join('.') || '(body)',
            message: issue.message,
          }))
        : [error];
  }
}

export class CampaignNotFoundError extends Error {
  constructor() {
    super('Campaign not found for this client');
  }
}

// Archived campaigns are read-only (history): reactivate first.
export class CampaignArchivedError extends Error {
  constructor() {
    super('This campaign is archived and cannot be changed');
  }
}

export class InvalidCampaignStatusChangeError extends Error {
  constructor(from: string, to: string) {
    super(`A campaign cannot go from ${from} to ${to}`);
  }
}

export class ExternalIdTakenError extends Error {
  constructor() {
    super('This client already has a campaign with this platform id');
  }
}

// The daily numbers are in the campaign currency: it cannot change any more.
export class CurrencyLockedError extends Error {
  constructor() {
    super('The currency cannot change once daily numbers exist');
  }
}

// Daily numbers are refused for future days.
export class FutureDayError extends Error {
  constructor() {
    super('Numbers cannot be entered for a future day');
  }
}

// A CSV import is all or nothing: refused while one line has a problem.
export class ImportHasErrorsError extends Error {
  constructor(readonly count: number) {
    super(`The file has ${count} line(s) with problems: nothing was imported`);
  }
}
