import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  dealsAvailableForProposal,
  isLiveProposalCase,
  visibleDealsForProposal,
} from '../src/lib/proposal-lifecycle.ts';
import { writeProposalRows } from '../src/lib/server/proposal-writer.ts';
import { hasProposalContent } from '../src/lib/proposal-sections.ts';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('only non-whitespace text in a real proposal section is reviewable', () => {
  assert.equal(hasProposalContent({}), false);
  assert.equal(hasProposalContent({ executive: '  \n  ', benefits: '\t' }), false);
  assert.equal(hasProposalContent({ other: 'Unrecognized content' }), false);
  assert.equal(hasProposalContent({ executive: '  Summary\n' }), true);
  assert.equal(hasProposalContent({ nextsteps: 'Plan' }), true);
});

test('the picker offers only visible deals without a live proposal case', () => {
  const deals = [
    { id: 'deal-free', rep: 'Rudy', ownerId: 'rudy' },
    { id: 'deal-hidden-case', rep: 'Rudy', ownerId: 'rudy', caseId: 'CASE-HIDDEN' },
    { id: 'deal-draft', rep: 'Rudy', ownerId: 'rudy' },
    { id: 'deal-revise', rep: 'Rudy', ownerId: 'rudy' },
    { id: 'deal-approved-pending', rep: 'Rudy', ownerId: 'rudy' },
    { id: 'deal-superseded', rep: 'Rudy', ownerId: 'rudy' },
    { id: 'deal-closed-case', rep: 'Rudy', ownerId: 'rudy' },
    { id: 'deal-same-name-only', rep: 'Rudy', ownerId: 'rudy' },
  ];
  const proposals = [
    { dealId: 'deal-draft', status: 'Draft' },
    { dealId: 'deal-revise', status: 'Reject & Revise' },
    { dealId: 'deal-approved-pending', status: 'Approved', outcome: 'Pending' },
    { dealId: 'deal-superseded', status: 'Superseded' },
    { dealId: 'deal-closed-case', status: 'Approved', outcome: 'Won' },
    // A copied display label is not a relationship and must not reserve a deal.
    { company: 'Same display name', deal: 'Same display name', status: 'Draft' },
  ];

  assert.deepEqual(
    dealsAvailableForProposal(deals, proposals).map((deal) => deal.id),
    ['deal-free', 'deal-superseded', 'deal-closed-case', 'deal-same-name-only']
  );
  assert.equal(isLiveProposalCase({ status: 'Reject & Close' }), false);
  assert.equal(isLiveProposalCase({ status: 'Approved', outcome: 'Disqualified' }), false);
});

test('the picker stays empty when every deal already has a live proposal', () => {
  const deals = [
    { id: 'deal-one' },
    { id: 'deal-two' },
  ];
  const proposals = [
    { dealId: 'deal-one', status: 'Draft' },
    { dealId: 'deal-two', status: 'Pending Review' },
  ];

  assert.deepEqual(dealsAvailableForProposal(deals, proposals), []);
});

test('proposal deal visibility mirrors Pipeline ownership scope', () => {
  const deals = [
    { id: 'own', ownerId: 'user-1', rep: 'Rep One' },
    { id: 'other', ownerId: 'user-2', rep: 'Rep Two' },
    { id: 'legacy-own', rep: 'Rep One' },
    { id: 'id-wins-over-name', ownerId: 'user-2', rep: 'Rep One' },
  ];

  assert.deepEqual(
    visibleDealsForProposal(deals, 1, 'Rep One', 'user-1').map((deal) => deal.id),
    ['own', 'legacy-own']
  );
  assert.deepEqual(
    visibleDealsForProposal(deals, 2, 'Manager', 'manager').map((deal) => deal.id),
    deals.map((deal) => deal.id)
  );
});

