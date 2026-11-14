// Safety guard for database tests: they delete data, so they must never
// run against a database that is not explicitly a test database.
// Error messages show the database NAME only, never the URL (it holds a password).
export function assertTestDatabaseUrl(variableName: string, url: string | undefined): string {
  if (!url) {
    throw new Error(`${variableName} is not set (see apps/api/.env.example)`);
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    throw new Error(`${variableName} is not a valid database URL`);
  }

  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `Refusing to run database tests: ${variableName} points to "${databaseName}", ` +
        'whose name does not end with "_test".',
    );
  }

  return url;
}
