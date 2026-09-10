/* ═══════════════════════════════════════════════════════════
   data.ts — app-data.js moved here, same function names.

   Single source of truth shared by Proposals, Approvals, Pipeline,
   Analytics and the dashboard so the numbers agree across screens.
   (Doc §4.9 / §4.13.)

   The accessors below are the seam the Lark migration goes through.
   AppShell hydrates their browser cache through /api/data when the
   server selects Lark; the same save functions queue server writes.
═══════════════════════════════════════════════════════════ */
import { currentLevel, currentUser, currentUserId } from './role';
import { isRemoteCollection, isRemoteDataSource, queueDataSync } from './data-sync';
import { STORAGE_KEY_BY_COLLECTION, type DataCollection } from './integrations';
import {
  latestLiveProposalVersions,
  rejectionReasonStats,
  visibleProposalVersionsForOwner,
} from './proposal-lifecycle';
import { mergeProposalSnapshot, type DataChangeOptions } from './data-changes';
import { calculateTwoStageRates } from './stage-rates';

export { currentLevel, currentUser, currentUserId };

/* ── TYPES ─────────────────────────────────────────────── */
export type Stage = { id: number; name: string; sla: number; avgDays: number; prob: number };
export type Opportunity = { oppId: string; account: string; deal: string; value: number; industry: string };
export type ClosedDeal = { id?: string; ownerId?: string; rep: string; account: string; value: number; closeDate: string; source: string; outcome: 'Won' | 'Lost'; lossReason: string };
export type Deal = { id?: string; ownerId?: string; prospectId?: number; rep: string; account: string; stage: number; daysInStage: number; daysToClose: number; value: number; movement: string; status: string; notes: string };
export type TeamMember = { id?: string; name: string; email: string; role: string; level?: 1 | 2 | 3; status: string; lastActive: string };
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
  id: number; name: string; type: string; country: string; website: string; added: string;
  tags: string[]; employees: string; opportunities: number; totalValue: number; painPoints: string[];
  // Set on prospects added through the Add Prospect form.
  contact?: string; authority?: string; itBudget?: string; hrBudget?: string; timeline?: string;
  ownerId?: string; currentSystem?: string; currentModule?: string; aiResearch?: AIResearch | null; watched?: boolean;
};
export type ProposalStatus = 'Draft' | 'Pending Review' | 'Approved' | 'Reject & Revise' | 'Reject & Close' | 'Superseded';
export type Proposal = {
  id: string; caseId: string; opportunityId: string; version: number;
  company: string; deal: string; value: number;
  submittedBy: string; owner: string; generatedDate: string; submittedDate: string;
  status: ProposalStatus; reviewer: string; reviewedDate: string;
  ownerId?: string; submittedById?: string; reviewerId?: string;
  rejectionReason: string; reviewNote: string; lastUpdated: string;
  /** Lossless server concurrency token; never display or synthesize it. */
  updatedAt?: string;
  sections: { executive: string; solution: string; commercials: string };
  /* Post-approval outcome (v10). Only meaningful once status is Approved. */
  outcome?: DealOutcome;
};
export type DealOutcome = 'Pending' | 'Won' | 'Lost';

export const REPS_SEED = ['Lim LG', 'Ahmad Razak', 'Priya Nair', 'Wei Ling Tan', 'Rajan Pillai', 'Siti Rahimah', 'Faizal Hassan'];

// Pipeline stages with SLA day thresholds + observed average days-in-stage
// (used for the Analytics velocity-vs-SLA view, Doc §3.6).
export const STAGES: Stage[] = [
  { id: 1, name: 'Prospecting',            sla: 7,  avgDays: 5,  prob: 0.10 },
  { id: 2, name: 'Qualifying Leads',       sla: 7,  avgDays: 9,  prob: 0.20 },
  { id: 3, name: 'Initial Meeting',        sla: 14, avgDays: 12, prob: 0.30 },
  { id: 4, name: 'Define Prospect Needs',  sla: 14, avgDays: 16, prob: 0.40 },
  { id: 5, name: 'Make An Offer',          sla: 14, avgDays: 18, prob: 0.55 },
  { id: 6, name: 'Negotiation / Finalize', sla: 21, avgDays: 25, prob: 0.70 },
  { id: 7, name: 'Closing The Deal',       sla: 14, avgDays: 11, prob: 0.90 },
  { id: 8, name: 'Deliver The Product',    sla: 30, avgDays: 22, prob: 1.00 },
];

