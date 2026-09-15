export type ProposalLifecycleRow = {
  id?: string | null;
  caseId?: string | null;
  dealId?: string | null;
  version?: number | null;
  status: string;
  outcome?: string | null;
  rejectionReason?: string | null;
  owner?: string | null;
  submittedBy?: string | null;
  ownerId?: string | null;
  submittedById?: string | null;
};

export type ProposalDealRow = {
  id?: string | null;
  caseId?: string | null;
};

export type ProposalVisibleDealRow = ProposalDealRow & {
  ownerId?: string | null;
  rep: string;
};

/** Superseded versions remain in history but are not the live case version. */
export function isLiveProposalVersion(proposal: ProposalLifecycleRow) {
  return proposal.status !== 'Superseded';
}

/**
 * A deal's one-live-case slot stays occupied through drafting, review,
 * revision, and an approved-but-not-yet-closed outcome. Terminal proposal
 * and deal outcomes do not occupy it.
 */
export function isLiveProposalCase(proposal: ProposalLifecycleRow) {
  return proposal.status === 'Draft' ||
    proposal.status === 'Pending Review' ||
    proposal.status === 'Reject & Revise' ||
    (proposal.status === 'Approved' &&
      (!proposal.outcome || proposal.outcome === 'Pending'));
}

/** Relationships are IDs only. Display labels never participate. */
export function dealHasLiveProposalCase(
  deal: ProposalDealRow,
  proposals: ProposalLifecycleRow[]
) {
  if (deal.caseId?.trim()) return true;
  const dealId = deal.id?.trim();
  if (!dealId) return true;
  return proposals.some((proposal) =>
    proposal.dealId === dealId && isLiveProposalCase(proposal)
  );
}

export function dealsAvailableForProposal<T extends ProposalDealRow>(
  deals: T[],
  proposals: ProposalLifecycleRow[]
) {
  return deals.filter((deal) => !dealHasLiveProposalCase(deal, proposals));
}

/** Mirrors Pipeline's L1-own / L2+-team visibility without inventing a join. */
export function visibleDealsForProposal<T extends ProposalVisibleDealRow>(
  deals: T[],
  level: number,
  user: string,
  userId?: string
) {
  if (level >= 2) return deals;
  return deals.filter((deal) =>
    userId && deal.ownerId ? deal.ownerId === userId : deal.rep === user
  );
}

/** Keep one current row per case even while a stale browser cache is healing. */
export function latestLiveProposalVersions<T extends ProposalLifecycleRow>(proposals: T[]) {
  const visible: T[] = [];
  const indexByCase = new Map<string, number>();

  for (const proposal of proposals) {
    if (!isLiveProposalVersion(proposal)) continue;

    // Legacy rows without a case id are independent proposals and must not be
    // collapsed together. Valid case rows defensively select the newest live
    // version even if a stale cache predates the database repair migration.
    const caseId = proposal.caseId?.trim();
    if (!caseId) {
      visible.push(proposal);
      continue;
    }

    const existingIndex = indexByCase.get(caseId);
    if (existingIndex === undefined) {
      indexByCase.set(caseId, visible.length);
      visible.push(proposal);
      continue;
    }

    const existing = visible[existingIndex];
    if ((proposal.version || 1) > (existing.version || 1)) {
      visible[existingIndex] = proposal;
    }
  }

  return visible;
}

/** My Proposals keeps only the newest live version of each owned case. */
export function visibleProposalVersionsForOwner<T extends ProposalLifecycleRow>(
  proposals: T[],
  owner: string,
  ownerId?: string
) {
  const owned = proposals.filter((proposal) => {
    const proposalOwnerId = proposal.ownerId || proposal.submittedById;
    return ownerId && proposalOwnerId
      ? proposalOwnerId === ownerId
      : (proposal.owner || proposal.submittedBy) === owner;
  });
  return latestLiveProposalVersions(owned);
}

/** Only fixable, live rejections belong in the AI learning loop. */
export function rejectionReasonStats(proposals: ProposalLifecycleRow[]) {
  const reasons: Record<string, number> = {};
  for (const proposal of latestLiveProposalVersions(proposals)) {
    const reason = proposal.rejectionReason?.trim();
    if (proposal.status !== 'Reject & Revise' || !reason) continue;
    reasons[reason] = (reasons[reason] || 0) + 1;
  }
  const topReason = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0] || null;
  return { reasons, topReason };
}
