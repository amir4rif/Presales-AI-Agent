import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DISQUALIFICATION_REASONS,
  closedDealIdempotencyId,
  closedDealIdentityKey,
  dealNeedsOutcome,
  dealOutcomeEscalated,
  dealOutcomeOverdueDays,
  outcomeHygieneByRep,
  scoredClosedDeals,
} from '../src/lib/deal-outcomes.ts';
import { calculateTwoStageRates } from '../src/lib/stage-rates.ts';
import { changesBetween } from '../src/lib/data-changes.ts';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Disqualified is separate, fixed-reason, visible history but never scored', () => {
  assert.deepEqual(DISQUALIFICATION_REASONS, [
    'Compliance',
    'Blacklisted account',
    'Out of scope',
    'Wrong product fit',
  ]);

  const history = [
    { outcome: 'Won', id: 'won' },
    { outcome: 'Lost', id: 'lost' },
    { outcome: 'Disqualified', id: 'dq' },
  ];
  assert.deepEqual(scoredClosedDeals(history).map((deal) => deal.id), ['won', 'lost']);
  assert.equal(history.length, 3);

  const stageRates = calculateTwoStageRates([
    { caseId: 'W', status: 'Approved', outcome: 'Won' },
    { caseId: 'L', status: 'Approved', outcome: 'Lost' },
    { caseId: 'D', status: 'Approved', outcome: 'Disqualified' },
  ]);
  assert.equal(stageRates.approved, 3);
  assert.equal(stageRates.won, 1);
  assert.equal(stageRates.lost, 1);
  assert.equal(stageRates.decided, 2);
  assert.equal(stageRates.winRate, 50);
});

test('past target dates flag open deals and escalate on day 14 without changing outcome', () => {
  const now = new Date(2026, 8, 15, 12, 0, 0);
  const justLate = { rep: 'A', outcome: 'Open', closeDate: '2026-09-14', daysToClose: 0 };
  const thirteenDays = { rep: 'A', outcome: 'Open', closeDate: '2026-09-02', daysToClose: 0 };
  const fourteenDays = { rep: 'B', outcome: 'Open', closeDate: '2026-09-01', daysToClose: 0 };
  const future = { rep: 'B', outcome: 'Open', closeDate: '2026-09-16', daysToClose: 0 };

  assert.equal(dealNeedsOutcome(justLate, now), true);
  assert.equal(dealOutcomeOverdueDays(justLate, now), 1);
  assert.equal(dealOutcomeEscalated(thirteenDays, now), false);
  assert.equal(dealOutcomeEscalated(fourteenDays, now), true);
  assert.equal(fourteenDays.outcome, 'Open');
  assert.deepEqual(outcomeHygieneByRep([justLate, thirteenDays, fourteenDays, future], now), [
    { rep: 'B', needsOutcome: 1, escalated: 1 },
    { rep: 'A', needsOutcome: 2, escalated: 0 },
  ]);
});

test('deal and closed-deal removals require an explicitly confirmed ID', () => {
  const open = [{ id: 'open-1' }, { id: 'open-2' }];
  const closed = [{ id: 'closed-1' }, { id: 'closed-2' }];
  assert.deepEqual(changesBetween('deals', open, [open[0]]).deletes, []);
  assert.deepEqual(
    changesBetween('deals', open, [open[0]], { dealDeleteIds: ['open-2'] }).deletes,
    [open[1]]
  );
  assert.deepEqual(changesBetween('closedDeals', closed, [closed[0]]).deletes, []);
  assert.deepEqual(
    changesBetween('closedDeals', closed, [closed[0]], { closedDealDeleteIds: ['closed-2'] }).deletes,
    [closed[1]]
  );
});

