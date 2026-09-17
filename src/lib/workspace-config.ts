export const REQUIRED_WORKSPACE_CONFIG_KEYS = [
  'pipeline_stages',
  'deal_sources',
  'deal_loss_reasons',
  'disqualification_reasons',
  'proposal_rejection_reasons',
  'prospect_industries',
  'employee_sizes',
  'it_budget_ranges',
  'hr_budget_ranges',
  'buying_timelines',
  'access_roles',
  'analytics_settings',
  'pipeline_settings',
  'notification_rules',
  'product_catalog',
] as const;

export type WorkspaceConfigKey = (typeof REQUIRED_WORKSPACE_CONFIG_KEYS)[number];

export type WorkspaceConfigEntry = {
  key: WorkspaceConfigKey;
  value: unknown;
  updatedAt?: string;
};

export type Stage = { id: number; name: string; sla: number; prob: number };

export type AccessRole = {
  role: string;
  level: 1 | 2 | 3;
  label: string;
  description: string;
  default?: boolean;
};

export type ProposalRejectionReason = { label: string; terminal: boolean };

export type ProductCatalogItem = {
  category: string;
  name: string;
  description: string;
  fit: string;
};

export type NotificationRuleDefinition = {
  id: 'approve' | 'reject' | 'pending';
  label: string;
  defaultEnabled: boolean;
};

export type AnalyticsSettings = { minimumCompletedProjects: number };

export type PipelineValueBand = {
  label: string;
  tone: 'high' | 'medium' | 'low';
  minInclusive?: number;
  minExclusive?: number;
  maxExclusive?: number;
  maxInclusive?: number;
};

export type PipelineSettings = {
  defaultMovement: string;
  defaultStatus: string;
  proposalDecisionSource: string;
  outcomeEscalationDays: number;
  closeDateCriticalDays: number;
  closeDateWarningDays: number;
  valueBands: PipelineValueBand[];
};

export type ProspectOptions = {
  industries: string[];
  employeeSizes: string[];
  itBudgetRanges: string[];
  hrBudgetRanges: string[];
  buyingTimelines: string[];
};

export function workspaceConfigValue<T>(
  rows: readonly WorkspaceConfigEntry[],
  key: WorkspaceConfigKey
): T | undefined {
  return rows.find((row) => row.key === key)?.value as T | undefined;
}

export function missingWorkspaceConfigKeys(rows: readonly { key: string }[]) {
  const present = new Set(rows.map((row) => row.key));
  return REQUIRED_WORKSPACE_CONFIG_KEYS.filter((key) => !present.has(key));
}
