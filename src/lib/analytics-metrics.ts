import { dealDaysInStage } from './deal-outcomes.ts';

export function analyticsReadiness(completedProjects: number, requiredProjects: number) {
  const completed = Number.isFinite(completedProjects)
    ? Math.max(0, Math.floor(completedProjects))
    : 0;
  const required = Number.isInteger(requiredProjects) && requiredProjects > 0
    ? requiredProjects
    : Number.POSITIVE_INFINITY;

  return {
    completed,
    required,
    remaining: Math.max(required - completed, 0),
    ready: completed >= required,
    progress: Number.isFinite(required)
      ? Math.min(Math.round((completed / required) * 100), 100)
      : 0,
  };
}

export function closedDealRate(won: number, total: number, requiredProjects: number) {
  return requiredProjects > 0 && total >= requiredProjects
    ? Math.round((won / total) * 100)
    : null;
}

/** Each approved case contributes its number of pre-approval revision loops. */
export function averageApprovedCaseRevisions(
  proposals: readonly { id?: string; caseId?: string; status: string; version?: number }[]
) {
  const approved = new Map<string, number>();
  proposals.forEach((proposal, index) => {
    if (proposal.status !== 'Approved') return;
    const key = proposal.caseId?.trim() || proposal.id || `proposal:${index}`;
    approved.set(key, Math.max(approved.get(key) || 1, proposal.version || 1));
  });
  return approved.size
    ? [...approved.values()].reduce((sum, version) => sum + Math.max(0, version - 1), 0) / approved.size
    : null;
}

type ApprovalHistoryRecord = {
  status: string;
  reviewedDate?: string | null;
  rejectionReason?: string | null;
};

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

function reviewMonth(value: string | null | undefined) {
  const date = value?.trim();
  if (!date) return null;

  const iso = /^(\d{4})-(\d{2})(?:-|$)/.exec(date);
  if (iso) {
    const month = Number(iso[2]);
    if (month >= 1 && month <= 12) {
      return { year: Number(iso[1]), month };
    }
  }

  const display = /(?:^|\s)(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})$/i.exec(date);
  if (!display) return null;
  const month = MONTHS.findIndex((name) => name.toLowerCase() === display[1].slice(0, 3).toLowerCase()) + 1;
  return month ? { year: Number(display[2]), month } : null;
}

/** Historical Stage-1 decisions grouped by the month they were reviewed. */
export function calculateMonthlyApprovalRates(records: readonly ApprovalHistoryRecord[]) {
  const months = new Map<string, { year: number; month: number; approved: number; revised: number }>();

  records.forEach((record) => {
    const approved = record.status === 'Approved';
    // A rejected version becomes Superseded when sales resubmits it. Its
    // retained rejection reason and review date keep that real decision in
    // history without counting unrelated superseded rows.
    const revised = record.status === 'Reject & Revise'
      || (record.status === 'Superseded' && !!record.rejectionReason?.trim());
    if (!approved && !revised) return;

    const reviewed = reviewMonth(record.reviewedDate);
    if (!reviewed) return;
    const key = `${reviewed.year}-${String(reviewed.month).padStart(2, '0')}`;
    const month = months.get(key) || { ...reviewed, approved: 0, revised: 0 };
    if (approved) month.approved += 1;
    else month.revised += 1;
    months.set(key, month);
  });

  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, month]) => {
      const judged = month.approved + month.revised;
      return {
        key,
        label: `${MONTHS[month.month - 1]} '${String(month.year).slice(-2)}`,
        approved: month.approved,
        revised: month.revised,
        judged,
        rate: Math.round((month.approved / judged) * 100),
      };
    });
}

type StageDefinition = { id: number; sla: number };
type ActiveDealStage = { stage: number; stageEnteredOn?: string; daysInStage: number };

/** Average current age of active deals in each stage; null means no coverage. */
export function calculateStageAgeAverages<T extends StageDefinition>(
  stages: readonly T[],
  deals: readonly ActiveDealStage[],
  now = new Date()
) {
  return stages.map((stage) => {
    const ages = deals
      .filter((deal) => deal.stage === stage.id)
      .map((deal) => dealDaysInStage(deal, now))
      .filter((days) => Number.isFinite(days) && days >= 0);
    return {
      ...stage,
      dealCount: ages.length,
      avgDays: ages.length
        ? Math.round((ages.reduce((sum, days) => sum + days, 0) / ages.length) * 10) / 10
        : null,
    };
  });
}

type RepProfile = { name: string; role?: string; level?: number; status?: string };
type RepOwned = { rep?: string | null };
type ProposalOwned = { owner?: string | null; submittedBy?: string | null };

/** Build owner choices from the live directory and records, not demo names. */
export function collectRepNames({
  team,
  deals,
  closedDeals,
  proposals,
}: {
  team: readonly RepProfile[];
  deals: readonly RepOwned[];
  closedDeals: readonly RepOwned[];
  proposals: readonly ProposalOwned[];
}) {
  const names = new Map<string, string>();
  const add = (value: string | null | undefined) => {
    const name = value?.trim();
    if (name) names.set(name.toLocaleLowerCase(), name);
  };

  team
    .filter((member) =>
      member.status?.toLowerCase() === 'active'
      && member.level === 1
    )
    .forEach((member) => add(member.name));
  deals.forEach((deal) => add(deal.rep));
  closedDeals.forEach((deal) => add(deal.rep));
  proposals.forEach((proposal) => {
    add(proposal.owner);
    add(proposal.submittedBy);
  });

  return [...names.values()].sort((a, b) => a.localeCompare(b));
}
