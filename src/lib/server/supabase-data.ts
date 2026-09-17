import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AIResearch,
  ClosedDeal,
  ComplianceRow,
  Deal,
  NotificationPreference,
  Proposal,
  ProposalStatus,
  Prospect,
  TeamMember,
  WorkspaceConfigEntry,
} from '@/lib/data';
import type { DataCollection } from '@/lib/integrations';
import {
  dealDaysInStage,
  daysUntilDealClose,
  localDateKey,
  stageEnteredDateFromDays,
} from '@/lib/deal-outcomes';
import {
  ProfileResolutionError,
  resolveProfileIdFromWire,
} from '@/lib/profile-identity';
import type { Database, Json, Tables } from '@/lib/supabase/database.types';
import {
  missingWorkspaceConfigKeys,
  REQUIRED_WORKSPACE_CONFIG_KEYS,
  type AccessRole,
  type WorkspaceConfigKey,
} from '@/lib/workspace-config';
import {
  deleteDraftProposalRows,
  writeProposalRows,
} from '@/lib/server/proposal-writer';

type Client = SupabaseClient<Database>;
type ProfileRow = Tables<'profiles'>;
type ProfileLookupRow = Pick<ProfileRow, 'id' | 'full_name' | 'email' | 'status'>;
type ProfilesLoader = () => Promise<ProfileLookupRow[]>;

export type DataChangeSet = {
  upserts: unknown[];
  deletes: unknown[];
};

/** A deliberate, safe-to-show rejection — as opposed to a raw database error. */
export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

type SupabaseOperationError = {
  code?: string;
  details?: string | null;
  hint?: string | null;
  message: string;
};

/** Preserve stable Postgres/PostgREST fields for the API error mapper. */
export class SupabaseDataError extends Error {
  readonly code?: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(context: string, error: SupabaseOperationError) {
    super(`${context}: ${error.message}`);
    this.name = 'SupabaseDataError';
    this.code = error.code;
    this.details = error.details ?? null;
    this.hint = error.hint ?? null;
  }
}

function fail(context: string, error: SupabaseOperationError | null) {
  if (error) throw new SupabaseDataError(context, error);
}

function displayDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function isoDate(value: unknown, fallback?: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString().slice(0, 10);
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AuthorizationError('Every data change must be an object.');
  }
  return value as Record<string, unknown>;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: unknown): boolean {
  return value === true;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

async function accessLevelForRole(client: Client, role: string): Promise<1 | 2 | 3> {
  const response = await client
    .from('workspace_config')
    .select('value')
    .eq('key', 'access_roles')
    .single();
  fail('Could not read access-role configuration', response.error);
  const definitions = Array.isArray(response.data?.value)
    ? response.data.value as unknown as AccessRole[]
    : [];
  const definition = definitions.find((item) => item.role === role);
  if (!definition || ![1, 2, 3].includes(definition.level)) {
    throw new AuthorizationError('Choose a role from the configured access-role list.');
  }
  return definition.level;
}

async function resolveProfileId(
  item: Record<string, unknown>,
  nameField: string,
  idField: string,
  loadProfiles: ProfilesLoader,
  fallback: string
) {
  try {
    return await resolveProfileIdFromWire(
      item,
      nameField,
      idField,
      async () =>
        (await loadProfiles()).map((profile) => ({
          id: profile.id,
          name: profile.full_name,
        })),
      fallback
    );
  } catch (error) {
    if (error instanceof ProfileResolutionError) {
      throw new AuthorizationError(error.message);
    }
    throw error;
  }
}

function proposalToDomain(row: Tables<'proposals'>): Proposal {
  return {
    id: row.id,
    caseId: row.case_id,
    opportunityId: row.opportunity_id,
    version: row.version,
    company: row.company,
    deal: row.deal,
    value: Number(row.value),
    submittedBy: row.submitted_by,
    submittedById: row.submitted_by_id,
    owner: row.owner,
    ownerId: row.owner_id,
    generatedDate: row.generated_on,
    submittedDate: displayDate(row.submitted_at),
    status: row.status as ProposalStatus,
    reviewer: row.reviewer,
    reviewerId: row.reviewer_id || undefined,
    reviewedDate: displayDate(row.reviewed_at),
    rejectionReason: row.rejection_reason,
    reviewNote: row.review_note,
    lastUpdated: displayDate(row.updated_at),
    updatedAt: row.updated_at,
    sections: (row.sections || {}) as Proposal['sections'],
    outcome: (row.outcome || undefined) as Proposal['outcome'],
    dealId: row.deal_id || undefined,
    dealLinkAction: (row.deal_link_action || undefined) as Proposal['dealLinkAction'],
    dealLinkedAt: row.deal_linked_at || undefined,
    prospectId: row.prospect_id ?? undefined,
  };
}

function dealToDomain(row: Tables<'deals'>): Deal {
  const closeDate = row.expected_close_date;
  const stageEnteredOn = row.stage_entered_on;
  return {
    id: row.id,
    ownerId: row.owner_id,
    prospectId: row.prospect_id ?? undefined,
    caseId: row.case_id || undefined,
    opportunityId: row.opportunity_id || undefined,
    rep: row.rep,
    account: row.account,
    outcome: 'Open',
    stage: row.stage,
    stageEnteredOn,
    daysInStage: dealDaysInStage({ stageEnteredOn, daysInStage: row.days_in_stage }),
    daysToClose: daysUntilDealClose({ closeDate, daysToClose: row.days_to_close }),
    closeDate,
    value: Number(row.value),
    movement: row.movement,
    status: row.status,
    notes: row.notes,
    updatedAt: row.updated_at,
    pendingDisqualificationReason: row.pending_disqualification_reason || undefined,
    pendingCloseSource: row.pending_close_source || undefined,
    pendingCloseDate: row.pending_close_date || undefined,
    closeRequestedById: row.close_requested_by_id || undefined,
    closeRequestedBy: row.close_requested_by || undefined,
    closeRequestedAt: row.close_requested_at || undefined,
  };
}

function closedDealToDomain(row: Tables<'closed_deals'>): ClosedDeal {
  return {
    id: row.id,
    ownerId: row.owner_id,
    prospectId: row.prospect_id ?? undefined,
    caseId: row.case_id || undefined,
    opportunityId: row.opportunity_id || undefined,
    rep: row.rep,
    account: row.account,
    value: Number(row.value),
    closeDate: row.close_date,
    source: row.source,
    outcome: row.outcome as ClosedDeal['outcome'],
    lossReason: row.loss_reason,
    disqualificationReason: row.disqualification_reason || undefined,
    closedById: row.closed_by_id || undefined,
    closedBy: row.closed_by || undefined,
    closedAt: row.closed_at || undefined,
    disqualificationRequestedById: row.disqualification_requested_by_id || undefined,
    disqualificationRequestedBy: row.disqualification_requested_by || undefined,
    disqualificationRequestedAt: row.disqualification_requested_at || undefined,
    disqualificationApprovedById: row.disqualification_approved_by_id || undefined,
    disqualificationApprovedBy: row.disqualification_approved_by || undefined,
    disqualificationApprovedAt: row.disqualification_approved_at || undefined,
  };
}

function prospectToDomain(row: Tables<'prospects'>): Prospect {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    type: row.type,
    country: row.country,
    website: row.website,
    added: displayDate(row.added_on),
    status: row.status === 'Inactive' ? 'Inactive' : 'Active',
    tags: row.tags,
    employees: row.employees,
    painPoints: row.pain_points,
    contact: row.contact || undefined,
    authority: row.authority || undefined,
    itBudget: row.it_budget || undefined,
    hrBudget: row.hr_budget || undefined,
    timeline: row.timeline || undefined,
    currentSystem: row.current_system || undefined,
    currentModule: row.current_module || undefined,
    aiResearch: (row.ai_research || null) as AIResearch | null,
    watched: row.watched,
    notes: row.notes,
  };
}

function workspaceConfigToDomain(row: Tables<'workspace_config'>): WorkspaceConfigEntry {
  return {
    key: row.key as WorkspaceConfigKey,
    value: row.value,
    updatedAt: row.updated_at,
  };
}