// Open opportunities available to start a NEW proposal against (Doc §3.8).
export const OPPORTUNITIES: Opportunity[] = [
  { oppId: 'OPP-2026-0101', account: 'Sunway Group',       deal: 'Sunway – HCM Platform',            value: 2400000, industry: 'Property & Construction' },
  { oppId: 'OPP-2026-0102', account: 'AeonCredit',         deal: 'AeonCredit – RPA Automation',      value: 1800000, industry: 'Banking & Finance' },
  { oppId: 'OPP-2026-0103', account: 'MyToll',             deal: 'MyToll – Payroll Modernisation',   value: 1200000, industry: 'Logistics & Supply Chain' },
  { oppId: 'OPP-2026-0105', account: 'KPJ Healthcare',     deal: 'KPJ – Clinical Analytics',         value: 3200000, industry: 'Healthcare' },
  { oppId: 'OPP-2026-0106', account: 'Taylor’s Education', deal: 'Taylor’s – Student Lifecycle LMS',  value: 1700000, industry: 'Education' },
];

// Company-wide closed-deal history for pipeline analysis (Doc §4.13).
export const CLOSED_DEALS: ClosedDeal[] = [
  // Q3 2025
  { rep: 'Ahmad Razak',   account: 'Sunway Group – HCM',           value: 2400000, closeDate: '2025-08-12', source: 'Inbound',  outcome: 'Won',  lossReason: '' },
  { rep: 'Priya Nair',    account: 'MyToll – Payroll',             value: 1200000, closeDate: '2025-09-03', source: 'Partner',  outcome: 'Won',  lossReason: '' },
  { rep: 'Wei Ling Tan',  account: 'AeonCredit – RPA',             value: 1800000, closeDate: '2025-09-22', source: 'Outbound', outcome: 'Lost', lossReason: 'Chose competitor' },
  { rep: 'Rajan Pillai',  account: 'KPJ Health – Analytics',       value: 3200000, closeDate: '2025-08-28', source: 'Inbound',  outcome: 'Won',  lossReason: '' },
  // Q4 2025
  { rep: 'Siti Rahimah',  account: 'MARA – LMS',                   value: 2100000, closeDate: '2025-11-15', source: 'Partner',  outcome: 'Won',  lossReason: '' },
  { rep: 'Faizal Hassan', account: 'DHL MY – WMS',                 value: 2600000, closeDate: '2025-12-04', source: 'Outbound', outcome: 'Lost', lossReason: 'Budget cut' },
  { rep: 'Ahmad Razak',   account: 'Maybank – Fusion HCM',         value: 5200000, closeDate: '2025-11-30', source: 'Inbound',  outcome: 'Won',  lossReason: '' },
  { rep: 'Priya Nair',    account: 'Astro – CRM',                  value: 1500000, closeDate: '2025-12-18', source: 'Outbound', outcome: 'Lost', lossReason: 'No decision' },
  { rep: 'Wei Ling Tan',  account: 'PKT Logistics – IoT',          value: 900000,  closeDate: '2025-10-21', source: 'Partner',  outcome: 'Won',  lossReason: '' },
  // Q1 2026
  { rep: 'Rajan Pillai',  account: 'Prince Court – Data Platform', value: 3800000, closeDate: '2026-02-11', source: 'Inbound',  outcome: 'Won',  lossReason: '' },
  { rep: 'Siti Rahimah',  account: 'Taylor’s – Student Portal',    value: 1700000, closeDate: '2026-03-02', source: 'Partner',  outcome: 'Won',  lossReason: '' },
  { rep: 'Faizal Hassan', account: 'Celcom – Security',            value: 2900000, closeDate: '2026-03-19', source: 'Outbound', outcome: 'Lost', lossReason: 'Chose competitor' },
  { rep: 'Ahmad Razak',   account: 'CIMB – Core Upgrade',          value: 4600000, closeDate: '2026-01-27', source: 'Inbound',  outcome: 'Won',  lossReason: '' },
  { rep: 'Priya Nair',    account: 'MMC Corp – ERP',               value: 3100000, closeDate: '2026-02-24', source: 'Outbound', outcome: 'Lost', lossReason: 'Pricing too high' },
  // Q2 2026
  { rep: 'Wei Ling Tan',  account: 'Gamuda – Cloud Infra',         value: 2200000, closeDate: '2026-05-14', source: 'Partner',  outcome: 'Won',  lossReason: '' },
  { rep: 'Rajan Pillai',  account: 'Pantai Health – Analytics',    value: 2000000, closeDate: '2026-04-30', source: 'Inbound',  outcome: 'Won',  lossReason: '' },
  { rep: 'Siti Rahimah',  account: 'Education Portal – LMS',       value: 1800000, closeDate: '2026-06-22', source: 'Inbound',  outcome: 'Won',  lossReason: '' },
  { rep: 'Faizal Hassan', account: 'Telco MY – SOC',               value: 2600000, closeDate: '2026-05-28', source: 'Outbound', outcome: 'Lost', lossReason: 'No decision' },
  { rep: 'Ahmad Razak',   account: 'Petronas – HR Module',         value: 4500000, closeDate: '2026-06-30', source: 'Inbound',  outcome: 'Won',  lossReason: '' },
  { rep: 'Priya Nair',    account: 'Grab MY – Martech',            value: 1300000, closeDate: '2026-06-10', source: 'Outbound', outcome: 'Lost', lossReason: 'Budget cut' },
  { rep: 'Lim LG',        account: 'Tzu Chi – Volunteer Portal',   value: 1500000, closeDate: '2026-06-18', source: 'Inbound',  outcome: 'Won',  lossReason: '' },
  { rep: 'Lim LG',        account: 'Sime Darby – Payroll',         value: 1100000, closeDate: '2026-05-06', source: 'Outbound', outcome: 'Lost', lossReason: 'Pricing too high' },
];

