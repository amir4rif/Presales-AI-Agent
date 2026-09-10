export type ProposalLifecycleRow = {
  id?: string | null;
  caseId?: string | null;
  version?: number | null;
  status: string;
  rejectionReason?: string | null;
  owner?: string | null;
  submittedBy?: string | null;
  ownerId?: string | null;
  submittedById?: string | null;
};

/** Superseded versions remain in history but are not the live case version. */
export function isLiveProposalVersion(proposal: ProposalLifecycleRow) {
  return proposal.status !== 'Superseded';
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
