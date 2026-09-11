import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  latestLiveProposalVersions,
  rejectionReasonStats,
  visibleProposalVersionsForOwner,
} from '../src/lib/proposal-lifecycle.ts';
import { calculateTwoStageRates } from '../src/lib/stage-rates.ts';
import {
  MIN_COMPLETED_PROJECTS_FOR_ANALYTICS,
  analyticsReadiness,
  calculateMonthlyApprovalRates,
  calculateStageAgeAverages,
  closedDealRate,
  collectRepNames,
} from '../src/lib/analytics-metrics.ts';

const proposal = (caseId, status, outcome = undefined, version = 1) => ({
  caseId,
  status,
  outcome,
  version,
});

test('two-stage rates use approved proposal cases and ignore pending outcomes', () => {
  const proposals = [
    proposal('CASE-1', 'Approved', 'Won'),
    proposal('CASE-2', 'Approved', 'Won'),
    proposal('CASE-3', 'Approved', 'Won'),
    proposal('CASE-4', 'Approved', 'Lost'),
    proposal('CASE-5', 'Approved', 'Pending'),
    proposal('CASE-6', 'Approved', 'Pending'),
    proposal('CASE-7', 'Approved'),
    proposal('CASE-8', 'Approved', 'Pending'),
    proposal('CASE-9', 'Reject & Revise'),
    proposal('CASE-10', 'Reject & Revise'),
  ];

  assert.deepEqual(calculateTwoStageRates(proposals), {
    approved: 8,
    revise: 2,
    killed: 0,
    judged: 10,
    won: 3,
    lost: 1,
    decided: 4,
    approvalRate: 80,
    winRate: 75,
    endToEnd: 60,
  });
});

test('Stage 2 counts each case once and only while its proposal is approved', () => {
  const rates = calculateTwoStageRates([
    proposal('CASE-1', 'Superseded', 'Lost', 1),
    proposal('CASE-1', 'Approved', 'Won', 2),
    proposal('CASE-2', 'Pending Review', 'Won'),
    proposal('CASE-3', 'Reject & Close', 'Won'),
  ]);

  assert.equal(rates.approved, 1);
  assert.equal(rates.won, 1);
  assert.equal(rates.lost, 0);
  assert.equal(rates.decided, 1);
  assert.equal(rates.winRate, 100);
});

test('legacy proposals without a Case ID remain separate cases', () => {
  const rates = calculateTwoStageRates([
    { id: 'PROP-1', caseId: '', status: 'Approved', outcome: 'Won' },
    { id: 'PROP-2', caseId: '', status: 'Approved', outcome: 'Lost' },
  ]);

  assert.equal(rates.approved, 2);
  assert.equal(rates.decided, 2);
  assert.equal(rates.winRate, 50);
});

test('closed-deal rates wait for a three-deal sample', () => {
  assert.equal(closedDealRate(0, 0), null);
  assert.equal(closedDealRate(2, 2), null);
  assert.equal(closedDealRate(2, 3), 67);
});

test('analytics remain gated until three completed projects', () => {
  assert.equal(MIN_COMPLETED_PROJECTS_FOR_ANALYTICS, 3);
  assert.deepEqual(analyticsReadiness(0), {
    completed: 0,
    required: 3,
    remaining: 3,
    ready: false,
    progress: 0,
  });
  assert.deepEqual(analyticsReadiness(2), {
    completed: 2,
    required: 3,
    remaining: 1,
    ready: false,
    progress: 67,
  });
  assert.deepEqual(analyticsReadiness(3), {
    completed: 3,
    required: 3,
    remaining: 0,
    ready: true,
    progress: 100,
  });
});

test('monthly approval trend is built only from recorded review decisions', () => {
  assert.deepEqual(calculateMonthlyApprovalRates([
    { status: 'Approved', reviewedDate: '2026-05-09' },
    { status: 'Reject & Revise', reviewedDate: '10 May 2026', rejectionReason: 'Pricing' },
    { status: 'Superseded', reviewedDate: '12 May 2026', rejectionReason: 'Scope' },
    { status: 'Approved', reviewedDate: '18 Apr 2026' },
    { status: 'Reject & Close', reviewedDate: '20 Apr 2026', rejectionReason: 'Out of scope' },
    { status: 'Approved', reviewedDate: '' },
  ]), [
    { key: '2026-04', label: "Apr '26", approved: 1, revised: 0, judged: 1, rate: 100 },
    { key: '2026-05', label: "May '26", approved: 1, revised: 2, judged: 3, rate: 33 },
  ]);
});

test('stage age averages use active deals and expose missing coverage', () => {
  assert.deepEqual(calculateStageAgeAverages([
    { id: 1, name: 'Prospecting', sla: 7 },
    { id: 2, name: 'Qualified', sla: 14 },
  ], [
    { stage: 1, daysInStage: 3 },
    { stage: 1, daysInStage: 8 },
    { stage: 2, daysInStage: Number.NaN },
  ]), [
    { id: 1, name: 'Prospecting', sla: 7, dealCount: 2, avgDays: 5.5 },
    { id: 2, name: 'Qualified', sla: 14, dealCount: 0, avgDays: null },
  ]);
});