// Active (open) deals — the live pipeline. Shared by Pipeline + the dashboard.
export const ACTIVE_DEALS: Deal[] = [
  { prospectId: 1, rep: 'Lim LG',        account: 'Tzu Chi Foundation',          stage: 5, daysInStage: 12, daysToClose: 28, value: 2800000, movement: 'Advanced',  status: 'On Track', notes: 'Q3 budget confirmed' },
  { prospectId: 1, rep: 'Priya Nair',    account: 'Tzu Chi – Disaster Platform', stage: 6, daysInStage: 18, daysToClose: 15, value: 4200000, movement: 'Held',      status: 'At Risk',  notes: 'Awaiting board approval' },
  { prospectId: 1, rep: 'Wei Ling Tan',  account: 'Tzu Chi – Donor System',      stage: 3, daysInStage: 8,  daysToClose: 45, value: 1600000, movement: 'Advanced',  status: 'On Track', notes: '' },
  { prospectId: 2, rep: 'Ahmad Razak',   account: 'ABC Bank – Core Upgrade',     stage: 6, daysInStage: 25, daysToClose: 20, value: 3100000, movement: 'Advanced',  status: 'On Track', notes: 'Final pricing submitted' },
  { prospectId: 2, rep: 'Siti Rahimah',  account: 'ABC Bank – AI Integration',   stage: 4, daysInStage: 10, daysToClose: 60, value: 2200000, movement: 'Advanced',  status: 'On Track', notes: '' },
  { prospectId: 3, rep: 'Lim LG',        account: 'Gov Agency – Cloud Infra',    stage: 2, daysInStage: 5,  daysToClose: 90, value: 2200000, movement: 'Held',      status: 'On Track', notes: 'Pending RFP response' },
  { prospectId: 4, rep: 'Rajan Pillai',  account: 'Healthcare – Data Platform',  stage: 5, daysInStage: 22, daysToClose: 18, value: 3100000, movement: 'Regressed', status: 'At Risk',  notes: 'Champion changed' },
  { prospectId: 4, rep: 'Lim LG',        account: 'Healthcare – Data Analytics', stage: 3, daysInStage: 12, daysToClose: 50, value: 2000000, movement: 'Advanced',  status: 'On Track', notes: '' },
  { rep: 'Siti Rahimah',  account: 'Education Portal',            stage: 7, daysInStage: 8,  daysToClose: 10, value: 1800000, movement: 'Advanced',  status: 'On Track', notes: 'Contract being signed' },
  { rep: 'Faizal Hassan', account: 'Logistics Co – WMS',          stage: 5, daysInStage: 9,  daysToClose: 30, value: 1900000, movement: 'Advanced',  status: 'On Track', notes: '' },
  { rep: 'Rajan Pillai',  account: 'NGO – Website Revamp',        stage: 4, daysInStage: 6,  daysToClose: 40, value: 1200000, movement: 'Advanced',  status: 'On Track', notes: '' },
  { rep: 'Faizal Hassan', account: 'Telco – Security Solution',   stage: 6, daysInStage: 30, daysToClose: 12, value: 2600000, movement: 'Held',      status: 'Stalled',  notes: 'POC failed, re-scoping' },
  { prospectId: 5, rep: 'Ahmad Razak',   account: 'Manufacturing Co – ERP',      stage: 2, daysInStage: 4,  daysToClose: 80, value: 3000000, movement: 'Advanced',  status: 'On Track', notes: '' },
];

