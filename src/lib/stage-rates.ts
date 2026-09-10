import { latestLiveProposalVersions } from './proposal-lifecycle.ts';

export type ProposalStageRecord = {
  id?: string;
  caseId: string;
  version?: number;
  status: string;
  outcome?: 'Pending' | 'Won' | 'Lost';
};

type CaseState = {
  approved?: ProposalStageRecord;
  killed: boolean;
  revise: boolean;
};

const pct = (numerator: number, denominator: number) =>
  denominator ? Math.round((numerator / denominator) * 100) : 0;

/**
 * Compute both funnel stages per case. Stage 2 is deliberately a subset of
 * Stage 1's approved cases; unrelated rows from closed_deals never enter it.
 */
export function calculateTwoStageRates(proposals: readonly ProposalStageRecord[]) {
  const cases = new Map<string, CaseState>();

  latestLiveProposalVersions([...proposals]).forEach((proposal, index) => {
    // A missing legacy Case ID must not collapse unrelated proposals together.
    const key = proposal.caseId || `proposal:${proposal.id || index}`;
    const state = cases.get(key) || { killed: false, revise: false };

    if (proposal.status === 'Approved') {
      const currentVersion = state.approved?.version || 0;
      if (!state.approved || (proposal.version || 0) >= currentVersion) {
        state.approved = proposal;
      }
    } else if (proposal.status === 'Reject & Close') {
      state.killed = true;
    } else if (proposal.status === 'Reject & Revise') {
      state.revise = true;
    }

    cases.set(key, state);
  });

  let approved = 0;
  let revise = 0;
  let killed = 0;
  let won = 0;
  let lost = 0;

  cases.forEach((state) => {
    if (state.approved) {
      approved += 1;
      if (state.approved.outcome === 'Won') won += 1;
      else if (state.approved.outcome === 'Lost') lost += 1;
    } else if (state.killed) {
      killed += 1;
    } else if (state.revise) {
      revise += 1;
    }
  });

  const judged = approved + revise;
  const decided = won + lost;
  const approvalRate = pct(approved, judged);
  const winRate = pct(won, decided);

  return {
    approved,
    revise,
    killed,
    judged,
    won,
    lost,
    decided,
    approvalRate,
    winRate,
    endToEnd: Math.round((approvalRate * winRate) / 100),
  };
}