test('salesperson choices come from live profiles and owned records', () => {
  assert.deepEqual(collectRepNames({
    team: [
      { name: 'Real Rep', role: 'Sales Representative', status: 'active' },
      { name: 'Manager', role: 'Sales Manager', status: 'active' },
      { name: 'Inactive Rep', role: 'Sales Representative', status: 'inactive' },
    ],
    deals: [{ rep: 'Pipeline Owner' }],
    closedDeals: [{ rep: 'Historic Owner' }],
    proposals: [{ owner: 'Proposal Owner', submittedBy: 'Real Rep' }],
  }), ['Historic Owner', 'Pipeline Owner', 'Proposal Owner', 'Real Rep']);
});

test('learning-loop reasons count only live Reject & Revise proposals', () => {
  const summary = rejectionReasonStats([
    { status: 'Reject & Revise', rejectionReason: 'Missing information' },
    { status: 'Reject & Revise', rejectionReason: 'Missing information' },
    { status: 'Reject & Revise', rejectionReason: 'Pricing too high' },
    { status: 'Reject & Close', rejectionReason: 'Compliance issue' },
    { status: 'Superseded', rejectionReason: 'Missing information' },
    { status: 'Approved', rejectionReason: 'Legacy stale reason' },
  ]);

  assert.deepEqual(summary.reasons, {
    'Missing information': 2,
    'Pricing too high': 1,
  });
  assert.deepEqual(summary.topReason, ['Missing information', 2]);
});

test('stale older live versions do not affect learning reasons or funnel rates', () => {
  const stalePair = [
    {
      id: 'v1',
      caseId: 'CASE-STALE',
      version: 1,
      status: 'Reject & Revise',
      rejectionReason: 'Missing information',
    },
    {
      id: 'v2',
      caseId: 'CASE-STALE',
      version: 2,
      status: 'Pending Review',
    },
  ];

  assert.deepEqual(rejectionReasonStats(stalePair), { reasons: {}, topReason: null });
  assert.deepEqual(calculateTwoStageRates(stalePair), {
    approved: 0,
    revise: 0,
    killed: 0,
    judged: 0,
    won: 0,
    lost: 0,
    decided: 0,
    approvalRate: 0,
    winRate: 0,
    endToEnd: 0,
  });
});

test('owner proposal list keeps Reject & Close and hides only Superseded versions', () => {
  const visible = visibleProposalVersionsForOwner([
    { id: 'draft', owner: 'Rudy', status: 'Draft' },
    { id: 'closed', owner: 'Renamed Rudy', ownerId: 'profile-rudy', status: 'Reject & Close', rejectionReason: 'Compliance issue' },
    { id: 'superseded', owner: 'Rudy', ownerId: 'profile-rudy', status: 'Superseded' },
    { id: 'same-name-other-id', owner: 'Rudy', ownerId: 'profile-other', status: 'Reject & Close' },
  ], 'Rudy', 'profile-rudy');

  assert.deepEqual(visible.map((proposal) => proposal.id), ['draft', 'closed']);
});

test('owner proposal list defensively shows only the newest live row per case', () => {
  const visible = visibleProposalVersionsForOwner([
    { id: 'v1', caseId: 'CASE-94', version: 1, owner: 'Rudy', status: 'Reject & Revise' },
    { id: 'v2', caseId: 'CASE-94', version: 2, owner: 'Rudy', status: 'Pending Review' },
    { id: 'legacy-a', caseId: '', version: 1, owner: 'Rudy', status: 'Draft' },
    { id: 'legacy-b', caseId: '', version: 1, owner: 'Rudy', status: 'Draft' },
  ], 'Rudy');

  assert.deepEqual(visible.map((proposal) => proposal.id), ['v2', 'legacy-a', 'legacy-b']);
});

test('shared proposal surfaces also collapse stale duplicate live rows', () => {
  const visible = latestLiveProposalVersions([
    { id: 'case-a-v1', caseId: 'CASE-A', version: 1, status: 'Reject & Revise' },
    { id: 'case-b-v1', caseId: 'CASE-B', version: 1, status: 'Approved' },
    { id: 'case-a-v2', caseId: 'CASE-A', version: 2, status: 'Pending Review' },
    { id: 'case-c-old', caseId: 'CASE-C', version: 1, status: 'Superseded' },
  ]);

  assert.deepEqual(visible.map((proposal) => proposal.id), ['case-a-v2', 'case-b-v1']);
});

test('revision-queue and Reject & Close copy describe the live behavior accurately', () => {
  const analyticsPage = readFileSync(
    new URL('../src/app/analytics/page.tsx', import.meta.url),
    'utf8'
  );
  const levelThreeDashboard = readFileSync(
    new URL('../src/components/dashboard/LevelThree.tsx', import.meta.url),
    'utf8'
  );
  const approvalsPage = readFileSync(
    new URL('../src/app/admin/approvals/page.tsx', import.meta.url),
    'utf8'
  );

  for (const surface of [analyticsPage, levelThreeDashboard]) {
    assert.match(surface, /What Needs Fixing Now/);
    assert.match(
      surface,
      /A live view of proposals sent back to sales\. Resolved cases drop off this list\./
    );
    assert.match(surface, /Open for revision vs closed/);
    assert.match(surface, /Nothing waiting for revision\./);
  }

  assert.doesNotMatch(analyticsPage, />AI Learning Loop</);
  assert.doesNotMatch(analyticsPage, /No rejections recorded yet/);
  assert.doesNotMatch(levelThreeDashboard, /title="AI Learning Loop"/);
  assert.doesNotMatch(levelThreeDashboard, /None yet|Nothing sent back yet|Fixable vs dead-end/);
  assert.match(
    approvalsPage,
    /This will end the case permanently\. It cannot be undone\./
  );
  assert.doesNotMatch(approvalsPage, /count as a loss/);
});
