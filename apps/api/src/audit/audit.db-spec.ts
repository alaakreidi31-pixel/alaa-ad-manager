import { afterAll, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { createTestPrisma } from '../testing/test-prisma';
import { writeAuditLog } from './audit';
import { AuditService } from './audit.service';

// The real PrismaService reads .env at import time: replace it.
vi.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

// Connects as alaa_app, exactly like the running API.
const prisma = createTestPrisma();

async function newRow() {
  const marker = `test-${Date.now()}-${Math.random()}`;
  await writeAuditLog(prisma, { action: 'auth.logout', userAgent: marker });
  return prisma.auditLog.findFirstOrThrow({ where: { userAgent: marker } });
}

describe('audit_logs table (real PostgreSQL, test database)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('the application can add and read events', async () => {
    const row = await newRow();
    expect(row.action).toBe('auth.logout');
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('the application CANNOT change an event', async () => {
    const row = await newRow();
    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { action: 'auth.login.succeeded' } }),
    ).rejects.toThrow();
    expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: row.id } })).action).toBe(
      'auth.logout',
    );
  });

  it('the application CANNOT delete events', async () => {
    const row = await newRow();
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
    await expect(prisma.auditLog.deleteMany()).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe('TRUNCATE audit_logs')).rejects.toThrow();
    expect(await prisma.auditLog.count({ where: { id: row.id } })).toBe(1);
  });

  it('cuts very long texts to 512 characters', async () => {
    const marker = `long-${Date.now()}`;
    await writeAuditLog(prisma, {
      action: 'auth.login.failed',
      ip: 'x'.repeat(5000),
      userAgent: marker + 'y'.repeat(5000),
    });
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { userAgent: { startsWith: marker } },
    });
    expect(row.ip).toHaveLength(512);
    expect(row.userAgent).toHaveLength(512);
  });

  it('a failure to write never breaks the request', async () => {
    const broken = {
      auditLog: { create: () => Promise.reject(new Error('database down')) },
    } as unknown as PrismaService;
    const service = new AuditService(broken);
    vi.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
    await expect(service.record({ action: 'auth.logout' })).resolves.toBeUndefined();
  });
});
