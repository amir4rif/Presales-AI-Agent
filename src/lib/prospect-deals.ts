import type { Deal, Prospect } from './data';

/** Relationships are explicit IDs. Null legacy links deliberately stay unknown. */
export function isDealForProspect(deal: Deal, prospect: Prospect) {
  return deal.prospectId != null && deal.prospectId === prospect.id;
}

export function dealsForProspect(deals: Deal[], prospect: Prospect) {
  return deals.filter((deal) => isDealForProspect(deal, prospect));
}
