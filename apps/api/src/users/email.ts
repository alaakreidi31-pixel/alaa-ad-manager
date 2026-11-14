// Every email is stored in one canonical form: no surrounding spaces, lowercase.
// The database enforces the same rule (users_email_normalized_check), so an
// email that skips this function is rejected instead of being stored twice.
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}
