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
import type { Database, Json, Tables } from '@/lib/supabase/database.types';

type Client = SupabaseClient<Database>;
type ProfileRow = Tables<'profiles'>;

export type DataChangeSet = {
  upserts: unknown[];
  deletes: unknown[];
};

function fail(context: string, error: { message: string } | null) {
  if (error) throw new Error(`${context}: ${error.message}`);
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
    throw new Error('Every data change must be an object.');
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

function profileMap(profiles: ProfileRow[]) {
  return new Map(profiles.map((profile) => [profile.full_name.trim().toLowerCase(), profile.id]));
}

function resolveOwner(
  item: Record<string, unknown>,
  nameField: string,
  idField: string,
  profiles: Map<string, string>,
  fallback: string
) {
  const explicit = str(item[idField]);
  if (explicit) return explicit;
  return profiles.get(str(item[nameField]).trim().toLowerCase()) || fallback;
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

async function upsertProposal(
  client: Client,
  value: unknown,
  userId: string,
  names: Map<string, string>
) {
  const item = record(value);
  const submittedById = resolveOwner(item, 'submittedBy', 'submittedById', names, userId);
  const ownerId = resolveOwner(item, 'owner', 'ownerId', names, userId);
  const reviewerName = str(item.reviewer);
  const reviewerId = reviewerName
    ? resolveOwner(item, 'reviewer', 'reviewerId', names, userId)
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

  const response = await client.from('proposals').upsert(row, { onConflict: 'id' });
  fail('Could not save proposal', response.error);
}

async function upsertDeal(
  client: Client,
  value: unknown,
  userId: string,
  names: Map<string, string>
) {
  const item = record(value);
  const id = str(item.id);
  const row: Database['public']['Tables']['deals']['Insert'] = {
    owner_id: resolveOwner(item, 'rep', 'ownerId', names, userId),
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
  if (id) {
    row.id = id;
    const response = await client.from('deals').upsert(row, { onConflict: 'id' });
    fail('Could not save deal', response.error);
  } else {
    const response = await client.from('deals').insert(row);
    fail('Could not create deal', response.error);
  }
}

async function upsertClosedDeal(
  client: Client,
  value: unknown,
  userId: string,
  names: Map<string, string>
) {
  const item = record(value);
  const id = str(item.id);
  const row: Database['public']['Tables']['closed_deals']['Insert'] = {
    owner_id: resolveOwner(item, 'rep', 'ownerId', names, userId),
    rep: str(item.rep),
    account: str(item.account),
    value: Math.max(0, num(item.value)),
    close_date: isoDate(item.closeDate, new Date().toISOString().slice(0, 10))!,
    source: str(item.source),
    outcome: str(item.outcome, 'Lost'),
    loss_reason: str(item.lossReason),
  };
  if (id) {
    row.id = id;
    const response = await client.from('closed_deals').upsert(row, { onConflict: 'id' });
    fail('Could not save closed deal', response.error);
  } else {
    const response = await client.from('closed_deals').insert(row);
    fail('Could not create closed deal', response.error);
  }
}

async function upsertProspect(client: Client, value: unknown, userId: string) {
  const item = record(value);
  const row: Database['public']['Tables']['prospects']['Insert'] = {
    id: Math.trunc(num(item.id)),
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
  const response = await client.from('prospects').upsert(row, { onConflict: 'id' });
  fail('Could not save prospect', response.error);
}

async function updateProfile(client: Client, value: unknown, profiles: ProfileRow[]) {
  const item = record(value);
  const id = str(item.id) || profiles.find((profile) => profile.email === str(item.email))?.id;
  if (!id) throw new Error('A profile update needs an existing profile id or email.');
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
    throw new Error('Proposal versions are permanent and cannot be deleted.');
  }
  if (collection === 'team') {
    throw new Error('Authentication users cannot be deleted through the shared data route.');
  }
  const ids = values.map((value) => str(record(value).id)).filter(Boolean);
  if (ids.length !== values.length) {
    throw new Error(`Every deleted ${collection} record needs its database id.`);
  }
  const table = collection === 'closedDeals' ? 'closed_deals' : collection;
  if (table === 'deals') {
    const response = await client.from('deals').delete().in('id', ids);
    fail('Could not delete deals', response.error);
  } else if (table === 'closed_deals') {
    const response = await client.from('closed_deals').delete().in('id', ids);
    fail('Could not delete closed deals', response.error);
  } else {
    const numericIds = ids.map(Number);
    const response = await client.from('prospects').delete().in('id', numericIds);
    fail('Could not delete prospects', response.error);
  }
}

export async function writeSupabaseChanges(
  client: Client,
  userId: string,
  collection: DataCollection,
  changes: DataChangeSet
) {
  const profilesResponse = await client.from('profiles').select('*');
  fail('Could not resolve team ownership', profilesResponse.error);
  const profiles = profilesResponse.data || [];
  const names = profileMap(profiles);

  for (const value of changes.upserts) {
    if (collection === 'proposals') await upsertProposal(client, value, userId, names);
    else if (collection === 'deals') await upsertDeal(client, value, userId, names);
    else if (collection === 'closedDeals') await upsertClosedDeal(client, value, userId, names);
    else if (collection === 'prospects') await upsertProspect(client, value, userId);
    else await updateProfile(client, value, profiles);
  }

  await deleteRecords(client, collection, changes.deletes);
  return { upserted: changes.upserts.length, deleted: changes.deletes.length };
}