test('manual closed-deal retries share one normalized identity and stable UUID', async () => {
  const original = {
    rep: 'Rudy Lee',
    account: 'Beta Holdings',
    closeDate: '2026-08-20',
    value: 2_500_000,
  };
  const retry = {
    rep: '  RUDY   LEE ',
    account: ' beta holdings ',
    closeDate: '2026-08-20',
    value: 2_500_000.00,
  };

  assert.equal(closedDealIdentityKey(retry), closedDealIdentityKey(original));
  assert.equal(
    await closedDealIdempotencyId(retry),
    await closedDealIdempotencyId(original)
  );
  assert.match(
    await closedDealIdempotencyId(original),
    /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
  assert.notEqual(
    await closedDealIdempotencyId({ ...original, value: original.value + 1 }),
    await closedDealIdempotencyId(original)
  );
});

test('database migration owns the atomic close and proposal link invariants', () => {
  const migration = read('../supabase/migrations/20260915081311_deal_outcomes_and_proposal_links.sql');

  assert.match(migration, /outcome in \('Won', 'Lost', 'Disqualified'\)/);
  assert.match(migration, /disqualification_reason in \([\s\S]*'Compliance'[\s\S]*'Blacklisted account'[\s\S]*'Out of scope'[\s\S]*'Wrong product fit'/);
  assert.match(migration, /create or replace function public\.close_deal\(/);
  assert.match(migration, /insert into public\.closed_deals[\s\S]*delete from public\.deals where id = live\.id/);
  assert.match(migration, /insert into public\.closed_deals \([\s\S]*id, owner_id[\s\S]*live\.id, live\.owner_id/);
  assert.match(migration, /update public\.proposals[\s\S]*set outcome = p_outcome[\s\S]*where deal_id = live\.id/);
  assert.match(migration, /p_outcome = 'Disqualified' and access_level < 2[\s\S]*pending_disqualification_reason = p_reason/);
  assert.match(migration, /create or replace function public\.review_deal_disqualification\(/);
  assert.match(migration, /disqualification_approved_by_id/);
  assert.match(migration, /proposals_one_live_case_per_deal_idx/);
  assert.match(migration, /This deal already has a live proposal case/);
  assert.match(migration, /where deal\.opportunity_id = new\.opportunity_id/);
  assert.match(migration, /new\.deal_link_action := 'attached'/);
  assert.match(migration, /new\.deal_link_action := 'created'/);
  assert.match(migration, /new\.status not in \('Approved', 'Reject & Close'\)/);
  assert.match(migration, /new\.status = 'Reject & Close'[\s\S]*'Disqualified'[\s\S]*new\.rejection_reason/);
  assert.match(migration, /grant execute on function public\.close_deal[\s\S]*to authenticated/);
  assert.doesNotMatch(migration, /lower\([^\n]*(?:account|company)|(?:account|company)[^\n]*lower\(/i);
  assert.doesNotMatch(migration, /set\s+(?:deal_id|case_id)[^;]*(?:account|company)/i);
});

test('UI exposes the required actions and never edits proposal outcome independently', () => {
  const pipeline = read('../src/app/pipeline/page.tsx');
  const addModal = read('../src/components/deals/AddDealModal.tsx');
  const approvals = read('../src/app/admin/approvals/page.tsx');
  const prospects = read('../src/lib/prospect-deals.ts');
  const lifecycle = read('../src/lib/prospect-lifecycle.ts');
  const serverData = read('../src/lib/server/supabase-data.ts');
  const dataChanges = read('../src/lib/data-changes.ts');
  const styles = read('../src/app/styles.css');

  for (const action of ['Close deal', 'Edit', 'Delete']) {
    assert.match(pipeline, new RegExp(`>\\s*${action}\\s*<`));
  }
  assert.match(pipeline, /Needs Outcome/);
  assert.match(pipeline, /executeRemoteDealWorkflow/);
  assert.match(pipeline, /dealDeleteIds/);
  assert.match(addModal, /draft\.outcome === 'Open' && \([\s\S]*Days in Stage/);
  assert.match(addModal, /!draft\.value\.trim\(\)/);
  assert.match(addModal, /draft\.close > localDateKey\(\)/);
  assert.match(addModal, /Close date cannot be in the future when recording a closed deal\./);
  assert.match(addModal, /Record a closed deal\. Stage and Days in Stage do not apply\./);
  assert.match(addModal, /DEAL_SOURCES\.includes\(draft\.source/);
  assert.match(addModal, /option value="Disqualified"/);
  assert.match(addModal, /repOptions\.map/);
  assert.match(styles, /\.modal \{[^}]*max-height: 90vh;[^}]*overflow-y: auto;/);
  assert.match(pipeline, /includeCurrentUser\(list, name\)/);
  assert.match(pipeline, /closedDealIdempotencyId\(identity\)/);
  assert.match(approvals, /Proposal outcomes cannot be edited separately/);
  assert.doesNotMatch(approvals, /function saveOutcome/);
  assert.doesNotMatch(prospects, /account|normalizedName/);
  assert.doesNotMatch(lifecycle, /normalizedName|proposal\.company|deal\.account/);
  assert.doesNotMatch(serverData, /legacyDeals|\.in\('account'|\.in\('company'/);
  assert.doesNotMatch(dataChanges, /JSON\.stringify\(\[item\.rep, item\.account/);
});
