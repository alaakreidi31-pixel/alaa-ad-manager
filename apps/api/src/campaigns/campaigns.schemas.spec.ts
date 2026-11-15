import { describe, expect, it } from 'vitest';
import { CreateCampaignSchema, UpdateCampaignSchema } from './campaigns.schemas';

const base = { platform: 'META', name: 'Ramadan offers' };

describe('campaign validation', () => {
  it('accepts a minimal campaign', () => {
    expect(CreateCampaignSchema.parse(base)).toEqual({ ...base });
  });

  it('keeps money as text (minor units are computed by the service)', () => {
    expect(CreateCampaignSchema.parse({ ...base, dailyBudget: '150.5' }).dailyBudget).toBe('150.5');
    expect(CreateCampaignSchema.parse({ ...base, dailyBudget: 12.5 }).dailyBudget).toBe('12.5');
    expect(CreateCampaignSchema.parse({ ...base, dailyBudget: '' }).dailyBudget).toBeNull();
  });

  it.each(['-5', '1.2345', 'abc', '1e3', '1234567890123456'])('refuses the amount %s', (amount) => {
    expect(CreateCampaignSchema.safeParse({ ...base, dailyBudget: amount }).success).toBe(false);
  });

  it('refuses unknown platforms and currencies', () => {
    expect(CreateCampaignSchema.safeParse({ ...base, platform: 'TIKTOK' }).success).toBe(false);
    expect(CreateCampaignSchema.safeParse({ ...base, currency: 'XYZ1' }).success).toBe(false);
  });

  it('refuses impossible dates and an end before the start', () => {
    expect(CreateCampaignSchema.safeParse({ ...base, startDate: '2026-02-30' }).success).toBe(
      false,
    );
    const reversed = CreateCampaignSchema.safeParse({
      ...base,
      startDate: '2026-11-15',
      endDate: '2026-11-01',
    });
    expect(reversed.success).toBe(false);
    expect(reversed.error?.issues[0]?.path).toEqual(['endDate']);
  });

  it('refuses fields the administrator may not set (status, clientId)', () => {
    expect(CreateCampaignSchema.safeParse({ ...base, status: 'ENDED' }).success).toBe(false);
    expect(CreateCampaignSchema.safeParse({ ...base, clientId: 'x' }).success).toBe(false);
  });

  it('does not let an update change the platform, and needs one field', () => {
    expect(UpdateCampaignSchema.safeParse({ platform: 'GOOGLE' }).success).toBe(false);
    expect(UpdateCampaignSchema.safeParse({}).success).toBe(false);
    expect(UpdateCampaignSchema.parse({ objective: '  ' })).toEqual({ objective: null });
  });
});
