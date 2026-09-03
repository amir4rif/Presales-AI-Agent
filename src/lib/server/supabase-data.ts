import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AIResearch,
  ClosedDeal,
  Deal,
  Proposal,
  ProposalStatus,
  Prospect,
  TeamMember,
} from '@/lib/data';
import type { DataCollection } from '@/lib/integrations';
import {
  ProfileResolutionError,
  resolveProfileIdFromWire,
} from '@/lib/profile-identity';
import type { Database, Json, Tables } from '@/lib/supabase/database.types';
import { writeProposalRows } from '@/lib/server/proposal-writer';

type Client = SupabaseClient<Database>;
type ProfileRow = Tables<'profiles'>;
type ProfileLookupRow = Pick<ProfileRow, 'id' | 'full_name' | 'email'>;
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

function accessLevelForRole(role: string): 1 | 2 | 3 {
  if (role === 'Sales Manager') return 2;
  if (role === 'Sales Operations' || role === 'COO Office') return 3;
  return 1;
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
    sections: (row.sections || {}) as Proposal['sections'],
    outcome: (row.outcome || undefined) as Proposal['outcome'],
  };
}

function dealToDomain(row: Tables<'deals'>): Deal {
  return {
    id: row.id,
    ownerId: row.owner_id,
    rep: row.rep,
    account: row.account,
    stage: row.stage,
    daysInStage: row.days_in_stage,
    daysToClose: row.days_to_close,
    value: Number(row.value),
    movement: row.movement,
    status: row.status,
    notes: row.notes,
  };
}

