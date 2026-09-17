/* Shared, database-hydrated application data.

   AppShell refreshes every collection from Supabase before protected pages
   render. The in-memory cache is replaced by each database hydration; an
   absent collection is empty and never replaced with sample records. */
import { currentLevel, currentUser, currentUserId } from './role';
import { queueDataSync } from './data-sync';
import { readCollectionCache, replaceCollectionCache } from './data-cache';
import type { DataCollection } from './integrations';
import {
  latestLiveProposalVersions,
  rejectionReasonStats,
  visibleProposalVersionsForOwner,
} from './proposal-lifecycle';
import { mergeProposalSnapshot, type DataChangeOptions } from './data-changes';
import { calculateTwoStageRates } from './stage-rates';
import { collectRepNames } from './analytics-metrics';
import {
  dealDaysInStage,
  dealNeedsOutcome,
  dealOutcomeEscalated,
  dealOutcomeOverdueDays,
  outcomeHygieneByRep,
  stageEnteredDateFromDays,
} from './deal-outcomes';
import type { ClosedDealOutcome, ProposalDealOutcome } from './deal-outcomes';
import {
  workspaceConfigValue,
  type AccessRole,
  type AnalyticsSettings,
  type NotificationRuleDefinition,
  type PipelineSettings,
  type ProductCatalogItem,
  type ProposalRejectionReason,
  type ProspectOptions,
  type Stage,
  type WorkspaceConfigEntry,
  type WorkspaceConfigKey,
} from './workspace-config';

export { currentLevel, currentUser, currentUserId };
export type { ClosedDealOutcome, DealOutcome, ProposalDealOutcome } from './deal-outcomes';
export type {
  AccessRole,
  NotificationRuleDefinition,
  PipelineSettings,
  ProductCatalogItem,
  ProposalRejectionReason,
  ProspectOptions,
  Stage,
  WorkspaceConfigEntry,
};

export type ClosedDeal = {
  id?: string;
  ownerId?: string;
  prospectId?: number;
  caseId?: string;
  opportunityId?: string;
  rep: string;
  account: string;
  value: number;
  closeDate: string;
  source: string;
  outcome: ClosedDealOutcome;
  lossReason: string;
  disqualificationReason?: string;
  closedById?: string;
  closedBy?: string;
  closedAt?: string;
  disqualificationRequestedById?: string;
  disqualificationRequestedBy?: string;
  disqualificationRequestedAt?: string;
  disqualificationApprovedById?: string;
  disqualificationApprovedBy?: string;
  disqualificationApprovedAt?: string;
};

export type Deal = {
  id?: string;
  ownerId?: string;
  prospectId?: number;
  caseId?: string;
  opportunityId?: string;
  rep: string;
  account: string;
  outcome: 'Open';
  stage: number;
  stageEnteredOn?: string;
  /** Legacy database compatibility; the live value is derived from stageEnteredOn. */
  daysInStage: number;
  daysToClose: number;
  closeDate?: string;
  value: number;
  movement: string;
  status: string;
  notes: string;
  updatedAt?: string;
  pendingDisqualificationReason?: string;
  pendingCloseSource?: string;
  pendingCloseDate?: string;
  closeRequestedById?: string;
  closeRequestedBy?: string;
  closeRequestedAt?: string;
};

export type TeamMember = {
  id?: string;
  name: string;
  email: string;
  role: string;
  level?: 1 | 2 | 3;
  status: string;
  lastActive: string;
};

export type AIResearch = {
  companyBackground?: string;
  estimatedRevenue?: string;
  estimatedITSpend?: string;
  estimatedHRSpend?: string;
  employeeSize?: string;
  decisionMaker?: string;
  buyingPotential?: string;
  buyingPotentialReason?: string;
  sources?: { title: string; url: string }[];
  raw?: string;
};

export type Prospect = {
  id: number;
  name: string;
  type: string;
  country: string;
  website: string;
  added: string;
  status?: 'Active' | 'Inactive';
  tags: string[];
  employees: string;
  painPoints: string[];
  contact?: string;
  authority?: string;
  itBudget?: string;
  hrBudget?: string;
  timeline?: string;
  ownerId?: string;
  currentSystem?: string;
  currentModule?: string;
  aiResearch?: AIResearch | null;
  watched?: boolean;
  notes?: string;
};

export type ProposalStatus =
  | 'Draft'
  | 'Pending Review'
  | 'Approved'
  | 'Reject & Revise'
  | 'Reject & Close'
  | 'Superseded';