function notificationPreferenceToDomain(
  row: Tables<'notification_preferences'>
): NotificationPreference {
  return {
    eventType: row.event_type as NotificationPreference['eventType'],
    enabled: row.enabled,
    updatedAt: row.updated_at,
  };
}

function complianceRowToDomain(row: Tables<'compliance_rows'>): ComplianceRow {
  return {
    id: row.id,
    ownerId: row.owner_id,
    documentName: row.document_name,
    rowNumber: row.row_number,
    requirement: row.requirement,
    answer: row.answer,
    confidence: (row.confidence || '') as ComplianceRow['confidence'],
    reason: row.reason,
    sourceReference: row.source_reference,
    updatedAt: row.updated_at,
  };
}

function profileToDomain(row: ProfileRow): TeamMember {
  return {
    id: row.id,
    name: row.full_name,
    email: row.email,
    role: row.role,
    level: row.level as TeamMember['level'],
    status: row.status,
    lastActive: row.last_active ? displayDate(row.last_active) : 'Never',
  };
}

export async function readAllSupabaseData(client: Client, userId: string) {
  const [
    proposals,
    deals,
    closedDeals,
    prospects,
    profiles,
    workspaceConfig,
    notificationPreferences,
    complianceRows,
  ] = await Promise.all([
    client.from('proposals').select('*').order('created_at', { ascending: true }),
    client.from('deals').select('*').order('created_at', { ascending: true }),
    client.from('closed_deals').select('*').order('close_date', { ascending: true }),
    client
      .from('prospects')
      .select('id, owner_id, name, type, country, website, added_on, status, tags, employees, pain_points, contact, authority, it_budget, hr_budget, timeline, current_system, current_module, ai_research, watched, notes, created_at, updated_at')
      .order('created_at', { ascending: true }),
    client.from('profiles').select('*').order('full_name', { ascending: true }),
    client.from('workspace_config').select('*').order('key', { ascending: true }),
    client.from('notification_preferences').select('*').order('event_type', { ascending: true }),
    client.from('compliance_rows').select('*').order('document_name', { ascending: true }).order('row_number', { ascending: true }),
  ]);

  fail('Could not read proposals', proposals.error);
  fail('Could not read deals', deals.error);
  fail('Could not read closed deals', closedDeals.error);
  fail('Could not read prospects', prospects.error);
  fail('Could not read profiles', profiles.error);
  fail('Could not read workspace configuration', workspaceConfig.error);
  fail('Could not read notification preferences', notificationPreferences.error);
  fail('Could not read compliance rows', complianceRows.error);

  const missingConfig = missingWorkspaceConfigKeys(workspaceConfig.data || []);
  if (missingConfig.length) {
    throw new Error(`Workspace configuration is incomplete: ${missingConfig.join(', ')}.`);
  }

  const profileRows = profiles.data || [];
  const ownProfile = profileRows.find((profile) => profile.id === userId);
  if (!ownProfile) throw new Error('The signed-in user has no application profile.');

  return {
    profile: profileToDomain(ownProfile),
    collections: {
      proposals: (proposals.data || []).map(proposalToDomain),
      deals: (deals.data || []).map(dealToDomain),
      closedDeals: (closedDeals.data || []).map(closedDealToDomain),
      prospects: (prospects.data || []).map(prospectToDomain),
      team: profileRows.map(profileToDomain),
      workspaceConfig: (workspaceConfig.data || []).map(workspaceConfigToDomain),
      notificationPreferences: (notificationPreferences.data || []).map(notificationPreferenceToDomain),
      complianceRows: (complianceRows.data || []).map(complianceRowToDomain),
    },
  };
}

/**
 * Batch-write rows to one table in as few statements as possible.
 * PostgREST's bulk insert/upsert derives its column list from the FIRST
 * object in the array, so rows with different key sets (e.g. some carry an
 * explicit `id`, some rely on the column default) must never share a call
 * or the odd-shaped rows silently lose columns. Group by exact key
 * signature first before batching an upsert or insert for each shape.
 */
