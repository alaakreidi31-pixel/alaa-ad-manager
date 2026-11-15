import type { CampaignPlatform } from '../lib/campaigns-api';

// Meta or Google, written the same way in both languages (brand names).
const STYLES: Record<CampaignPlatform, string> = {
  META: 'border-sky-400/40 text-sky-300',
  GOOGLE: 'border-gold-500/50 text-gold-300',
};
const NAMES: Record<CampaignPlatform, string> = { META: 'Meta', GOOGLE: 'Google' };

export function PlatformBadge({ platform }: { platform: CampaignPlatform }) {
  return (
    <span
      dir="ltr"
      className={`inline-block rounded-md border px-2 py-0.5 text-xs font-bold ${STYLES[platform]}`}
    >
      {NAMES[platform]}
    </span>
  );
}