export type Proposal = {
  id: string;
  caseId: string;
  opportunityId: string;
  version: number;
  company: string;
  deal: string;
  value: number;
  submittedBy: string;
  owner: string;
  generatedDate: string;
  submittedDate: string;
  status: ProposalStatus;
  reviewer: string;
  reviewedDate: string;
  ownerId?: string;
  submittedById?: string;
  reviewerId?: string;
  rejectionReason: string;
  reviewNote: string;
  lastUpdated: string;
  updatedAt?: string;
  sections: { executive: string; solution: string; commercials: string };
  outcome?: ProposalDealOutcome;
  dealId?: string;
  dealLinkAction?: 'attached' | 'created';
  dealLinkedAt?: string;
  prospectId?: number;
};

export type NotificationPreference = {
  eventType: 'approve' | 'reject' | 'pending';
  enabled: boolean;
  updatedAt?: string;
};

export type ComplianceRow = {
  id: number;
  ownerId?: string;
  documentName: string;
  rowNumber: number;
  requirement: string;
  answer: string;
  confidence: 'High' | 'Medium' | 'Low' | '';
  reason: string;
  sourceReference: string;
  updatedAt?: string;
};

function collection<T>(name: DataCollection): T[] {
  return readCollectionCache<T>(name);
}

function write(name: DataCollection, value: unknown[], options: DataChangeOptions = {}) {
  if (typeof window === 'undefined') return Promise.resolve(false);
  const previous = readCollectionCache<unknown>(name);
  const cacheValue = name === 'proposals'
    ? mergeProposalSnapshot(previous, value, options.proposalDeleteIds)
    : value;
  replaceCollectionCache(name, cacheValue);
  window.dispatchEvent(new Event('rams:data-changed'));
  return queueDataSync(name, previous, cacheValue, options);
}

export function getProposals(): Proposal[] {
  return collection<Proposal>('proposals');
}

export function saveProposals(
  list: Proposal[],
  options: { deletedIds?: readonly string[]; suppressSyncError?: boolean } = {}
) {
  return write('proposals', list, {
    proposalDeleteIds: options.deletedIds,
    suppressSyncError: options.suppressSyncError,
  });
}

/** Kept as the stable proposal-store API; it never seeds or fabricates rows. */
export function ensureProposalStore(): Proposal[] {
  return getProposals();
}

export function getDeals(): Deal[] {
  return collection<Deal>('deals').map((deal) => {
    const stageEnteredOn = deal.stageEnteredOn || stageEnteredDateFromDays(deal.daysInStage);
    return {
      ...deal,
      stageEnteredOn,
      daysInStage: dealDaysInStage({ stageEnteredOn, daysInStage: deal.daysInStage }),
    };
  });
}

export const saveDeals = (list: Deal[], options: DataChangeOptions = {}) =>
  write('deals', list, options);

export const getClosedDeals = () => collection<ClosedDeal>('closedDeals');
export const saveClosedDeals = (list: ClosedDeal[], options: DataChangeOptions = {}) =>
  write('closedDeals', list, options);

export const getProspects = () => collection<Prospect>('prospects').map((prospect) => ({
  ...prospect,
  status: prospect.status === 'Inactive' ? 'Inactive' as const : 'Active' as const,
}));

export const saveProspects = (
  list: Prospect[],
  options: { deletedIds?: readonly number[]; suppressSyncError?: boolean } = {}
) => write('prospects', list, {
  prospectDeleteIds: options.deletedIds,
  suppressSyncError: options.suppressSyncError,
});

export const getTeam = () => collection<TeamMember>('team');
export const saveTeam = (list: TeamMember[]) => write('team', list);

export const getWorkspaceConfig = () => collection<WorkspaceConfigEntry>('workspaceConfig');

export function saveWorkspaceConfigValue(key: WorkspaceConfigKey, value: unknown) {
  const rows = getWorkspaceConfig();
  const existing = rows.find((row) => row.key === key);
  const next = existing
    ? rows.map((row) => row.key === key ? { ...row, value } : row)
    : [...rows, { key, value }];
  return write('workspaceConfig', next);
}

function stringList(key: WorkspaceConfigKey) {
  const value = workspaceConfigValue<unknown>(getWorkspaceConfig(), key);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function getStages(): Stage[] {
  const value = workspaceConfigValue<unknown>(getWorkspaceConfig(), 'pipeline_stages');
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Stage => {
    if (!item || typeof item !== 'object') return false;
    const row = item as Partial<Stage>;
    return Number.isInteger(row.id) && typeof row.name === 'string'
      && Number.isFinite(row.sla) && Number.isFinite(row.prob);
  });
}