// User directory — the doc's named users (Doc §1/§2).
export const TEAM_SEED: TeamMember[] = [
  { name: 'Brian',       email: 'brian.liew@ramssol.com',   role: 'Sales Operations',     status: 'active', lastActive: 'Just now' },
  { name: 'Sharon',      email: 'sharon@ramssol.com',       role: 'Sales Manager',        status: 'active', lastActive: '2h ago' },
  { name: 'Lim LG',      email: 'lim.lg@ramssol.com',       role: 'Sales Representative', status: 'active', lastActive: '1 day ago' },
  { name: 'Ahmad Razak', email: 'ahmad.razak@ramssol.com',  role: 'Sales Representative', status: 'active', lastActive: '3h ago' },
];

// Prospect workspace seed (Doc §3.3).
export const PROSPECT_SEED: Prospect[] = [
  { id: 1, name: 'Tzu Chi Foundation', type: 'NGO / Non-profit', country: 'Taiwan', website: 'www.tzuchi.org.tw', added: '12 Apr 2026', tags: ['Humanitarian Aid', 'Healthcare', 'Education', 'Environment'], employees: '10,000+ Volunteers', opportunities: 3, totalValue: 8.4, painPoints: ['Managing global volunteers across multiple regions', 'Tracking donations and fund utilization transparently', 'Coordinating disaster relief in real-time', 'Measuring program impact and reporting to donors', 'Language and cultural diversity in operations'] },
  { id: 2, name: 'ABC Bank', type: 'Banking & Finance', country: 'Malaysia', website: 'www.abcbank.com.my', added: '2 Mar 2026', tags: ['Digital Banking', 'Core Systems', 'AI'], employees: '3,500', opportunities: 2, totalValue: 6.1, painPoints: ['Legacy core banking system causing downtime', 'Manual loan processing slowing approvals', 'Regulatory compliance reporting burden'] },
  { id: 3, name: 'Gov Agency', type: 'Government', country: 'Malaysia', website: 'gov.my', added: '15 Jan 2026', tags: ['Cloud Infra', 'Digital Gov', 'Data'], employees: '800', opportunities: 1, totalValue: 2.2, painPoints: ['Paper-based processes for citizen services', 'Data silos across departments', 'Lack of real-time reporting dashboard'] },
  { id: 4, name: 'Healthcare Group', type: 'Healthcare', country: 'Malaysia', website: 'healthcare-group.my', added: '20 Feb 2026', tags: ['Data Platform', 'Analytics', 'AI'], employees: '2,000+', opportunities: 2, totalValue: 5.1, painPoints: ['Fragmented patient data across facilities', 'No unified analytics platform', 'Compliance with PDPA and health regulations'] },
  { id: 5, name: 'Manufacturing Co', type: 'Manufacturing', country: 'Malaysia', website: 'manufco.my', added: '5 Apr 2026', tags: ['ERP', 'Supply Chain', 'IoT'], employees: '1,200', opportunities: 1, totalValue: 3.0, painPoints: ['No end-to-end supply chain visibility', 'Manual inventory tracking', 'Slow order-to-delivery cycle'] },
];

