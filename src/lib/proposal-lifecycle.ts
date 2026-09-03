export type ProposalLifecycleRow = {
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

/** My Proposals keeps every live outcome, including terminal closed cases. */
export function visibleProposalVersionsForOwner<T extends ProposalLifecycleRow>(
  proposals: T[],
  owner: string,
  ownerId?: string
) {
  return proposals.filter(
    (proposal) => {
      const proposalOwnerId = proposal.ownerId || proposal.submittedById;
      const isOwner = ownerId && proposalOwnerId
        ? proposalOwnerId === ownerId
        : (proposal.owner || proposal.submittedBy) === owner;
      return isOwner && isLiveProposalVersion(proposal);
    }
  );
}

/** Only fixable, live rejections belong in the AI learning loop. */
export function rejectionReasonStats(proposals: ProposalLifecycleRow[]) {
  const reasons: Record<string, number> = {};
  for (const proposal of proposals) {
    const reason = proposal.rejectionReason?.trim();
    if (proposal.status !== 'Reject & Revise' || !reason) continue;
    reasons[reason] = (reasons[reason] || 0) + 1;
  }
  const topReason = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0] || null;
  return { reasons, topReason };
}