export const getDealSources = () => stringList('deal_sources');
export const getDealLossReasons = () => stringList('deal_loss_reasons');
export const getDisqualificationReasons = () => stringList('disqualification_reasons');

export function getProposalRejectionReasons(): ProposalRejectionReason[] {
  const value = workspaceConfigValue<unknown>(getWorkspaceConfig(), 'proposal_rejection_reasons');
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ProposalRejectionReason =>
    Boolean(item) && typeof item === 'object'
      && typeof (item as ProposalRejectionReason).label === 'string'
      && typeof (item as ProposalRejectionReason).terminal === 'boolean'
  );
}

export function getProspectOptions(): ProspectOptions {
  return {
    industries: stringList('prospect_industries'),
    employeeSizes: stringList('employee_sizes'),
    itBudgetRanges: stringList('it_budget_ranges'),
    hrBudgetRanges: stringList('hr_budget_ranges'),
    buyingTimelines: stringList('buying_timelines'),
  };
}

export function getAccessRoles(): AccessRole[] {
  const value = workspaceConfigValue<unknown>(getWorkspaceConfig(), 'access_roles');
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is AccessRole => {
    if (!item || typeof item !== 'object') return false;
    const row = item as Partial<AccessRole>;
    return typeof row.role === 'string' && (row.level === 1 || row.level === 2 || row.level === 3)
      && typeof row.label === 'string' && typeof row.description === 'string';
  });
}

export function getAnalyticsMinimum(): number {
  const value = workspaceConfigValue<AnalyticsSettings>(getWorkspaceConfig(), 'analytics_settings');
  const minimum = Number(value?.minimumCompletedProjects);
  return Number.isInteger(minimum) && minimum > 0 ? minimum : 0;
}

export function getPipelineSettings(): PipelineSettings | null {
  const value = workspaceConfigValue<Partial<PipelineSettings>>(
    getWorkspaceConfig(),
    'pipeline_settings'
  );
  const outcomeEscalationDays = Number(value?.outcomeEscalationDays);
  const closeDateCriticalDays = Number(value?.closeDateCriticalDays);
  const closeDateWarningDays = Number(value?.closeDateWarningDays);
  if (!value || typeof value.defaultMovement !== 'string'
      || typeof value.defaultStatus !== 'string'
      || typeof value.proposalDecisionSource !== 'string'
      || !Number.isInteger(outcomeEscalationDays)
      || !Number.isInteger(closeDateCriticalDays)
      || !Number.isInteger(closeDateWarningDays)
      || !Array.isArray(value.valueBands)) {
    return null;
  }
  const valueBands = value.valueBands.filter((band) =>
    Boolean(band) && typeof band === 'object'
      && typeof band.label === 'string'
      && ['high', 'medium', 'low'].includes(band.tone)
      && (band.minInclusive == null || Number.isFinite(band.minInclusive))
      && (band.minExclusive == null || Number.isFinite(band.minExclusive))
      && (band.maxExclusive == null || Number.isFinite(band.maxExclusive))
      && (band.maxInclusive == null || Number.isFinite(band.maxInclusive))
  );
  if (!valueBands.length || outcomeEscalationDays <= 0
      || closeDateCriticalDays < 0
      || closeDateWarningDays < closeDateCriticalDays) {
    return null;
  }
  return {
    defaultMovement: value.defaultMovement,
    defaultStatus: value.defaultStatus,
    proposalDecisionSource: value.proposalDecisionSource,
    outcomeEscalationDays,
    closeDateCriticalDays,
    closeDateWarningDays,
    valueBands,
  };
}

export function getProductCatalog(): ProductCatalogItem[] {
  const value = workspaceConfigValue<unknown>(getWorkspaceConfig(), 'product_catalog');
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ProductCatalogItem => {
    if (!item || typeof item !== 'object') return false;
    const row = item as Partial<ProductCatalogItem>;
    return ['category', 'name', 'description', 'fit'].every(
      (key) => typeof row[key as keyof ProductCatalogItem] === 'string'
    );
  });
}

export function getNotificationRuleDefinitions(): NotificationRuleDefinition[] {
  const value = workspaceConfigValue<unknown>(getWorkspaceConfig(), 'notification_rules');
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is NotificationRuleDefinition => {
    if (!item || typeof item !== 'object') return false;
    const row = item as Partial<NotificationRuleDefinition>;
    return (row.id === 'approve' || row.id === 'reject' || row.id === 'pending')
      && typeof row.label === 'string' && typeof row.defaultEnabled === 'boolean';
  });
}

export const getNotificationPreferences = () =>
  collection<NotificationPreference>('notificationPreferences');
export const saveNotificationPreferences = (list: NotificationPreference[]) =>
  write('notificationPreferences', list);

