import type { ClosedDeal, Deal, Proposal, Prospect } from './data';
import { dealsForProspect } from './prospect-deals.ts';

export type ProspectDependencies = {
  opportunities: number;
  deals: number;
  proposals: number;
};

export function hasProspectDependencies(dependencies: ProspectDependencies) {
  return dependencies.opportunities > 0 || dependencies.deals > 0 || dependencies.proposals > 0;
}

export function canManageProspect(prospect: Prospect, level: number, userId?: string) {
  return level >= 2 || Boolean(userId && prospect.ownerId === userId);
}

/** Resolve only durable ID relationships; never guess from account text. */
export function prospectDependencies(
  prospect: Prospect,
  deals: Deal[],
  proposals: Proposal[],
  closedDeals: ClosedDeal[] = []
): ProspectDependencies {
  const activeDeals = dealsForProspect(deals, prospect);
  const historicalDeals = closedDeals.filter((deal) => deal.prospectId === prospect.id);
  const linkedProposals = proposals.filter((proposal) => proposal.prospectId === prospect.id);

  return {
    opportunities: Math.max(0, prospect.opportunities || 0),
    deals: activeDeals.length + historicalDeals.length,
    proposals: linkedProposals.length,
  };
}
