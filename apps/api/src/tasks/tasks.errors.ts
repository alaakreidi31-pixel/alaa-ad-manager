import type { z } from 'zod';

// Expected task failures; the controllers turn them into HTTP answers.
export class TaskValidationError extends Error {
  readonly fields: { field: string; message: string }[];

  constructor(error: z.ZodError | { field: string; message: string }) {
    super('Invalid task data');
    this.fields =
      'issues' in error
        ? error.issues.map((issue) => ({
            field: issue.path.join('.') || '(body)',
            message: issue.message,
          }))
        : [error];
  }
}

export class TaskNotFoundError extends Error {
  constructor() {
    super('Task not found');
  }
}

export class TaskRecurrenceNotFoundError extends Error {
  constructor() {
    super('Recurring task not found');
  }
}
