// Runs in every database test worker, before the tests.
// Defense in depth: any code that reads DATABASE_URL during the tests
// gets the TEST database, and the migration credentials are removed.
import 'dotenv/config';
import { assertTestDatabaseUrl } from '../../src/testing/test-database';

process.env['DATABASE_URL'] = assertTestDatabaseUrl(
  'TEST_DATABASE_URL',
  process.env['TEST_DATABASE_URL'],
);
delete process.env['MIGRATE_DATABASE_URL'];
delete process.env['TEST_MIGRATE_DATABASE_URL'];