function closedDealToDomain(row: Tables<'closed_deals'>): ClosedDeal {
  return {
    id: row.id,
    ownerId: row.owner_id,
    rep: row.rep,
    account: row.account,
    value: Number(row.value),
    closeDate: row.close_date,
    source: row.source,
    outcome: row.outcome as ClosedDeal['outcome'],
    lossReason: row.loss_reason,
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
    tags: row.tags,
    employees: row.employees,
    opportunities: row.opportunities,
    totalValue: Number(row.total_value),
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
  const [proposals, deals, closedDeals, prospects, profiles] = await Promise.all([
    client.from('proposals').select('*').order('created_at', { ascending: true }),
    client.from('deals').select('*').order('created_at', { ascending: true }),
    client.from('closed_deals').select('*').order('close_date', { ascending: true }),
    client.from('prospects').select('*').order('created_at', { ascending: true }),
    client.from('profiles').select('*').order('full_name', { ascending: true }),
  ]);

  fail('Could not read proposals', proposals.error);
  fail('Could not read deals', deals.error);
  fail('Could not read closed deals', closedDeals.error);
  fail('Could not read prospects', prospects.error);
  fail('Could not read profiles', profiles.error);

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

async function buildProposalRow(
  value: unknown,
  userId: string,
  loadProfiles: ProfilesLoader
): Promise<Database['public']['Tables']['proposals']['Insert']> {
  const item = record(value);
  const submittedById = await resolveProfileId(item, 'submittedBy', 'submittedById', loadProfiles, userId);
  const ownerId = await resolveProfileId(item, 'owner', 'ownerId', loadProfiles, userId);
  const reviewerName = str(item.reviewer);
  const reviewerId = reviewerName
    ? await resolveProfileId(item, 'reviewer', 'reviewerId', loadProfiles, userId)
    : null;
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
    status: str(item.status, 'Draft'),
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
  if (id) row.id = id;
  if (caseId) row.case_id = caseId;
  return row;
}

async function buildDealRow(
  value: unknown,
  userId: string,
  loadProfiles: ProfilesLoader
): Promise<Database['public']['Tables']['deals']['Insert']> {
  const item = record(value);
  const id = str(item.id);
  const row: Database['public']['Tables']['deals']['Insert'] = {
    owner_id: await resolveProfileId(item, 'rep', 'ownerId', loadProfiles, userId),
    rep: str(item.rep),
    account: str(item.account),
    stage: Math.min(8, Math.max(1, Math.trunc(num(item.stage, 1)))),
    days_in_stage: Math.max(0, Math.trunc(num(item.daysInStage))),
    days_to_close: Math.max(0, Math.trunc(num(item.daysToClose))),
    value: Math.max(0, num(item.value)),
    movement: str(item.movement),
    status: str(item.status, 'On Track'),
    notes: str(item.notes),
  };
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
  const row: Database['public']['Tables']['closed_deals']['Insert'] = {
    owner_id: await resolveProfileId(item, 'rep', 'ownerId', loadProfiles, userId),
    rep: str(item.rep),
    account: str(item.account),
    value: Math.max(0, num(item.value)),
    close_date: isoDate(item.closeDate, new Date().toISOString().slice(0, 10))!,
    source: str(item.source),
    outcome: str(item.outcome, 'Lost'),
    loss_reason: str(item.lossReason),
  };
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
    name: str(item.name),
    type: str(item.type),
    country: str(item.country),
    website: str(item.website),
    added_on: isoDate(item.added, new Date().toISOString().slice(0, 10)),
    tags: stringArray(item.tags),
    employees: str(item.employees),
    opportunities: Math.max(0, Math.trunc(num(item.opportunities))),
    total_value: Math.max(0, num(item.totalValue)),
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
  };
  if (id) row.id = id;
  return row;
}

async function updateProfile(client: Client, value: unknown, loadProfiles: ProfilesLoader) {
  const item = record(value);
  const explicitId = str(item.id);
  const email = str(item.email);
  const id = explicitId || (email ? (await loadProfiles()).find((profile) => profile.email === email)?.id : undefined);
  if (!id) throw new AuthorizationError('A profile update needs an existing profile id or email.');
  const name = str(item.name);
  const role = str(item.role, 'Sales Representative');
  const parts = name.trim().split(/\s+/);
  const row: Database['public']['Tables']['profiles']['Update'] = {
    first_name: parts[0] || '',
    last_name: parts.slice(1).join(' '),
    full_name: name,
    role,
    level: accessLevelForRole(role),
    status: str(item.status, 'active'),
  };
  const response = await client.from('profiles').update(row).eq('id', id);
  fail('Could not update profile', response.error);
}

async function deleteRecords(client: Client, collection: DataCollection, values: unknown[]) {
  if (!values.length) return;
  if (collection === 'proposals') {
    throw new AuthorizationError('Proposal versions are permanent and cannot be deleted.');
  }
  if (collection === 'team') {
    throw new AuthorizationError('Authentication users cannot be deleted through the shared data route.');
  }
  const table = collection === 'closedDeals' ? 'closed_deals' : collection;
  if (table === 'prospects') {
    const numericIds = values.map((value) => Number(record(value).id));
    if (numericIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      throw new AuthorizationError('Every deleted prospect needs a valid numeric database id.');
    }
    const response = await client.from('prospects').delete().in('id', numericIds);
    fail('Could not delete prospects', response.error);
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

export async function writeSupabaseChanges(
  client: Client,
  userId: string,
  collection: DataCollection,
  changes: DataChangeSet
) {
  let profilesPromise: Promise<ProfileLookupRow[]> | null = null;
  const loadProfiles: ProfilesLoader = () => {
    if (!profilesPromise) {
      profilesPromise = (async () => {
        const response = await client.from('profiles').select('id, full_name, email');
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
    for (const value of changes.upserts) rows.push(await buildDealRow(value, userId, loadProfiles));
    await bulkWriteDeals(client, rows);
  } else if (collection === 'closedDeals') {
    const rows = [];
    for (const value of changes.upserts) rows.push(await buildClosedDealRow(value, userId, loadProfiles));
    await bulkWriteClosedDeals(client, rows);
  } else {
    const rows = changes.upserts.map((value) => buildProspectRow(value, userId));
    await bulkWriteProspects(client, rows);
  }

  await deleteRecords(client, collection, changes.deletes);
  return { upserted: changes.upserts.length, deleted: changes.deletes.length };
}
