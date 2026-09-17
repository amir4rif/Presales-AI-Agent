export const DEAL_LOSS_REASONS = [
  'Chose competitor',
  'Budget cut',
  'No decision',
  'Pricing too high',
  'Timing',
  'Other',
] as const;

export const DISQUALIFICATION_REASONS = [
  'Compliance',
  'Blacklisted account',
  'Out of scope',
  'Wrong product fit',
] as const;

export type ClosedDealOutcome = 'Won' | 'Lost' | 'Disqualified';
export type DealOutcome = 'Open' | ClosedDealOutcome;
export type ProposalDealOutcome = 'Pending' | ClosedDealOutcome;
export type DealLossReason = (typeof DEAL_LOSS_REASONS)[number];
export type DisqualificationReason = (typeof DISQUALIFICATION_REASONS)[number];

type CloseDatedDeal = { closeDate?: string; daysToClose: number };
type OutcomeRecord = { outcome: string };
export type ClosedDealIdentity = {
  rep: string;
  account: string;
  closeDate: string;
  value: number;
};

const DAY_MS = 86_400_000;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function normalizeIdentityText(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

/** The fields that define an identical manual closed-deal submission. */
export function closedDealIdentityKey(deal: ClosedDealIdentity) {
  const numericValue = Number(deal.value);
  const value = Number.isFinite(numericValue) && numericValue !== 0
    ? String(numericValue)
    : '0';
  return [
    normalizeIdentityText(deal.rep),
    normalizeIdentityText(deal.account),
    deal.closeDate.trim(),
    value,
  ].join('\u001f');
}

/**
 * A retry of the same manual closed deal uses the same database primary key.
 * UUID v8 marks this as an application-defined, SHA-256-derived identifier.
 */
export async function closedDealIdempotencyId(deal: ClosedDealIdentity) {
  const input = new TextEncoder().encode(`ramssol-closed-deal-v1\u001f${closedDealIdentityKey(deal)}`);
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input)).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function utcDayFromKey(value: string) {
  if (!DATE_KEY.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function localDateKey(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addCalendarDays(dateKey: string, days: number) {
  const timestamp = utcDayFromKey(dateKey);
  if (timestamp === null) return dateKey;
  return new Date(timestamp + Math.trunc(days) * DAY_MS).toISOString().slice(0, 10);
}

export function expectedCloseDate(deal: CloseDatedDeal, now = new Date()) {
  if (deal.closeDate && DATE_KEY.test(deal.closeDate)) return deal.closeDate;
  return addCalendarDays(localDateKey(now), Number.isFinite(deal.daysToClose) ? deal.daysToClose : 0);
}

export function daysUntilDealClose(deal: CloseDatedDeal, now = new Date()) {
  const target = utcDayFromKey(expectedCloseDate(deal, now));
  const today = utcDayFromKey(localDateKey(now));
  if (target === null || today === null) return 0;
  return Math.round((target - today) / DAY_MS);
}

export function dealNeedsOutcome(deal: CloseDatedDeal, now = new Date()) {
  return daysUntilDealClose(deal, now) < 0;
}

export function dealOutcomeOverdueDays(deal: CloseDatedDeal, now = new Date()) {
  return Math.max(0, -daysUntilDealClose(deal, now));
}

export function dealOutcomeEscalated(deal: CloseDatedDeal, now = new Date()) {
  return dealOutcomeOverdueDays(deal, now) >= 14;
}

/** Only Won/Lost records are scored. Disqualified remains visible history. */
export function scoredClosedDeals<T extends OutcomeRecord>(records: readonly T[]) {
  return records.filter((record) => record.outcome === 'Won' || record.outcome === 'Lost');
}

export function outcomeHygieneByRep<
  T extends CloseDatedDeal & { rep: string }
>(deals: readonly T[], now = new Date()) {
  const rows = new Map<string, { rep: string; needsOutcome: number; escalated: number }>();
  for (const deal of deals) {
    if (!dealNeedsOutcome(deal, now)) continue;
    const row = rows.get(deal.rep) || { rep: deal.rep, needsOutcome: 0, escalated: 0 };
    row.needsOutcome += 1;
    if (dealOutcomeEscalated(deal, now)) row.escalated += 1;
    rows.set(deal.rep, row);
  }
  return [...rows.values()].sort(
    (a, b) => b.escalated - a.escalated || b.needsOutcome - a.needsOutcome || a.rep.localeCompare(b.rep)
  );
}
