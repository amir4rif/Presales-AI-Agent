/* ═══════════════════════════════════════════════════════════
   Ramssol AI Agent Copilot — shared demo data (app-data.js)
   Single source of truth shared by Proposals, Approvals, Pipeline
   and Analytics so the numbers agree across screens.
   (Static localStorage demo — see Design Doc §4.9 / §4.13.)
═══════════════════════════════════════════════════════════ */
window.RAMS = (function () {

  const REPS = ['Ahmad Razak', 'Priya Nair', 'Wei Ling Tan', 'Rajan Pillai', 'Siti Rahimah', 'Faizal Hassan'];

  // Pipeline stages with SLA day thresholds + observed average days-in-stage
  // (used for the Analytics velocity-vs-SLA view, Doc §3.6).
  const STAGES = [
    { id: 1, name: 'Prospecting',            sla: 7,  avgDays: 5,  prob: 0.10 },
    { id: 2, name: 'Qualifying Leads',       sla: 7,  avgDays: 9,  prob: 0.20 },
    { id: 3, name: 'Initial Meeting',        sla: 14, avgDays: 12, prob: 0.30 },
    { id: 4, name: 'Define Prospect Needs',  sla: 14, avgDays: 16, prob: 0.40 },
    { id: 5, name: 'Make An Offer',          sla: 14, avgDays: 18, prob: 0.55 },
    { id: 6, name: 'Negotiation / Finalize', sla: 21, avgDays: 25, prob: 0.70 },
    { id: 7, name: 'Closing The Deal',       sla: 14, avgDays: 11, prob: 0.90 },
    { id: 8, name: 'Deliver The Product',    sla: 30, avgDays: 22, prob: 1.00 }
  ];

  // Open opportunities available to start a NEW proposal against (Doc §3.8).
  const OPPORTUNITIES = [
    { oppId: 'OPP-2026-0101', account: 'Sunway Group',      deal: 'Sunway – HCM Platform',           value: 2400000, industry: 'Property & Construction' },
    { oppId: 'OPP-2026-0102', account: 'AeonCredit',        deal: 'AeonCredit – RPA Automation',      value: 1800000, industry: 'Banking & Finance' },
    { oppId: 'OPP-2026-0103', account: 'MyToll',            deal: 'MyToll – Payroll Modernisation',   value: 1200000, industry: 'Logistics & Supply Chain' },
    { oppId: 'OPP-2026-0105', account: 'KPJ Healthcare',    deal: 'KPJ – Clinical Analytics',         value: 3200000, industry: 'Healthcare' },
    { oppId: 'OPP-2026-0106', account: 'Taylor’s Education', deal: 'Taylor’s – Student Lifecycle LMS', value: 1700000, industry: 'Education' }
  ];

  // Closed deals — data source for Stage-2 / End-to-End Win Rate (Doc §4.13).
  const CLOSED_DEALS = [
    // Q3 2025
    { rep: 'Ahmad Razak',   account: 'Sunway Group – HCM',            value: 2400000, closeDate: '2025-08-12', source: 'Inbound',  outcome: 'Won',  lossReason: '' },
    { rep: 'Priya Nair',    account: 'MyToll – Payroll',              value: 1200000, closeDate: '2025-09-03', source: 'Partner',  outcome: 'Won',  lossReason: '' },
    { rep: 'Wei Ling Tan',  account: 'AeonCredit – RPA',              value: 1800000, closeDate: '2025-09-22', source: 'Outbound', outcome: 'Lost', lossReason: 'Chose competitor' },
    { rep: 'Rajan Pillai',  account: 'KPJ Health – Analytics',        value: 3200000, closeDate: '2025-08-28', source: 'Inbound',  outcome: 'Won',  lossReason: '' },
    // Q4 2025
    { rep: 'Siti Rahimah',  account: 'MARA – LMS',                    value: 2100000, closeDate: '2025-11-15', source: 'Partner',  outcome: 'Won',  lossReason: '' },
    { rep: 'Faizal Hassan', account: 'DHL MY – WMS',                  value: 2600000, closeDate: '2025-12-04', source: 'Outbound', outcome: 'Lost', lossReason: 'Budget cut' },
    { rep: 'Ahmad Razak',   account: 'Maybank – Fusion HCM',          value: 5200000, closeDate: '2025-11-30', source: 'Inbound',  outcome: 'Won',  lossReason: '' },
    { rep: 'Priya Nair',    account: 'Astro – CRM',                   value: 1500000, closeDate: '2025-12-18', source: 'Outbound', outcome: 'Lost', lossReason: 'No decision' },
    { rep: 'Wei Ling Tan',  account: 'PKT Logistics – IoT',           value: 900000,  closeDate: '2025-10-21', source: 'Partner',  outcome: 'Won',  lossReason: '' },
    // Q1 2026
    { rep: 'Rajan Pillai',  account: 'Prince Court – Data Platform',  value: 3800000, closeDate: '2026-02-11', source: 'Inbound',  outcome: 'Won',  lossReason: '' },
    { rep: 'Siti Rahimah',  account: 'Taylor’s – Student Portal',     value: 1700000, closeDate: '2026-03-02', source: 'Partner',  outcome: 'Won',  lossReason: '' },
    { rep: 'Faizal Hassan', account: 'Celcom – Security',             value: 2900000, closeDate: '2026-03-19', source: 'Outbound', outcome: 'Lost', lossReason: 'Chose competitor' },
    { rep: 'Ahmad Razak',   account: 'CIMB – Core Upgrade',           value: 4600000, closeDate: '2026-01-27', source: 'Inbound',  outcome: 'Won',  lossReason: '' },
    { rep: 'Priya Nair',    account: 'MMC Corp – ERP',                value: 3100000, closeDate: '2026-02-24', source: 'Outbound', outcome: 'Lost', lossReason: 'Pricing too high' },
    // Q2 2026
    { rep: 'Wei Ling Tan',  account: 'Gamuda – Cloud Infra',          value: 2200000, closeDate: '2026-05-14', source: 'Partner',  outcome: 'Won',  lossReason: '' },
    { rep: 'Rajan Pillai',  account: 'Pantai Health – Analytics',     value: 2000000, closeDate: '2026-04-30', source: 'Inbound',  outcome: 'Won',  lossReason: '' },
    { rep: 'Siti Rahimah',  account: 'Education Portal – LMS',        value: 1800000, closeDate: '2026-06-22', source: 'Inbound',  outcome: 'Won',  lossReason: '' },
    { rep: 'Faizal Hassan', account: 'Telco MY – SOC',               value: 2600000, closeDate: '2026-05-28', source: 'Outbound', outcome: 'Lost', lossReason: 'No decision' },
    { rep: 'Ahmad Razak',   account: 'Petronas – HR Module',         value: 4500000, closeDate: '2026-06-30', source: 'Inbound',  outcome: 'Won',  lossReason: '' },
    { rep: 'Priya Nair',    account: 'Grab MY – Martech',            value: 1300000, closeDate: '2026-06-10', source: 'Outbound', outcome: 'Lost', lossReason: 'Budget cut' }
  ];

  // Proposal Store seed (Doc §4.9). One row = one VERSION; rows share a Case ID.
  const PROPOSAL_SEED = [
    { id: 'PROP-2026-0141', caseId: 'CASE-2026-0089', opportunityId: 'OPP-2026-0089', version: 1,
      company: 'Tzu Chi Foundation', deal: 'Tzu Chi – Volunteer Management System', value: 326000,
      submittedBy: 'Amir Arif', owner: 'Amir Arif', generatedDate: '2026-05-08', submittedDate: '8 May 2026',
      status: 'Superseded', reviewer: 'Sharon Lim', reviewedDate: '10 May 2026',
      rejectionReason: 'Pricing too high', reviewNote: 'Budget is RM 250K, quoted RM 326K. Trim scope and resubmit.',
      lastUpdated: '10 May 2026',
      sections: {
        executive: 'Tzu Chi Foundation requires a comprehensive volunteer management solution to streamline recruitment, deployment, communication, and reporting across its global operations.',
        solution: 'Ramssol proposes a cloud-based Volunteer Management System (VMS) with centralised registry, AI-powered matching, real-time coordination, and integrated donor management.',
        commercials: 'System License: RM 180,000/year · Implementation: RM 85,000 · Training: RM 25,000 · Support: RM 36,000/year — Total Year 1: RM 326,000'
      } },
    { id: 'PROP-2026-0142', caseId: 'CASE-2026-0089', opportunityId: 'OPP-2026-0089', version: 2,
      company: 'Tzu Chi Foundation', deal: 'Tzu Chi – Volunteer Management System', value: 298000,
      submittedBy: 'Amir Arif', owner: 'Amir Arif', generatedDate: '2026-05-14', submittedDate: '14 May 2026',
      status: 'Pending Review', reviewer: '', reviewedDate: '', rejectionReason: '', reviewNote: '',
      lastUpdated: '14 May 2026',
      sections: {
        executive: 'Tzu Chi Foundation requires a comprehensive volunteer management solution to streamline recruitment, deployment, communication, and reporting across its global operations.',
        solution: 'Ramssol proposes a cloud-based Volunteer Management System (VMS) with centralised registry, AI-powered matching, real-time coordination, and integrated donor management. Scope trimmed to core modules to meet budget.',
        commercials: 'System License: RM 165,000/year · Implementation: RM 78,000 · Support: RM 30,000/year — Total Year 1: RM 298,000'
      } },
    { id: 'PROP-2026-0130', caseId: 'CASE-2026-0071', opportunityId: 'OPP-2026-0071', version: 1,
      company: 'ABC Bank', deal: 'ABC Bank – Core Upgrade Proposal', value: 3100000,
      submittedBy: 'Ahmad Razak', owner: 'Ahmad Razak', generatedDate: '2026-05-09', submittedDate: '10 May 2026',
      status: 'Pending Review', reviewer: '', reviewedDate: '', rejectionReason: '', reviewNote: '',
      lastUpdated: '10 May 2026',
      sections: {
        executive: 'ABC Bank requires a modernised core banking platform to support growing transaction volumes and stricter compliance requirements.',
        solution: 'Ramssol proposes a phased core-system upgrade with parallel-run migration, AI-driven fraud monitoring, and 24x7 managed support.',
        commercials: 'Licensing: RM 1.8M/year · Implementation: RM 950,000 · Support: RM 350,000/year — Total Year 1: RM 3.1M'
      } },
    { id: 'PROP-2026-0125', caseId: 'CASE-2026-0066', opportunityId: 'OPP-2026-0066', version: 1,
      company: 'Petronas', deal: 'Petronas – HR Module', value: 4500000,
      submittedBy: 'Amir Arif', owner: 'Amir Arif', generatedDate: '2026-05-05', submittedDate: '6 May 2026',
      status: 'Approved', reviewer: 'Sharon Lim', reviewedDate: '9 May 2026',
      rejectionReason: '', reviewNote: 'Strong strategic fit and pricing aligned with allocated budget. Approved — proceed to client pitch.',
      lastUpdated: '9 May 2026',
      sections: {
        executive: 'Petronas is consolidating HR operations across subsidiaries onto a single enterprise HCM platform.',
        solution: 'Oracle Fusion HCM (RAMS PeopleTech) with multi-country payroll, talent management, and workforce analytics.',
        commercials: 'License: RM 3.0M/year · Implementation: RM 1.2M · Support: RM 300,000/year — Total Year 1: RM 4.5M'
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
        commercials: 'Platform License: RM 1.2M/year · Implementation: RM 600,000 — Total Year 1: RM 1.8M'
      } },
    { id: 'PROP-2026-0136', caseId: 'CASE-2026-0079', opportunityId: 'OPP-2026-0079', version: 1,
      company: 'Healthcare Group', deal: 'Healthcare – Data Analytics Platform', value: 2000000,
      submittedBy: 'Amir Arif', owner: 'Amir Arif', generatedDate: '2026-05-11', submittedDate: '12 May 2026',
      status: 'Reject & Revise', reviewer: 'Sharon Lim', reviewedDate: '13 May 2026',
      rejectionReason: 'Missing information', reviewNote: 'Add integration details for the existing HIS and a PDPA compliance section, then resubmit.',
      lastUpdated: '13 May 2026',
      sections: {
        executive: 'Healthcare Group needs a unified analytics platform across fragmented patient data systems.',
        solution: 'Ramssol A.I.Tech data platform with a governed data lake, PDPA-compliant access controls, and clinical dashboards.',
        commercials: 'Platform License: RM 1.4M/year · Implementation: RM 600,000 — Total Year 1: RM 2.0M'
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
        commercials: 'Managed Security Service: RM 2.1M/year · Onboarding: RM 500,000 — Total Year 1: RM 2.6M'
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
        commercials: 'License: RM 1.8M/year · Implementation: RM 1.2M — Total Year 1: RM 3.0M'
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
        commercials: 'Platform License: RM 650,000/year · Hardware: RM 300,000 — Total Year 1: RM 950,000'
      } },
    { id: 'PROP-2026-0150', caseId: 'CASE-2026-0093', opportunityId: 'OPP-2026-0093', version: 1,
      company: 'Gamuda', deal: 'Gamuda – Cloud Infrastructure', value: 2200000,
      submittedBy: 'Amir Arif', owner: 'Amir Arif', generatedDate: '2026-05-20', submittedDate: '',
      status: 'Draft', reviewer: '', reviewedDate: '', rejectionReason: '', reviewNote: '',
      lastUpdated: '20 May 2026',
      sections: {
        executive: 'Gamuda is migrating on-premise workloads to a scalable private cloud.',
        solution: 'Ramssol A.I.Tech (Tencent Cloud) private cloud with managed migration and 24x7 support.',
        commercials: 'Cloud Platform: RM 1.6M/year · Migration: RM 600,000 — Total Year 1: RM 2.2M'
      } }
  ];

  const STORAGE_KEY = 'ramssolProposals';

  function getProposals() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function saveProposals(list) { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }

  // Seed the Proposal Store once, then always return the live store.
  function ensureProposalStore() {
    let list = getProposals();
    if (!list.length) { saveProposals(PROPOSAL_SEED); list = PROPOSAL_SEED.map(p => ({ ...p })); }
    return list;
  }

  // Identity of the signed-in user (for "My Proposals shows own only", Doc §3.8).
  function currentUser() {
    try {
      const s = JSON.parse(sessionStorage.getItem('ramssolSession') || 'null');
      if (s && (s.firstName || s.lastName)) return ((s.firstName || '') + ' ' + (s.lastName || '')).trim();
    } catch (e) {}
    try {
      const p = JSON.parse(localStorage.getItem('ramssolProfile') || 'null');
      if (p && p.name && p.name !== 'User') return p.name;
    } catch (e) {}
    return 'Amir Arif';
  }

  return { REPS, STAGES, OPPORTUNITIES, CLOSED_DEALS, PROPOSAL_SEED, STORAGE_KEY, getProposals, saveProposals, ensureProposalStore, currentUser };
})();
