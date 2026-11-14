import { describe, expect, it } from 'vitest';
import { CreateClientSchema, ListClientsQuerySchema, UpdateClientSchema } from './clients.schemas';

const valid = { name: 'Riyadh Coffee Co.' };

function errorFields(input: unknown): string[] {
  const result = CreateClientSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('client validation', () => {
  it('accepts a client with only a name, and leaves defaults to the database', () => {
    expect(CreateClientSchema.parse(valid)).toEqual({ name: 'Riyadh Coffee Co.' });
  });

  it('normalizes the values', () => {
    const parsed = CreateClientSchema.parse({
      name: '  Riyadh Coffee Co.  ',
      email: ' Owner@Coffee.SA ',
      country: 'sa',
      currency: 'sar',
      contactName: '   ',
    });
    expect(parsed).toEqual({
      name: 'Riyadh Coffee Co.',
      email: 'owner@coffee.sa',
      country: 'SA',
      currency: 'SAR',
      contactName: null,
    });
  });

  it('accepts all the fields with valid values', () => {
    expect(
      errorFields({
        ...valid,
        contactName: 'Sara',
        email: 'sara@coffee.sa',
        phone: '+966 50 123 4567',
        country: 'SA',
        currency: 'USD',
        timezone: 'Asia/Riyadh',
        website: 'https://coffee.sa',
        businessIndustry: 'Food & beverage',
        internalNotes: 'Pays on time.',
      }),
    ).toEqual([]);
  });

  it.each([
    ['name', { name: 'A' }],
    ['email', { ...valid, email: 'not-an-email' }],
    ['phone', { ...valid, phone: 'call me' }],
    ['country', { ...valid, country: 'Saudi' }],
    ['currency', { ...valid, currency: 'ABC' }],
    ['timezone', { ...valid, timezone: 'Mars/Base' }],
    ['website', { ...valid, website: 'ftp://coffee.sa' }],
    ['internalNotes', { ...valid, internalNotes: 'x'.repeat(5001) }],
  ])('refuses an invalid %s', (field, input) => {
    expect(errorFields(input)).toContain(field);
  });

  it('refuses unknown fields such as status or id', () => {
    expect(CreateClientSchema.safeParse({ ...valid, status: 'ARCHIVED' }).success).toBe(false);
    expect(CreateClientSchema.safeParse({ ...valid, id: 'x' }).success).toBe(false);
  });

  it('an update needs at least one field, and accepts clearing one', () => {
    expect(UpdateClientSchema.safeParse({}).success).toBe(false);
    expect(UpdateClientSchema.parse({ phone: '' })).toEqual({ phone: null });
  });

  it('list query: defaults and limits', () => {
    expect(ListClientsQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(ListClientsQuerySchema.parse({ page: '3', pageSize: '50' })).toMatchObject({
      page: 3,
      pageSize: 50,
    });
    expect(ListClientsQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
    expect(ListClientsQuerySchema.safeParse({ status: 'DELETED' }).success).toBe(false);
  });
});