function groupByShape<Row extends Record<string, unknown>>(rows: Row[]): Row[][] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const shape = Object.keys(row).sort().join(' ');
    const group = groups.get(shape);
    if (group) group.push(row);
    else groups.set(shape, [row]);
  }
  return Array.from(groups.values());
}

async function bulkWriteDeals(client: Client, rows: Database['public']['Tables']['deals']['Insert'][]) {
  for (const group of groupByShape(rows)) {
    const response = 'id' in group[0]
      ? await client.from('deals').upsert(group, { onConflict: 'id' })
      : await client.from('deals').insert(group);
    fail('Could not save deals', response.error);
  }
}

async function bulkWriteClosedDeals(client: Client, rows: Database['public']['Tables']['closed_deals']['Insert'][]) {
  for (const group of groupByShape(rows)) {
    const response = 'id' in group[0]
      ? await client.from('closed_deals').upsert(group, { onConflict: 'id' })
      : await client.from('closed_deals').insert(group);
    fail('Could not save closed deals', response.error);
  }
}

async function bulkWriteProspects(client: Client, rows: Database['public']['Tables']['prospects']['Insert'][]) {
  for (const group of groupByShape(rows)) {
    const response = 'id' in group[0]
      ? await client.from('prospects').upsert(group, { onConflict: 'id' })
      : await client.from('prospects').insert(group);
    fail('Could not save prospects', response.error);
  }
}

async function bulkWriteWorkspaceConfig(
  client: Client,
  rows: Database['public']['Tables']['workspace_config']['Insert'][]
) {
  if (!rows.length) return;
  const response = await client.from('workspace_config').upsert(rows, { onConflict: 'key' });
  fail('Could not save workspace configuration', response.error);
}

async function bulkWriteNotificationPreferences(
  client: Client,
  rows: Database['public']['Tables']['notification_preferences']['Insert'][]
) {
  if (!rows.length) return;
  const response = await client
    .from('notification_preferences')
    .upsert(rows, { onConflict: 'user_id,event_type' });
  fail('Could not save notification preferences', response.error);
}

async function bulkWriteComplianceRows(
  client: Client,
  rows: Database['public']['Tables']['compliance_rows']['Insert'][]
) {
  for (const group of groupByShape(rows)) {
    const response = 'id' in group[0]
      ? await client.from('compliance_rows').upsert(group, { onConflict: 'id' })
      : await client.from('compliance_rows').insert(group);
    fail('Could not save compliance rows', response.error);
  }
}

async function buildProposalRow(
  value: unknown,
  userId: string,
  loadProfiles: ProfilesLoader
): Promise<Database['public']['Tables']['proposals']['Insert']> {
  const item = record(value);
  const submittedById = await resolveProfileId(item, 'submittedBy', 'submittedById', loadProfiles, userId);
  const ownerId = await resolveProfileId(item, 'owner', 'ownerId', loadProfiles, userId);
  const status = str(item.status, 'Draft');
  const isReviewDecision = ['Approved', 'Reject & Revise', 'Reject & Close'].includes(status);
  const actorProfile = isReviewDecision
    ? (await loadProfiles()).find((profile) => profile.id === userId && profile.status === 'active')
    : null;
  if (isReviewDecision && !actorProfile) {
    throw new AuthorizationError('The signed-in reviewer has no active application profile.');
  }
  // Audit identity comes from the authenticated session, never from fields a
  // browser can forge. The database trigger independently enforces the same.
  const reviewerName = actorProfile?.full_name || '';
  const reviewerId = actorProfile?.id || null;
  const row: Database['public']['Tables']['proposals']['Insert'] = {
    company: str(item.company),
    deal: str(item.deal),
    opportunity_id: str(item.opportunityId),
    version: Math.max(1, Math.trunc(num(item.version, 1))),
    value: Math.max(0, num(item.value)),
    submitted_by_id: submittedById,
    submitted_by: str(item.submittedBy),
    owner_id: ownerId,
    owner: str(item.owner),
    generated_on: isoDate(item.generatedDate, new Date().toISOString().slice(0, 10)),
    submitted_at: isoTimestamp(item.submittedDate),
    status,
    reviewer_id: reviewerId,
    reviewer: reviewerName,
    reviewed_at: isoTimestamp(item.reviewedDate),
    rejection_reason: str(item.rejectionReason),
    review_note: str(item.reviewNote),
    sections: (item.sections || {}) as Json,
    outcome: str(item.outcome) || null,
  };
  const id = str(item.id);
  const caseId = str(item.caseId);
  const dealId = str(item.dealId).trim();
  const updatedAt = str(item.updatedAt);
  const prospectId = Number(item.prospectId);
  if (id) row.id = id;
  if (caseId) row.case_id = caseId;
  if (dealId) row.deal_id = dealId;
  if (Number.isSafeInteger(prospectId) && prospectId > 0) row.prospect_id = prospectId;
  // This is an expected-version token only. proposal-writer removes it from
  // INSERT/UPDATE payloads and uses it in the existing-row CAS predicate.
  if (updatedAt) row.updated_at = updatedAt;
  return row;
}