test('a linked Draft is routed through the atomic RPC instead of a table insert', async () => {
  const calls = [];
  const client = {
    from(table) {
      assert.equal(table, 'proposals');
      return {
        select(columns) {
          assert.equal(columns, 'id,status,updated_at');
          return { async in() { return { data: [], error: null }; } };
        },
        async insert() {
          assert.fail('linked Drafts must not use a direct table insert');
        },
      };
    },
    async rpc(name, args) {
      calls.push([name, args]);
      return { data: { id: 'PROP-LINKED' }, error: null };
    },
  };
  const fail = (context, error) => assert.equal(error, null, context);

  await writeProposalRows(client, [{
    id: 'PROP-LINKED',
    status: 'Draft',
    version: 1,
    company: 'Untrusted display copy',
    deal: 'Untrusted display copy',
    value: 1,
    deal_id: '00000000-0000-0000-0000-000000000123',
    sections: { executive: 'Starter' },
  }], fail);

  assert.deepEqual(calls, [[
    'create_proposal_for_deal',
    {
      p_deal_id: '00000000-0000-0000-0000-000000000123',
      p_proposal_id: 'PROP-LINKED',
      p_sections: { executive: 'Starter' },
    },
  ]]);
});

test('new proposal creation is deal-first, ID-linked, and database-atomic', () => {
  const page = read('../src/app/proposals/page.tsx');
  const data = read('../src/lib/data.ts');
  const writer = read('../src/lib/server/proposal-writer.ts');
  const serverData = read('../src/lib/server/supabase-data.ts');
  const approvals = read('../src/app/admin/approvals/page.tsx');
  const migration = read('../supabase/migrations/20260915095922_link_new_proposals_to_deals.sql');

  assert.doesNotMatch(data, /export const OPPORTUNITIES/);
  assert.doesNotMatch(page, /OPPORTUNITIES|takenOpps|createFromOpportunity/);
  assert.match(page, /const proposalDealPool = useMemo\([\s\S]*dealsAvailableForProposal\(visibleDeals, store\)/);
  assert.match(page, /company: selected\.account,[\s\S]*deal: selected\.account,[\s\S]*value: selected\.value/);
  assert.match(page, /dealId: selected\.id/);
  assert.match(page, /caseId: ''/);
  assert.doesNotMatch(page, /saveDeals|isRemoteDataSource/);
  assert.match(page, /const canonical = ensureProposalStore\(\)\.find\([\s\S]*setEditingId\(canonical\.id\)/);
  assert.match(serverData, /if \(dealId\) row\.deal_id = dealId/);
  assert.match(writer, /client\.rpc\('create_proposal_for_deal'/);

  assert.match(migration, /create or replace function public\.create_proposal_for_deal\(/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /from public\.deals as deal[\s\S]*where deal\.id = p_deal_id[\s\S]*for update/);
  assert.match(migration, /live\.account, live\.account, live\.value/);
  assert.match(migration, /live\.id, 'attached', pg_catalog\.now\(\), live\.prospect_id/);
  assert.match(migration, /insert into public\.proposals[\s\S]*update public\.deals[\s\S]*set case_id = created\.case_id/);
  assert.match(migration, /proposals_clear_deleted_draft_deal_case/);
  assert.match(migration, /if new\.deal_id is not null then[\s\S]*where deal\.id = new\.deal_id/);
  assert.match(migration, /grant execute on function public\.create_proposal_for_deal[\s\S]*to authenticated/);

  assert.match(approvals, /const persisted = await saveProposals\(next\)/);
  assert.doesNotMatch(approvals, /getDeals|saveDeals|isRemoteDataSource/);
  assert.doesNotMatch(migration, /lower\([^\n]*(?:account|company)|(?:account|company)[^\n]*lower\(/i);
});

test('the picker has honest empty, busy, and keyboard-focus states', () => {
  const page = read('../src/app/proposals/page.tsx');
  const css = read('../src/app/styles.css');

  assert.match(page, /Every deal already has a live proposal\./);
  assert.match(page, /Open a new deal in Pipeline first\./);
  assert.match(page, /No live deals are available yet/);
  assert.match(page, /disabled=\{listSaving\}/);
  assert.match(page, /aria-label=\{`Create a proposal for \$\{deal\.account\}`\}/);
  assert.match(page, /maxHeight: 'calc\(100dvh - 32px\)'/);
  assert.match(css, /\.opp-pick\s*\{[^}]*max-height:[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.opp-item:focus-visible/);
  assert.match(css, /\.opp-item:disabled/);
  assert.match(css, /\.opp-empty/);
});
