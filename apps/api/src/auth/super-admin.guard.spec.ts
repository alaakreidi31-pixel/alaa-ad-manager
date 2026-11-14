import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedRequest } from './auth.types';
import { SuperAdminGuard } from './super-admin.guard';

function contextFor(request: AuthenticatedRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const user = { id: 'u1', email: 'a@b.c', fullName: 'A', sessionId: 's1' };
const guard = new SuperAdminGuard();

describe('SuperAdminGuard', () => {
  it('lets a SUPER_ADMIN through', () => {
    const request = { headers: {}, auth: { ...user, role: 'SUPER_ADMIN' as const } };
    expect(guard.canActivate(contextFor(request))).toBe(true);
  });

  it('refuses a CLIENT_USER with 403', () => {
    const request = { headers: {}, auth: { ...user, role: 'CLIENT_USER' as const } };
    expect(() => guard.canActivate(contextFor(request))).toThrow(ForbiddenException);
  });

  it('refuses a request without an identified user', () => {
    expect(() => guard.canActivate(contextFor({ headers: {} }))).toThrow(ForbiddenException);
  });
});