async function buildDealRow(
  client: Client,
  value: unknown,
  userId: string,
  loadProfiles: ProfilesLoader
): Promise<Database['public']['Tables']['deals']['Insert']> {
  const item = record(value);
  const id = str(item.id);
  const legacyDaysInStage = Math.max(0, Math.trunc(num(item.daysInStage)));
  const stageEnteredOn = isoDate(item.stageEnteredOn)
    || stageEnteredDateFromDays(legacyDaysInStage);
  if (stageEnteredOn > localDateKey()) {
    throw new AuthorizationError('Stage entered on cannot be in the future.');
  }
  const closeDate = isoDate(item.closeDate);
  if (!closeDate) {
    throw new AuthorizationError('Choose a close date before saving the deal.');
  }
  const dealValue = Number(item.value);
  if (!Number.isFinite(dealValue) || dealValue < 0) {
    throw new AuthorizationError('Enter a valid deal value of zero or more.');
  }
  const stage = Math.trunc(Number(item.stage));
  const stageResponse = await client
    .from('workspace_config')
    .select('value')
    .eq('key', 'pipeline_stages')
    .single();
  fail('Could not read pipeline-stage configuration', stageResponse.error);
  const configuredStages = Array.isArray(stageResponse.data?.value)
    ? stageResponse.data.value as unknown as { id?: unknown }[]
    : [];
  if (!configuredStages.some((definition) => Number(definition.id) === stage)) {
    throw new AuthorizationError('Choose a stage from the configured pipeline-stage list.');
  }
  const movement = str(item.movement).trim();
  const status = str(item.status).trim();
  if (!movement || !status) {
    throw new AuthorizationError('The configured deal movement and status are required.');
  }
  const row: Database['public']['Tables']['deals']['Insert'] = {
    owner_id: await resolveProfileId(item, 'rep', 'ownerId', loadProfiles, userId),
    rep: str(item.rep),
    account: str(item.account),
    stage,
    stage_entered_on: stageEnteredOn,
    days_in_stage: dealDaysInStage({ stageEnteredOn, daysInStage: legacyDaysInStage }),
    // Legacy duration remains non-negative; expected_close_date is the source
    // of truth and may independently be in the past.
    days_to_close: Math.max(0, daysUntilDealClose({ closeDate, daysToClose: 0 })),
    expected_close_date: closeDate,
    value: dealValue,
    movement,
    status,
    notes: str(item.notes),
    pending_disqualification_reason: str(item.pendingDisqualificationReason) || null,
    pending_close_source: str(item.pendingCloseSource) || null,
    pending_close_date: isoDate(item.pendingCloseDate) || null,
    close_requested_by_id: str(item.closeRequestedById) || null,
    close_requested_by: str(item.closeRequestedBy) || null,
    close_requested_at: isoTimestamp(item.closeRequestedAt),
  };
  const prospectId = Number(item.prospectId);
  if (Number.isSafeInteger(prospectId) && prospectId > 0) row.prospect_id = prospectId;
  const opportunityId = str(item.opportunityId).trim();
  if (opportunityId) row.opportunity_id = opportunityId;
  if (id) row.id = id;
  return row;
}

