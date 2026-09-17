import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  closedDealIdempotencyId,
  closedDealIdentityKey,
  dealDaysInStage,
  dealNeedsOutcome,
  dealOutcomeEscalated,
  dealOutcomeOverdueDays,
  outcomeHygieneByRep,
  scoredClosedDeals,
  stageEnteredDateFromDays,
} from '../src/lib/deal-outcomes.ts';
import {
  dealValueNumber,
  formatDealValueInput,
  normalizeDealValueInput,
} from '../src/lib/deal-inputs.ts';
import { calculateTwoStageRates } from '../src/lib/stage-rates.ts';
import { changesBetween } from '../src/lib/data-changes.ts';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Disqualified is visible history but never scored', () => {
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
  assert.equal(dealOutcomeEscalated(thirteenDays, now, 14), false);
  assert.equal(dealOutcomeEscalated(fourteenDays, now, 14), true);
  assert.equal(fourteenDays.outcome, 'Open');
  assert.deepEqual(outcomeHygieneByRep([justLate, thirteenDays, fourteenDays, future], now, 14), [
    { rep: 'B', needsOutcome: 1, escalated: 1 },
    { rep: 'A', needsOutcome: 2, escalated: 0 },
  ]);
});

test('deal value entry keeps digits only, formats thousands, and yields a safe number', () => {
  assert.equal(normalizeDealValueInput('RM 001,234x'), '1234');
  assert.equal(formatDealValueInput('2500000'), '2,500,000');
  assert.equal(dealValueNumber('2,500,000'), 2_500_000);
  assert.equal(Number.isNaN(dealValueNumber('')), true);
  assert.equal(Number.isNaN(dealValueNumber('9007199254740992')), true);
});

test('days in stage are derived from the stored stage-entry date and advance over time', () => {
  const now = new Date(2026, 8, 17, 12, 0, 0);
  const nextDay = new Date(2026, 8, 18, 12, 0, 0);
  const stageEnteredOn = stageEnteredDateFromDays(5, now);

  assert.equal(stageEnteredOn, '2026-09-12');
  assert.equal(dealDaysInStage({ stageEnteredOn, daysInStage: 999 }, now), 5);
  assert.equal(dealDaysInStage({ stageEnteredOn, daysInStage: 999 }, nextDay), 6);
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
  const prospectPage = read('../src/app/prospects/page.tsx');
  const prospectDetail = read('../src/components/prospects/ProspectDetail.tsx');
  const stageMigration = read('../supabase/migrations/20260917015741_add_deal_stage_entered_on.sql');
  const styles = read('../src/app/styles.css');

  for (const action of ['Close deal', 'Edit', 'Delete']) {
    assert.match(pipeline, new RegExp(`>\\s*${action}\\s*<`));
  }
  assert.match(pipeline, /Needs Outcome/);
  assert.match(pipeline, /executeRemoteDealWorkflow/);
  assert.match(pipeline, /dealDeleteIds/);
  assert.match(addModal, /draft\.outcome === 'Open' && \([\s\S]*draft\.stageEnteredOn/);
  assert.match(addModal, /!draft\.value\.trim\(\)/);
  assert.match(addModal, /draft\.close > localDateKey\(\)/);
  assert.match(addModal, /Close date cannot be in the future when recording a closed deal\./);
  assert.match(addModal, /Record a closed deal\. Pipeline stage details do not apply\./);
  assert.match(addModal, /type="text"[\s\S]*inputMode="numeric"[\s\S]*formatDealValueInput\(draft\.value\)/);
  assert.doesNotMatch(addModal, /type="number"/);
  assert.match(addModal, /Stage entered on \*/);
  assert.match(addModal, /stageEnteredOn: localDateKey\(\)/);
  assert.match(addModal, /close: ''/);
  assert.doesNotMatch(addModal, /draft\.days/);
  assert.match(addModal, /options\.sources\.includes\(draft\.source/);
  assert.match(addModal, /option value="Disqualified"/);
  assert.match(addModal, /repOptions\.map/);
  assert.match(styles, /\.modal \{[^}]*max-height: 90vh;[^}]*overflow-y: auto;/);
  assert.match(pipeline, /includeCurrentUser\(list, name\)/);
  assert.match(pipeline, /closedDealIdempotencyId\(identity\)/);
  assert.match(pipeline, /stageEnteredOn: draft\.stageEnteredOn/);
  assert.doesNotMatch(pipeline, /draft\.days|daysToClose:\s*90/);
  assert.match(prospectPage, /stageEnteredOn: draft\.stageEnteredOn/);
  assert.doesNotMatch(prospectPage, /draft\.days|daysToClose:\s*90/);
  assert.match(prospectDetail, /displayDealDate\(d\.closeDate\)/);
  assert.doesNotMatch(prospectDetail, /Date\.now\(\)\s*\+\s*d\.daysToClose/);
  assert.match(serverData, /stage_entered_on: stageEnteredOn/);
  assert.match(stageMigration, /add column if not exists stage_entered_on date/);
  assert.match(stageMigration, /current_date - greatest\(days_in_stage, 0\)/);
  assert.match(stageMigration, /alter column stage_entered_on set not null/);
  assert.match(approvals, /Proposal outcomes cannot be edited separately/);
  assert.doesNotMatch(approvals, /function saveOutcome/);
  assert.doesNotMatch(prospects, /account|normalizedName/);
  assert.doesNotMatch(lifecycle, /normalizedName|proposal\.company|deal\.account/);
  assert.doesNotMatch(serverData, /legacyDeals|\.in\('account'|\.in\('company'/);
  assert.doesNotMatch(dataChanges, /JSON\.stringify\(\[item\.rep, item\.account/);
});