// Proposal Store seed (Doc §4.9). One row = one VERSION; rows share a Case ID.
export const PROPOSAL_SEED: Proposal[] = [
  { id: 'PROP-2026-0141', caseId: 'CASE-2026-0089', opportunityId: 'OPP-2026-0089', version: 1,
    company: 'Tzu Chi Foundation', deal: 'Tzu Chi – Volunteer Management System', value: 326000,
    submittedBy: 'Lim LG', owner: 'Lim LG', generatedDate: '2026-05-08', submittedDate: '8 May 2026',
    status: 'Superseded', reviewer: 'Sharon Lim', reviewedDate: '10 May 2026',
    rejectionReason: 'Pricing too high', reviewNote: 'Budget is RM 250K, quoted RM 326K. Trim scope and resubmit.',
    lastUpdated: '10 May 2026',
    sections: {
      executive: 'Tzu Chi Foundation requires a comprehensive volunteer management solution to streamline recruitment, deployment, communication, and reporting across its global operations.',
      solution: 'Ramssol proposes a cloud-based Volunteer Management System (VMS) with centralised registry, AI-powered matching, real-time coordination, and integrated donor management.',
      commercials: 'System License: RM 180,000/year · Implementation: RM 85,000 · Training: RM 25,000 · Support: RM 36,000/year — Total Year 1: RM 326,000',
    } },
  { id: 'PROP-2026-0142', caseId: 'CASE-2026-0089', opportunityId: 'OPP-2026-0089', version: 2,
    company: 'Tzu Chi Foundation', deal: 'Tzu Chi – Volunteer Management System', value: 298000,
    submittedBy: 'Lim LG', owner: 'Lim LG', generatedDate: '2026-05-14', submittedDate: '14 May 2026',
    status: 'Pending Review', reviewer: '', reviewedDate: '', rejectionReason: '', reviewNote: '',
    lastUpdated: '14 May 2026',
    sections: {
      executive: 'Tzu Chi Foundation requires a comprehensive volunteer management solution to streamline recruitment, deployment, communication, and reporting across its global operations.',
      solution: 'Ramssol proposes a cloud-based Volunteer Management System (VMS) with centralised registry, AI-powered matching, real-time coordination, and integrated donor management. Scope trimmed to core modules to meet budget.',
      commercials: 'System License: RM 165,000/year · Implementation: RM 78,000 · Support: RM 30,000/year — Total Year 1: RM 298,000',
    } },
  { id: 'PROP-2026-0130', caseId: 'CASE-2026-0071', opportunityId: 'OPP-2026-0071', version: 1,
    company: 'ABC Bank', deal: 'ABC Bank – Core Upgrade Proposal', value: 3100000,
    submittedBy: 'Ahmad Razak', owner: 'Ahmad Razak', generatedDate: '2026-05-09', submittedDate: '10 May 2026',
    status: 'Pending Review', reviewer: '', reviewedDate: '', rejectionReason: '', reviewNote: '',
    lastUpdated: '10 May 2026',
    sections: {
      executive: 'ABC Bank requires a modernised core banking platform to support growing transaction volumes and stricter compliance requirements.',
      solution: 'Ramssol proposes a phased core-system upgrade with parallel-run migration, AI-driven fraud monitoring, and 24x7 managed support.',
      commercials: 'Licensing: RM 1.8M/year · Implementation: RM 950,000 · Support: RM 350,000/year — Total Year 1: RM 3.1M',
    } },
  { id: 'PROP-2026-0125', caseId: 'CASE-2026-0066', opportunityId: 'OPP-2026-0066', version: 1,
    company: 'Petronas', deal: 'Petronas – HR Module', value: 4500000,
    submittedBy: 'Lim LG', owner: 'Lim LG', generatedDate: '2026-05-05', submittedDate: '6 May 2026',
    status: 'Approved', reviewer: 'Sharon Lim', reviewedDate: '9 May 2026',
    rejectionReason: '', reviewNote: 'Strong strategic fit and pricing aligned with allocated budget. Approved — proceed to client pitch.',
    lastUpdated: '9 May 2026',
    sections: {
      executive: 'Petronas is consolidating HR operations across subsidiaries onto a single enterprise HCM platform.',
      solution: 'Oracle Fusion HCM (RAMS PeopleTech) with multi-country payroll, talent management, and workforce analytics.',
      commercials: 'License: RM 3.0M/year · Implementation: RM 1.2M · Support: RM 300,000/year — Total Year 1: RM 4.5M',
    } },
  { id: 'PROP-2026-0118', caseId: 'CASE-2026-0060', opportunityId: 'OPP-2026-0060', version: 1,
    company: 'Education Portal Sdn Bhd', deal: 'Education Portal – LMS Rollout', value: 1800000,
    submittedBy: 'Siti Rahimah', owner: 'Siti Rahimah', generatedDate: '2026-05-01', submittedDate: '2 May 2026',
    status: 'Approved', reviewer: 'Sharon Lim', reviewedDate: '5 May 2026',
    rejectionReason: '', reviewNote: 'Approved — pricing aligned with allocated budget, proceed to contract.',
    lastUpdated: '5 May 2026',
    sections: {
      executive: 'Education Portal needs a unified learning management platform serving 40,000+ students across 3 campuses.',
      solution: 'Ramssol RAMS EduTech LMS with mobile-first delivery, integrated assessments, and parent/guardian portals.',
      commercials: 'Platform License: RM 1.2M/year · Implementation: RM 600,000 — Total Year 1: RM 1.8M',
    } },
  { id: 'PROP-2026-0136', caseId: 'CASE-2026-0079', opportunityId: 'OPP-2026-0079', version: 1,
    company: 'Healthcare Group', deal: 'Healthcare – Data Analytics Platform', value: 2000000,
    submittedBy: 'Lim LG', owner: 'Lim LG', generatedDate: '2026-05-11', submittedDate: '12 May 2026',
    status: 'Reject & Revise', reviewer: 'Sharon Lim', reviewedDate: '13 May 2026',
    rejectionReason: 'Missing information', reviewNote: 'Add integration details for the existing HIS and a PDPA compliance section, then resubmit.',
    lastUpdated: '13 May 2026',
    sections: {
      executive: 'Healthcare Group needs a unified analytics platform across fragmented patient data systems.',
      solution: 'Ramssol A.I.Tech data platform with a governed data lake, PDPA-compliant access controls, and clinical dashboards.',
      commercials: 'Platform License: RM 1.4M/year · Implementation: RM 600,000 — Total Year 1: RM 2.0M',
    } },
  { id: 'PROP-2026-0110', caseId: 'CASE-2026-0054', opportunityId: 'OPP-2026-0054', version: 1,
    company: 'Telco Malaysia', deal: 'Telco – Security Solution Proposal', value: 2600000,
    submittedBy: 'Faizal Hassan', owner: 'Faizal Hassan', generatedDate: '2026-04-27', submittedDate: '28 Apr 2026',
    status: 'Reject & Revise', reviewer: 'Sharon Lim', reviewedDate: '30 Apr 2026',
    rejectionReason: 'Scope mismatch', reviewNote: 'POC failed during evaluation. Please re-scope the architecture and resubmit with updated commercials.',
    lastUpdated: '30 Apr 2026',
    sections: {
      executive: 'Telco Malaysia is seeking an upgraded network security solution following recent audit findings.',
      solution: 'Proposed SOC-as-a-service with managed detection and response, tied to existing SIEM tooling.',
      commercials: 'Managed Security Service: RM 2.1M/year · Onboarding: RM 500,000 — Total Year 1: RM 2.6M',
    } },
  { id: 'PROP-2026-0098', caseId: 'CASE-2026-0042', opportunityId: 'OPP-2026-0042', version: 1,
    company: 'Manufacturing Co', deal: 'Manufacturing Co – ERP', value: 3000000,
    submittedBy: 'Priya Nair', owner: 'Priya Nair', generatedDate: '2026-04-15', submittedDate: '16 Apr 2026',
    status: 'Approved', reviewer: 'Sharon Lim', reviewedDate: '18 Apr 2026',
    rejectionReason: '', reviewNote: 'Approved — solid ROI case, proceed to client pitch.',
    lastUpdated: '18 Apr 2026',
    sections: {
      executive: 'Manufacturing Co needs end-to-end supply chain visibility and automated inventory tracking.',
      solution: 'Ramssol AutoTech ERP with IoT inventory sensors and order-to-delivery automation.',
      commercials: 'License: RM 1.8M/year · Implementation: RM 1.2M — Total Year 1: RM 3.0M',
    } },
  { id: 'PROP-2026-0104', caseId: 'CASE-2026-0048', opportunityId: 'OPP-2026-0048', version: 1,
    company: 'FastTrack Logistics', deal: 'FastTrack – Fleet IoT Proposal', value: 950000,
    submittedBy: 'Ahmad Razak', owner: 'Ahmad Razak', generatedDate: '2026-04-20', submittedDate: '20 Apr 2026',
    status: 'Reject & Close', reviewer: 'Sharon Lim', reviewedDate: '22 Apr 2026',
    rejectionReason: 'Out of scope', reviewNote: 'Product does not cover cold-chain monitoring which is a hard requirement. Out of scope for our current portfolio.',
    lastUpdated: '22 Apr 2026',
    sections: {
      executive: 'FastTrack Logistics needs IoT-based fleet tracking with cold-chain temperature monitoring for pharmaceutical deliveries.',
      solution: 'Ramssol Fleet Management Platform with GPS tracking, driver behaviour analytics, and route optimisation.',
      commercials: 'Platform License: RM 650,000/year · Hardware: RM 300,000 — Total Year 1: RM 950,000',
    } },
  { id: 'PROP-2026-0150', caseId: 'CASE-2026-0093', opportunityId: 'OPP-2026-0093', version: 1,
    company: 'Gamuda', deal: 'Gamuda – Cloud Infrastructure', value: 2200000,
    submittedBy: 'Lim LG', owner: 'Lim LG', generatedDate: '2026-05-20', submittedDate: '',
    status: 'Draft', reviewer: '', reviewedDate: '', rejectionReason: '', reviewNote: '',
    lastUpdated: '20 May 2026',
    sections: {
      executive: 'Gamuda is migrating on-premise workloads to a scalable private cloud.',
      solution: 'Ramssol A.I.Tech (Tencent Cloud) private cloud with managed migration and 24x7 support.',
      commercials: 'Cloud Platform: RM 1.6M/year · Migration: RM 600,000 — Total Year 1: RM 2.2M',
    } },
];