async function buildClosedDealRow(
  value: unknown,
  userId: string,
  loadProfiles: ProfilesLoader
): Promise<Database['public']['Tables']['closed_deals']['Insert']> {
  const item = record(value);
  const id = str(item.id);
  const outcome = str(item.outcome);
  const closeDate = isoDate(item.closeDate);
  if (!['Won', 'Lost', 'Disqualified'].includes(outcome) || !closeDate) {
    throw new AuthorizationError('A closed deal needs a valid outcome and close date.');
  }
  const row: Database['public']['Tables']['closed_deals']['Insert'] = {
    owner_id: await resolveProfileId(item, 'rep', 'ownerId', loadProfiles, userId),
    rep: str(item.rep),
    account: str(item.account),
    value: Math.max(0, num(item.value)),
    close_date: closeDate,
    source: str(item.source),
    outcome,
    loss_reason: str(item.lossReason),
    disqualification_reason: str(item.disqualificationReason),
  };
  const prospectId = Number(item.prospectId);
  if (Number.isSafeInteger(prospectId) && prospectId > 0) row.prospect_id = prospectId;
  const caseId = str(item.caseId).trim();
  const opportunityId = str(item.opportunityId).trim();
  if (caseId) row.case_id = caseId;
  if (opportunityId) row.opportunity_id = opportunityId;
  if (id) row.id = id;
  return row;
}

function buildProspectRow(
  value: unknown,
  userId: string
): Database['public']['Tables']['prospects']['Insert'] {
  const item = record(value);
  const parsedId = Number(item.id);
  const id = Number.isFinite(parsedId) && parsedId > 0 ? Math.trunc(parsedId) : null;
  const row: Database['public']['Tables']['prospects']['Insert'] = {
    owner_id: str(item.ownerId, userId),
    name: str(item.name).trim(),
    type: str(item.type),
    country: str(item.country),
    website: str(item.website),
    added_on: isoDate(item.added, new Date().toISOString().slice(0, 10)),
    status: str(item.status) === 'Inactive' ? 'Inactive' : 'Active',
    tags: stringArray(item.tags),
    employees: str(item.employees),
    pain_points: stringArray(item.painPoints),
    contact: str(item.contact) || null,
    authority: str(item.authority) || null,
    it_budget: str(item.itBudget) || null,
    hr_budget: str(item.hrBudget) || null,
    timeline: str(item.timeline) || null,
    current_system: str(item.currentSystem) || null,
    current_module: str(item.currentModule) || null,
    ai_research: (item.aiResearch || null) as Json | null,
    watched: bool(item.watched),
    notes: str(item.notes),
  };
  if (id) row.id = id;
  return row;
}

function buildWorkspaceConfigRow(
  value: unknown
): Database['public']['Tables']['workspace_config']['Insert'] {
  const item = record(value);
  const key = str(item.key) as WorkspaceConfigKey;
  if (REQUIRED_WORKSPACE_CONFIG_KEYS.includes(key) && item.value != null
      && typeof item.value === 'object') {
    return { key, value: item.value as Json };
  }
  throw new AuthorizationError('Workspace configuration contains an unsupported or empty key.');
}

function buildNotificationPreferenceRow(
  value: unknown,
  userId: string
): Database['public']['Tables']['notification_preferences']['Insert'] {
  const item = record(value);
  const eventType = str(item.eventType);
  if (!['approve', 'reject', 'pending'].includes(eventType)) {
    throw new AuthorizationError('Notification preference contains an unsupported event type.');
  }
  return {
    user_id: userId,
    event_type: eventType,
    enabled: bool(item.enabled),
  };
}