export const getComplianceRows = () => collection<ComplianceRow>('complianceRows');
export const saveComplianceRows = (list: ComplianceRow[]) => write('complianceRows', list);

/** Resolve a cached display name only when it identifies exactly one profile. */
export function profileIdForName(name: string): string | undefined {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return undefined;
  const ids = new Set(
    getTeam()
      .filter((profile) => profile.id && profile.name.trim().toLowerCase() === normalized)
      .map((profile) => profile.id as string)
  );
  return ids.size === 1 ? [...ids][0] : undefined;
}

export const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

export function getReps(): string[] {
  return collectRepNames({
    team: getTeam(),
    deals: getDeals(),
    closedDeals: getClosedDeals(),
    proposals: getProposals(),
  });
}

export type Stats = ReturnType<typeof stats>;

export function stats(user?: string) {
  const who = user || currentUser();
  const whoId = user ? profileIdForName(user) : currentUserId();
  const store = ensureProposalStore();
  const cur = latestLiveProposalVersions(store);
  const mine = visibleProposalVersionsForOwner(cur, who, whoId);
  const deals = getDeals();
  const closed = getClosedDeals();
  const stages = getStages();
  const pipelineSettings = getPipelineSettings();
  const outcomeEscalationDays = pipelineSettings?.outcomeEscalationDays || 0;
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const myDeals = deals.filter((deal) =>
    whoId && deal.ownerId ? deal.ownerId === whoId : deal.rep === who
  );

  const stageRates = calculateTwoStageRates(store);
  const closedWon = closed.filter((deal) => deal.outcome === 'Won');
  const closedLost = closed.filter((deal) => deal.outcome === 'Lost');
  const stalled = deals.filter((deal) => {
    const stage = stageById.get(deal.stage);
    return stage && dealDaysInStage(deal) > stage.sla;
  });
  const needsOutcome = deals.filter((deal) => dealNeedsOutcome(deal));
  const prioritizedNeedsOutcome = needsOutcome.slice().sort((a, b) =>
    Number(dealOutcomeEscalated(b, new Date(), outcomeEscalationDays))
      - Number(dealOutcomeEscalated(a, new Date(), outcomeEscalationDays))
      || dealOutcomeOverdueDays(b) - dealOutcomeOverdueDays(a)
  );
  const attentionDealIds = new Set(prioritizedNeedsOutcome.map((deal) => deal.id || deal));
  const attentionDeals = [
    ...prioritizedNeedsOutcome,
    ...stalled.filter((deal) => !attentionDealIds.has(deal.id || deal)),
  ];
  const myNeedsOutcome = myDeals.filter((deal) => dealNeedsOutcome(deal));
  const { reasons, topReason } = rejectionReasonStats(store);

  return {
    user: who,
    store,
    cur,
    mine,
    deals,
    closed,
    stages,
    minimumCompletedProjects: getAnalyticsMinimum(),
    outcomeEscalationDays,
    myDeals,
    prospects: getProspects(),
    pending: cur.filter((proposal) => proposal.status === 'Pending Review').length,
    myPending: mine.filter((proposal) => proposal.status === 'Pending Review').length,
    myDrafts: mine.filter((proposal) => proposal.status === 'Draft').length,
    myRevise: mine.filter((proposal) => proposal.status === 'Reject & Revise').length,
    myApproved: mine.filter((proposal) => proposal.status === 'Approved').length,
    ...stageRates,
    wonValue: closedWon.reduce((sum, deal) => sum + deal.value, 0),
    lostValue: closedLost.reduce((sum, deal) => sum + deal.value, 0),
    pipelineValue: deals.reduce((sum, deal) => sum + deal.value, 0),
    myPipelineValue: myDeals.reduce((sum, deal) => sum + deal.value, 0),
    weighted: deals.reduce(
      (sum, deal) => sum + deal.value * (stageById.get(deal.stage)?.prob || 0),
      0
    ),
    stalled,
    needsOutcome,
    myNeedsOutcome,
    escalatedOutcomeDeals: needsOutcome.filter((deal) =>
      dealOutcomeEscalated(deal, new Date(), outcomeEscalationDays)
    ),
    attentionDeals,
    outcomeHygiene: outcomeHygieneByRep(deals, new Date(), outcomeEscalationDays),
    topReason,
    reasons,
  };
}

export function fmtRM(value: number | null | undefined) {
  if (!value && value !== 0) return '—';
  return value >= 1e6
    ? `RM ${(value / 1e6).toFixed(2)}M`
    : `RM ${Number(value).toLocaleString()}`;
}
