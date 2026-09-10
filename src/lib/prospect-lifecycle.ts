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

function normalizedName(value: string | null | undefined) {
  return (value || '').trim().toLocaleLowerCase();
}

/** Resolve every relationship the current data model can tie to a prospect. */
export function prospectDependencies(
  prospect: Prospect,
  deals: Deal[],
  proposals: Proposal[],
  closedDeals: ClosedDeal[] = []
): ProspectDependencies {
  const name = normalizedName(prospect.name);
  const activeDeals = dealsForProspect(deals, prospect);
  const historicalDeals = name
    ? closedDeals.filter((deal) => normalizedName(deal.account) === name)
    : [];
  const linkedProposals = name
    ? proposals.filter((proposal) => normalizedName(proposal.company) === name)
    : [];

  return {
    opportunities: Math.max(0, prospect.opportunities || 0),
    deals: activeDeals.length + historicalDeals.length,
    proposals: linkedProposals.length,
  };
}