function buildComplianceRow(
  value: unknown,
  userId: string
): Database['public']['Tables']['compliance_rows']['Insert'] {
  const item = record(value);
  const rowNumber = Math.trunc(num(item.rowNumber));
  const confidence = str(item.confidence);
  if (!str(item.documentName).trim() || rowNumber <= 0 || !str(item.requirement).trim()) {
    throw new AuthorizationError('Every compliance row needs a document, row number, and requirement.');
  }
  if (confidence && !['High', 'Medium', 'Low'].includes(confidence)) {
    throw new AuthorizationError('Compliance confidence must be High, Medium, Low, or empty.');
  }
  const row: Database['public']['Tables']['compliance_rows']['Insert'] = {
    owner_id: userId,
    document_name: str(item.documentName).trim(),
    row_number: rowNumber,
    requirement: str(item.requirement).trim(),
    answer: str(item.answer),
    confidence: confidence || null,
    reason: str(item.reason),
    source_reference: str(item.sourceReference),
  };
  const id = Number(item.id);
  if (Number.isSafeInteger(id) && id > 0) row.id = id;
  return row;
}

async function updateProfile(client: Client, value: unknown, loadProfiles: ProfilesLoader) {
  const item = record(value);
  const explicitId = str(item.id);
  const email = str(item.email);
  const id = explicitId || (email ? (await loadProfiles()).find((profile) => profile.email === email)?.id : undefined);
  if (!id) throw new AuthorizationError('A profile update needs an existing profile id or email.');
  const name = str(item.name);
  const role = str(item.role).trim();
  if (!role) throw new AuthorizationError('Choose a configured access role.');
  const parts = name.trim().split(/\s+/);
  const row: Database['public']['Tables']['profiles']['Update'] = {
    first_name: parts[0] || '',
    last_name: parts.slice(1).join(' '),
    full_name: name,
    role,
    level: await accessLevelForRole(client, role),
    status: str(item.status, 'active'),
  };
  const response = await client.from('profiles').update(row).eq('id', id);
  fail('Could not update profile', response.error);
}

async function assertProspectsCanBeDeleted(client: Client, ids: number[]) {
  const prospects = await client
    .from('prospects')
    .select('id, name')
    .in('id', ids);
  fail('Could not verify prospect dependencies', prospects.error);

  const rows = prospects.data || [];
  if (rows.length !== ids.length) {
    throw new AuthorizationError('You do not have permission to delete this prospect.');
  }

  const [linkedDeals, proposals, closedDeals] = await Promise.all([
    client.from('deals').select('id, prospect_id').in('prospect_id', ids),
    client.from('proposals').select('id, prospect_id').in('prospect_id', ids),
    client.from('closed_deals').select('id, prospect_id').in('prospect_id', ids),
  ]);
  fail('Could not verify linked deals', linkedDeals.error);
  fail('Could not verify linked proposals', proposals.error);
  fail('Could not verify closed deals', closedDeals.error);

  const stableDealProspectIds = new Set((linkedDeals.data || []).map((deal) => deal.prospect_id));
  const proposalProspectIds = new Set((proposals.data || []).map((proposal) => proposal.prospect_id));
  const closedDealProspectIds = new Set((closedDeals.data || []).map((deal) => deal.prospect_id));
  const blocked = rows.find((prospect) => {
    return stableDealProspectIds.has(prospect.id) ||
      proposalProspectIds.has(prospect.id) || closedDealProspectIds.has(prospect.id);
  });

  if (blocked) {
    throw new AuthorizationError(
      `"${blocked.name}" has linked work and cannot be deleted. Set it to Inactive instead.`
    );
  }
}

