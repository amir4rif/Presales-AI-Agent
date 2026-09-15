export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type ProposalRow = {
  id: string;
  case_id: string;
  opportunity_id: string;
  version: number;
  company: string;
  deal: string;
  value: number;
  submitted_by_id: string;
  submitted_by: string;
  owner_id: string;
  owner: string;
  generated_on: string;
  submitted_at: string | null;
  status: string;
  reviewer_id: string | null;
  reviewer: string;
  reviewed_at: string | null;
  rejection_reason: string;
  review_note: string;
  sections: Json;
  outcome: string | null;
  deal_id: string | null;
  deal_link_action: string | null;
  deal_linked_at: string | null;
  prospect_id: number | null;
  created_at: string;
  updated_at: string;
};

type ProfileRow = {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  role: string;
  level: number;
  status: string;
  last_active: string | null;
  created_at: string;
  updated_at: string;
};

type DealRow = {
  id: string;
  owner_id: string;
  prospect_id: number | null;
  case_id: string | null;
  opportunity_id: string | null;
  rep: string;
  account: string;
  expected_close_date: string;
  stage: number;
  days_in_stage: number;
  days_to_close: number;
  value: number;
  movement: string;
  status: string;
  notes: string;
  pending_disqualification_reason: string | null;
  pending_close_source: string | null;
  pending_close_date: string | null;
  close_requested_by_id: string | null;
  close_requested_by: string | null;
  close_requested_at: string | null;
  created_at: string;
  updated_at: string;
};

type ClosedDealRow = {
  id: string;
  owner_id: string;
  prospect_id: number | null;
  case_id: string | null;
  opportunity_id: string | null;
  rep: string;
  account: string;
  value: number;
  close_date: string;
  source: string;
  outcome: string;
  loss_reason: string;
  disqualification_reason: string;
  closed_by_id: string | null;
  closed_by: string;
  closed_at: string;
  disqualification_requested_by_id: string | null;
  disqualification_requested_by: string | null;
  disqualification_requested_at: string | null;
  disqualification_approved_by_id: string | null;
  disqualification_approved_by: string | null;
  disqualification_approved_at: string | null;
  created_at: string;
  updated_at: string;
};

type ProspectRow = {
  id: number;
  owner_id: string;
  name: string;
  type: string;
  country: string;
  website: string;
  added_on: string;
  status: string;
  tags: string[];
  employees: string;
  opportunities: number;
  total_value: number;
  pain_points: string[];
  contact: string | null;
  authority: string | null;
  it_budget: string | null;
  hr_budget: string | null;
  timeline: string | null;
  current_system: string | null;
  current_module: string | null;
  ai_research: Json | null;
  watched: boolean;
  created_at: string;
  updated_at: string;
};

type NotificationRow = {
  id: string;
  recipient_id: string;
  actor_id: string | null;
  proposal_id: string;
  event_type: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

type Insert<Row> = Partial<Row>;
type Update<Row> = Partial<Row>;

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: Insert<ProfileRow> & Pick<ProfileRow, 'id' | 'email' | 'full_name'>;
        Update: Update<ProfileRow>;
        Relationships: [];
      };
      proposals: {
        Row: ProposalRow;
        Insert: Insert<ProposalRow> & Pick<ProposalRow, 'company' | 'deal' | 'submitted_by' | 'owner'>;
        Update: Update<ProposalRow>;
        Relationships: [];
      };
      deals: {
        Row: DealRow;
        Insert: Insert<DealRow> & Pick<DealRow, 'rep' | 'account'>;
        Update: Update<DealRow>;
        Relationships: [];
      };
      closed_deals: {
        Row: ClosedDealRow;
        Insert: Insert<ClosedDealRow> & Pick<ClosedDealRow, 'rep' | 'account' | 'close_date' | 'outcome'>;
        Update: Update<ClosedDealRow>;
        Relationships: [];
      };
      prospects: {
        Row: ProspectRow;
        Insert: Insert<ProspectRow> & Pick<ProspectRow, 'name'>;
        Update: Update<ProspectRow>;
        Relationships: [];
      };
      notifications: {
        Row: NotificationRow;
        Insert: Insert<NotificationRow> & Pick<NotificationRow, 'recipient_id' | 'proposal_id' | 'event_type' | 'title'>;
        Update: Pick<NotificationRow, 'read_at'>;
        Relationships: [];
      };
    };
    Views: {
      my_proposals: {
        Row: ProposalRow;
        Relationships: [];
      };
      admin_approvals: {
        Row: ProposalRow;
        Relationships: [];
      };
      proposal_version_history: {
        Row: ProposalRow;
        Relationships: [];
      };
    };
    Functions: {
      close_deal: {
        Args: {
          p_deal_id: string;
          p_outcome: string;
          p_reason: string;
          p_source: string;
          p_close_date: string;
          p_expected_updated_at: string;
        };
        Returns: Json;
      };
      review_deal_disqualification: {
        Args: {
          p_deal_id: string;
          p_approve: boolean;
          p_expected_updated_at: string;
        };
        Returns: Json;
      };
      resubmit_proposal: {
        Args: {
          p_expected_updated_at: string;
          p_predecessor_id: string;
          p_new_id: string;
          p_sections: Json;
        };
        Returns: ProposalRow;
        SetofOptions: {
          from: '*';
          to: 'proposals';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