export const STORAGE_KEY = 'ramssolProposals';

/* ── DEMO PERSONA ───────────────────────────────────────────
   The seed data is authored around named reps, so a freshly registered
   account ("Brian Liew") owns none of it — the Level 1 dashboard,
   My Proposals and My Pipeline all rendered empty. Whoever signs in
   therefore inherits SEED_PERSONA's book of work. The swap is applied on
   read, so nothing written to localStorage depends on who is signed in.
   Only Level 1 adopts: Levels 2 and 3 read team-wide data and own nothing,
   so re-pointing rows at a reviewer would have them reviewing themselves. */
const SEED_PERSONA = 'Lim LG';

function personalise<T extends Record<string, unknown>>(list: T[], keys: (keyof T)[]): T[] {
  // The persona swap exists only to make authored demo rows useful to a newly
  // registered Level 1 user. Real Lark ownership must never be rewritten.
  if (isRemoteDataSource()) return list;
  const me = currentUser();
  if (!me || me === SEED_PERSONA || currentLevel() !== 1) return list;
  return list.map((r) => {
    let copy: T | null = null;
    keys.forEach((k) => {
      if (r[k] === SEED_PERSONA) {
        copy = copy || { ...r };
        (copy as T)[k] = me as T[keyof T];
      }
    });
    return copy || r;
  });
}