async function deleteRecords(client: Client, collection: DataCollection, values: unknown[]) {
  if (!values.length) return;
  if (collection === 'team' || collection === 'workspaceConfig'
      || collection === 'notificationPreferences' || collection === 'complianceRows') {
    throw new AuthorizationError(`${collection} records cannot be deleted through this route.`);
  }
  const table = collection === 'closedDeals' ? 'closed_deals' : collection;
  if (table === 'prospects') {
    const numericIds = values.map((value) => Number(record(value).id));
    if (numericIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      throw new AuthorizationError('Every deleted prospect needs a valid numeric database id.');
    }
    await assertProspectsCanBeDeleted(client, numericIds);
    const response = await client.from('prospects').delete().in('id', numericIds).select('id');
    fail('Could not delete prospects', response.error);
    if ((response.data || []).length !== numericIds.length) {
      throw new AuthorizationError('The prospect was not deleted. Refresh the page and try again.');
    }
    return;
  }

  if (table === 'proposals') {
    const rows = values.map((value) => ({
      id: str(record(value).id),
      updated_at: str(record(value).updatedAt),
    }));
    if (rows.some((row) => !row.id || !row.updated_at)) {
      throw new AuthorizationError(
        'Only current draft proposals can be deleted. Refresh the latest data and try again.'
      );
    }
    await deleteDraftProposalRows(client, rows, fail);
    return;
  }

  const ids = values.map((value) => str(record(value).id)).filter(Boolean);
  if (ids.length !== values.length) {
    throw new AuthorizationError(`Every deleted ${collection} record needs its database id.`);
  }
  if (table === 'deals') {
    const response = await client.from('deals').delete().in('id', ids);
    fail('Could not delete deals', response.error);
  } else {
    const response = await client.from('closed_deals').delete().in('id', ids);
    fail('Could not delete closed deals', response.error);
  }
}

function assertProposalChangeShape(changes: DataChangeSet) {
  const { upserts, deletes } = changes;
  const logicalChangeError = () => {
    throw new AuthorizationError('A proposal request must contain exactly one logical change.');
  };

  if ((upserts.length && deletes.length) || deletes.length > 1 || upserts.length > 2) {
    logicalChangeError();
  }
  if (upserts.length !== 2) return;

  const values = upserts.map(record);
  const predecessor = values.find((value) => str(value.status) === 'Superseded');
  const replacement = values.find((value) => str(value.status) === 'Pending Review');
  if (!predecessor || !replacement ||
      !str(predecessor.id) || !str(replacement.id) ||
      str(predecessor.id) === str(replacement.id) ||
      !str(predecessor.caseId) || str(predecessor.caseId) !== str(replacement.caseId) ||
      Math.trunc(num(replacement.version)) !== Math.trunc(num(predecessor.version)) + 1) {
    logicalChangeError();
  }
}

export async function writeSupabaseChanges(
  client: Client,
  userId: string,
  collection: DataCollection,
  changes: DataChangeSet
) {
  if (collection === 'proposals') assertProposalChangeShape(changes);

  let profilesPromise: Promise<ProfileLookupRow[]> | null = null;
  const loadProfiles: ProfilesLoader = () => {
    if (!profilesPromise) {
      profilesPromise = (async () => {
        const response = await client.from('profiles').select('id, full_name, email, status');
        fail('Could not resolve team ownership', response.error);
        return response.data || [];
      })();
    }
    return profilesPromise;
  };

  if (collection === 'team') {
    for (const value of changes.upserts) await updateProfile(client, value, loadProfiles);
  } else if (collection === 'proposals') {
    const rows = [];
    for (const value of changes.upserts) rows.push(await buildProposalRow(value, userId, loadProfiles));
    await writeProposalRows(client, rows, fail);
  } else if (collection === 'deals') {
    const rows = [];
    for (const value of changes.upserts) {
      rows.push(await buildDealRow(client, value, userId, loadProfiles));
    }
    await bulkWriteDeals(client, rows);
  } else if (collection === 'closedDeals') {
    const rows = [];
    for (const value of changes.upserts) rows.push(await buildClosedDealRow(value, userId, loadProfiles));
    await bulkWriteClosedDeals(client, rows);
  } else if (collection === 'prospects') {
    const rows = changes.upserts.map((value) => buildProspectRow(value, userId));
    await bulkWriteProspects(client, rows);
  } else if (collection === 'workspaceConfig') {
    await bulkWriteWorkspaceConfig(client, changes.upserts.map(buildWorkspaceConfigRow));
  } else if (collection === 'notificationPreferences') {
    await bulkWriteNotificationPreferences(
      client,
      changes.upserts.map((value) => buildNotificationPreferenceRow(value, userId))
    );
  } else {
    await bulkWriteComplianceRows(
      client,
      changes.upserts.map((value) => buildComplianceRow(value, userId))
    );
  }

  await deleteRecords(client, collection, changes.deletes);
  return { upserted: changes.upserts.length, deleted: changes.deletes.length };
}
