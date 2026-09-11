/** Product policy: analytics remain hidden until this many projects are complete. */
export const MIN_COMPLETED_PROJECTS_FOR_ANALYTICS = 3;
export const MIN_CLOSED_DEALS_FOR_RATE = MIN_COMPLETED_PROJECTS_FOR_ANALYTICS;

export function analyticsReadiness(completedProjects: number) {
  const completed = Number.isFinite(completedProjects)
    ? Math.max(0, Math.floor(completedProjects))
    : 0;
  const required = MIN_COMPLETED_PROJECTS_FOR_ANALYTICS;

  return {
    completed,
    required,
    remaining: Math.max(required - completed, 0),
    ready: completed >= required,
    progress: Math.min(Math.round((completed / required) * 100), 100),
  };
}

export function closedDealRate(won: number, total: number) {
  return total >= MIN_CLOSED_DEALS_FOR_RATE
    ? Math.round((won / total) * 100)
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
type ActiveDealStage = { stage: number; daysInStage: number };

/** Average current age of active deals in each stage; null means no coverage. */
export function calculateStageAgeAverages<T extends StageDefinition>(
  stages: readonly T[],
  deals: readonly ActiveDealStage[]
) {
  return stages.map((stage) => {
    const ages = deals
      .filter((deal) => deal.stage === stage.id && Number.isFinite(deal.daysInStage) && deal.daysInStage >= 0)
      .map((deal) => deal.daysInStage);
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
      && (member.level === 1 || member.role === 'Sales Representative' || member.role === 'Pre-Sales')
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
