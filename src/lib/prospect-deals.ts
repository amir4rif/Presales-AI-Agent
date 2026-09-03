import type { Deal, Prospect } from './data';

function normalizedName(value: string) {
  return value.trim().toLocaleLowerCase();
}

/**
 * Prefer the durable relationship. Old rows without one may match only the
 * prospect's complete trimmed company name; prefixes and blanks never match.
 */
export function isDealForProspect(deal: Deal, prospect: Prospect) {
  if (deal.prospectId != null) return deal.prospectId === prospect.id;
  const prospectName = normalizedName(prospect.name);
  return prospectName.length > 0 && normalizedName(deal.account) === prospectName;
}

export function dealsForProspect(deals: Deal[], prospect: Prospect) {
  return deals.filter((deal) => isDealForProspect(deal, prospect));
}
