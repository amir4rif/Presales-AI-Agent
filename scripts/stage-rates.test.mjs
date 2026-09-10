import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  latestLiveProposalVersions,
  rejectionReasonStats,
  visibleProposalVersionsForOwner,
} from '../src/lib/proposal-lifecycle.ts';
import { calculateTwoStageRates } from '../src/lib/stage-rates.ts';

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
