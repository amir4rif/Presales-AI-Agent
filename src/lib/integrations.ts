export const DATA_COLLECTIONS = [
  'proposals',
  'deals',
  'closedDeals',
  'prospects',
  'team',
] as const;

export type DataCollection = (typeof DATA_COLLECTIONS)[number];
export type DataSource = 'seed' | 'supabase';

export const STORAGE_KEY_BY_COLLECTION: Record<DataCollection, string> = {
  proposals: 'ramssolProposals',
  deals: 'ramssolDeals',
  closedDeals: 'ramssolClosedDeals',
  prospects: 'ramssolProspects',
  team: 'ramssolTeam',
};

export function isDataCollection(value: string | null | undefined): value is DataCollection {
  return DATA_COLLECTIONS.includes(value as DataCollection);
}

export type AiIntegrationStatus = {
  configured: boolean;
  provider: 'gemini' | 'anthropic';
  model: string;
  missing: string[];
};

export type SupabaseIntegrationStatus = {
  configured: boolean;
  ready: boolean;
  dataSource: DataSource;
  missing: string[];
};

export type LarkIntegrationStatus = {
  configured: boolean;
  ready: boolean;
  dataSource: 'inactive';
  tableConfigured: boolean;
  primaryFieldConfigured: boolean;
  missing: string[];
};
