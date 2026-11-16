import { describe, expect, it } from 'vitest';
import { isOverdue } from './tasks-api';

describe('isOverdue (UTC days, like the API)', () => {
  const now = new Date('2026-11-16T23:30:00Z');
  it('open tasks due before today are overdue', () => {
    expect(isOverdue({ status: 'TODO', dueOn: '2026-11-15' }, now)).toBe(true);
    expect(isOverdue({ status: 'IN_PROGRESS', dueOn: '2026-11-15' }, now)).toBe(true);
  });
  it('today, later, no date, done or cancelled are not', () => {
    expect(isOverdue({ status: 'TODO', dueOn: '2026-11-16' }, now)).toBe(false);
    expect(isOverdue({ status: 'TODO', dueOn: null }, now)).toBe(false);
    expect(isOverdue({ status: 'DONE', dueOn: '2026-11-01' }, now)).toBe(false);
    expect(isOverdue({ status: 'CANCELLED', dueOn: '2026-11-01' }, now)).toBe(false);
  });
});
