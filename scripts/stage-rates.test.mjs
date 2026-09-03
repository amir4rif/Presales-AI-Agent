import assert from 'node:assert/strict';
import test from 'node:test';
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
