export const DATA_COLLECTIONS = [
  'proposals',
  'deals',
  'closedDeals',
  'prospects',
  'team',
] as const;

export type DataCollection = (typeof DATA_COLLECTIONS)[number];
export type DataSource = 'seed' | 'lark';

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

export type AnthropicIntegrationStatus = {
  configured: boolean;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  missing: string[];
};

export type LarkIntegrationStatus = {
  configured: boolean;
  ready: boolean;
  dataSource: DataSource;
  tableConfigured: boolean;
  primaryFieldConfigured: boolean;
  missing: string[];
};
