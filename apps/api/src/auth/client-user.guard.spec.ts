import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedRequest } from './auth.types';
import { ClientUserGuard } from './client-user.guard';

function contextFor(request: AuthenticatedRequest): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

const user = { id: 'u1', email: 'a@b.c', fullName: 'A', sessionId: 's1' };
const guard = new ClientUserGuard();

describe('ClientUserGuard', () => {
  it('lets a CLIENT_USER with a client through', () => {
    const auth = { ...user, role: 'CLIENT_USER' as const, clientId: 'c1' };
    expect(guard.canActivate(contextFor({ headers: {}, auth }))).toBe(true);
  });

  it('refuses a SUPER_ADMIN (administrators use /api/admin)', () => {
    const auth = { ...user, role: 'SUPER_ADMIN' as const, clientId: null };
    expect(() => guard.canActivate(contextFor({ headers: {}, auth }))).toThrow(ForbiddenException);
  });

  it('refuses a request without an identified user', () => {
    expect(() => guard.canActivate(contextFor({ headers: {} }))).toThrow(ForbiddenException);
  });
});