const canStore = () => typeof window !== 'undefined';

function read<T>(key: string, fallback: T): T {
  if (!canStore()) return fallback;
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return (v as T) || fallback;
  } catch {
    return fallback;
  }
}

function write(
  collection: DataCollection,
  value: unknown[],
  options: DataChangeOptions = {}
) {
  if (!canStore()) return Promise.resolve(false);
  const previous = read<unknown[]>(STORAGE_KEY_BY_COLLECTION[collection], []);
  const cacheValue = collection === 'proposals'
    ? mergeProposalSnapshot(previous, value, options.proposalDeleteIds)
    : value;
  localStorage.setItem(STORAGE_KEY_BY_COLLECTION[collection], JSON.stringify(cacheValue));
  window.dispatchEvent(new Event('rams:data-changed'));
  return queueDataSync(collection, previous, cacheValue, options);
}

/* ── PROPOSALS ─────────────────────────────────────────── */
export function getProposals(): Proposal[] {
  if (!canStore()) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as Proposal[];
    return personalise(raw as unknown as Record<string, unknown>[], ['submittedBy', 'owner']) as unknown as Proposal[];
  } catch {
    return [];
  }
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

/** Seed the Proposal Store once, then always return the live store. */
export function ensureProposalStore(): Proposal[] {
  let list = getProposals();
  if (!list.length && !isRemoteCollection('proposals')) {
    saveProposals(PROPOSAL_SEED);
    list = getProposals();
  }
  return list;
}

/* ── SHARED ACCESSORS (single source of truth for every page) ──
   These are the function names the doc asks us to keep stable. When
   the source flips to Lark, only their bodies change. */
export const getDeals = (): Deal[] =>
  personalise(read('ramssolDeals', ACTIVE_DEALS.map((d) => ({ ...d }))) as unknown as Record<string, unknown>[], ['rep']) as unknown as Deal[];
export const saveDeals = (l: Deal[]) => write('deals', l);

export const getClosedDeals = (): ClosedDeal[] =>
  personalise(read('ramssolClosedDeals', CLOSED_DEALS.map((d) => ({ ...d }))) as unknown as Record<string, unknown>[], ['rep']) as unknown as ClosedDeal[];
export const saveClosedDeals = (l: ClosedDeal[]) => write('closedDeals', l);

export const getProspects = (): Prospect[] => read('ramssolProspects', PROSPECT_SEED.map((p) => ({ ...p })));
export const saveProspects = (l: Prospect[]) => write('prospects', l);

export const getTeam = (): TeamMember[] => read('ramssolTeam', TEAM_SEED.map((m) => ({ ...m })));
export const saveTeam = (l: TeamMember[]) => write('team', l);

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

/** Rep list follows the same persona swap, so every dropdown and filter
    offers the signed-in user rather than the seed name they replaced. */
export function getReps(): string[] {
  return personalise(REPS_SEED.map((n) => ({ n })), ['n']).map((r) => r.n);
}

/* ── STATS ENGINE ───────────────────────────────────────────
   One computation shared by the dashboard, Pipeline and Analytics
   so every screen reports identical numbers. */
export type Stats = ReturnType<typeof stats>;

export function stats(user?: string) {
  const who = user || currentUser();
  const whoId = user ? profileIdForName(user) : currentUserId();
  const store = ensureProposalStore();
  const cur = latestLiveProposalVersions(store);
  const mine = visibleProposalVersionsForOwner(cur, who, whoId);
  const deals = getDeals();
  const closed = getClosedDeals();
  const myDeals = deals.filter((d) =>
    whoId && d.ownerId ? d.ownerId === whoId : d.rep === who
  );

  // Both funnel stages use proposal cases. Pending approved outcomes are not
  // decisions and therefore stay out of Stage 2's denominator.
  const stageRates = calculateTwoStageRates(store);
  const closedWon = closed.filter((d) => d.outcome === 'Won');
  const closedLost = closed.filter((d) => d.outcome === 'Lost');

  const stalled = deals.filter((d) => {
    const s = STAGES[d.stage - 1];
    return s && d.daysInStage > s.sla;
  });

  // Only live Reject & Revise reasons drive the AI learning loop (Doc §4.10).
  const { reasons, topReason } = rejectionReasonStats(store);

  return {
    user: who, store, cur, mine, deals, closed, myDeals, prospects: getProspects(),
    pending:    cur.filter((p) => p.status === 'Pending Review').length,
    myPending:  mine.filter((p) => p.status === 'Pending Review').length,
    myDrafts:   mine.filter((p) => p.status === 'Draft').length,
    myRevise:   mine.filter((p) => p.status === 'Reject & Revise').length,
    myApproved: mine.filter((p) => p.status === 'Approved').length,
    ...stageRates,
    wonValue:  closedWon.reduce((a, d) => a + d.value, 0),
    lostValue: closedLost.reduce((a, d) => a + d.value, 0),
    pipelineValue:   deals.reduce((a, d) => a + d.value, 0),
    myPipelineValue: myDeals.reduce((a, d) => a + d.value, 0),
    weighted: deals.reduce((a, d) => a + d.value * (STAGES[d.stage - 1]?.prob || 0), 0),
    stalled, topReason, reasons,
  };
}

export function fmtRM(v: number | null | undefined) {
  if (!v && v !== 0) return '—';
  return v >= 1e6 ? `RM ${(v / 1e6).toFixed(2)}M` : `RM ${Number(v).toLocaleString()}`;
}
