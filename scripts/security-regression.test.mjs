import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { safeNextPath } from '../src/lib/safe-next.ts';
import { safeFilenamePart } from '../src/lib/docExport.ts';
import { buildProposalHTML, buildReportHTML } from '../src/lib/docTemplates.ts';
import { resolveProfileIdFromWire } from '../src/lib/profile-identity.ts';
import { mergeEditedProposalSections } from '../src/lib/proposal-sections.ts';
import { dealsForProspect } from '../src/lib/prospect-deals.ts';
import { writeProposalRows } from '../src/lib/server/proposal-writer.ts';
import { scopedStorageKey } from '../src/lib/user-storage.ts';

test('post-auth redirects stay on the application origin', () => {
  assert.equal(safeNextPath('/prospects?view=mine'), '/prospects?view=mine');
  assert.equal(safeNextPath('//evil.example'), '/dashboard');
  assert.equal(safeNextPath('/\\evil.example'), '/dashboard');
  assert.equal(safeNextPath('/%5c%5cevil.example'), '/dashboard');
  assert.equal(safeNextPath('/%252f%252fevil.example'), '/dashboard');
  assert.equal(safeNextPath('https://evil.example'), '/dashboard');
});

test('generated documents escape prospect and model-provided HTML', () => {
  const prospect = {
    name: '<img src=x onerror=alert(1)>',
    type: 'Technology',
    country: 'Malaysia',
    employees: '100',
    painPoints: ['</div><script>alert(1)</script>'],
  };
  const data = {
    executiveSummary: '<svg onload=alert(1)>',
    keyPainPoints: ['<iframe src=javascript:alert(1)>'],
    recommendedSolutions: [{ product: '<object>', reason: '<embed>' }],
    nextSteps: ['<script>alert(1)</script>'],
    pricing: { items: [{ item: '<img>', description: '<script>', cost: '=1+1' }] },
    timeline: [{ phase: '<iframe>', duration: 'Now', description: '<svg>' }],
    whyRamssol: [{ title: '<object>', detail: '<embed>' }],
  };

  const report = buildReportHTML(data, prospect);
  const proposal = buildProposalHTML(data, prospect);
  for (const html of [report, proposal]) {
    assert.doesNotMatch(html, /<(?:script|img|iframe|object|embed|svg)(?:\s|>)/i);
    assert.match(html, /&lt;/);
  }
});

test('malformed model arrays cannot crash document generation', () => {
  const prospect = {
    name: 'Example',
    type: 'Technology',
    country: 'Malaysia',
    employees: '100',
    painPoints: [],
  };
  assert.doesNotThrow(() => buildReportHTML({ keyPainPoints: 'bad-shape' }, prospect));
  assert.doesNotThrow(() => buildProposalHTML({ timeline: 'bad-shape' }, prospect));
});

test('download filenames exclude path and platform metacharacters', () => {
  assert.equal(safeFilenamePart('ACME / APAC:*?'), 'ACME_APAC');
  assert.equal(safeFilenamePart(' ... '), 'document');
});

test('proposal persistence keeps untouched and missing sections out of storage', () => {
  const stored = { executive: 'Acme-specific summary' };
  const editor = {
    ...stored,
    challenges: 'Unrelated boilerplate that was never edited',
    solution: 'An edited Acme solution',
  };

  const untouched = mergeEditedProposalSections(stored, editor, []);
  assert.equal(untouched.changed, false);
  assert.strictEqual(untouched.sections, stored);

  const edited = mergeEditedProposalSections(stored, editor, ['solution']);
  assert.equal(edited.changed, true);
  assert.deepEqual(edited.sections, {
    executive: 'Acme-specific summary',
    solution: 'An edited Acme solution',
  });
  assert.equal('challenges' in edited.sections, false);
});

test('existing proposal writes use UPDATE while new client-generated IDs still use INSERT', () => {
  const calls = [];
  const client = {
    from(table) {
      assert.equal(table, 'proposals');
      return {
        select(columns) {
          assert.equal(columns, 'id');
          return {
            async in(column, ids) {
              calls.push(['lookup', column, ids]);
              return { data: [{ id: 'PROP-EXISTING' }], error: null };
            },
          };
        },
        async insert(rows) {
          calls.push(['insert', rows]);
          return { error: null };
        },
        update(row) {
          assert.equal('id' in row, false);
          return {
            async eq(column, id) {
              calls.push(['update', row, column, id]);
              return { error: null };
            },
          };
        },
      };
    },
  };
  const fail = (context, error) => {
    assert.equal(error, null, context);
  };
  const existing = { id: 'PROP-EXISTING', company: 'Existing account' };
  const created = { id: 'PROP-NEW', company: 'New account' };

  return writeProposalRows(client, [existing, created], fail).then(() => {
    assert.deepEqual(calls, [
      ['lookup', 'id', ['PROP-EXISTING', 'PROP-NEW']],
      ['insert', [created]],
      ['update', { company: 'Existing account' }, 'id', 'PROP-EXISTING'],
    ]);
  });
});

test("Level 2 cannot edit or submit another rep's Draft proposal", () => {
  const migration = readFileSync(
    new URL(
      '../supabase/migrations/20260903024254_enforce_proposal_draft_ownership.sql',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(
    migration,
    /old\.status = 'Draft' and\s+old\.owner_id is distinct from \(select auth\.uid\(\)\)/
  );
  assert.match(
    migration,
    /old\.status = 'Draft' and\s+old\.owner_id = \(select auth\.uid\(\)\) and\s+new\.status in \('Draft', 'Pending Review'\)/
  );
  assert.match(migration, /Only the proposal owner can edit or submit a draft\./);
});

test('proposal deletion is owner-only, Draft-only, and reaches the database policy', () => {
  const migration = readFileSync(
    new URL(
      '../supabase/migrations/20260907011834_allow_proposal_owner_draft_delete.sql',
      import.meta.url
    ),
    'utf8'
  );
  const serverData = readFileSync(new URL('../src/lib/server/supabase-data.ts', import.meta.url), 'utf8');
  const dataSync = readFileSync(new URL('../src/lib/data-sync.ts', import.meta.url), 'utf8');
  const proposalsPage = readFileSync(new URL('../src/app/proposals/page.tsx', import.meta.url), 'utf8');

  assert.match(migration, /create policy "proposals_delete_own_draft"/);
  assert.match(
    migration,
    /using \(owner_id = \(select auth\.uid\(\)\) and status = 'Draft'\)/
  );
  assert.match(migration, /grant delete on public\.proposals to authenticated/);
  assert.match(serverData, /from\('proposals'\)\.delete\(\)\.in\('id', ids\)/);
  assert.doesNotMatch(serverData, /Proposal versions are permanent and cannot be deleted/);
  assert.doesNotMatch(dataSync, /const deletes = collection === 'proposals'/);
  assert.match(proposalsPage, /p\.status === 'Draft'[\s\S]*deleteProposal\(p\.id\)/);
  assert.match(proposalsPage, /confirm\(`Delete draft proposal/);
  assert.doesNotMatch(proposalsPage, /permanent in Supabase, including drafts/);
});

test('prospect research uses a separate Gemini key and Google Search grounding', () => {
  const route = readFileSync(new URL('../src/app/api/research/route.ts', import.meta.url), 'utf8');
  const config = readFileSync(new URL('../src/lib/server/config.ts', import.meta.url), 'utf8');
  const envExample = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  const envCheck = readFileSync(new URL('../scripts/check-env.mjs', import.meta.url), 'utf8');
  const prospectModal = readFileSync(
    new URL('../src/components/prospects/AddProspectModal.tsx', import.meta.url),
    'utf8'
  );

  assert.match(route, /new GoogleGenAI/);
  assert.match(route, /tools: \[\{ googleSearch: \{\} \}\]/);
  assert.match(route, /grounding\?\.groundingChunks/);
  assert.match(route, /Google did not return the required Search Suggestions/);
  assert.match(config, /env\('RESEARCH_GEMINI_API_KEY'\)/);
  assert.match(envExample, /RESEARCH_GEMINI_API_KEY=/);
  assert.match(envCheck, /RESEARCH_GEMINI_API_KEY/);
  assert.match(prospectModal, /dangerouslySetInnerHTML=\{\{ __html: groundedWeb\.searchEntryPointHtml \}\}/);
  assert.match(prospectModal, /setResearch\(parsed\)/);
});

test('profile-name fallback rejects ambiguity while explicit IDs remain authoritative', async () => {
  let loads = 0;
  const loadProfiles = async () => {
    loads += 1;
    return [
      { id: 'profile-a', name: 'Same Name' },
      { id: 'profile-b', name: ' same name ' },
    ];
  };

  assert.equal(
    await resolveProfileIdFromWire(
      { owner: 'Same Name', ownerId: 'profile-a' },
      'owner',
      'ownerId',
      loadProfiles,
      'fallback-id'
    ),
    'profile-a'
  );
  assert.equal(loads, 0);

  await assert.rejects(
    resolveProfileIdFromWire(
      { owner: 'Same Name' },
      'owner',
      'ownerId',
      loadProfiles,
      'fallback-id'
    ),
    /matches multiple profiles; include ownerId/
  );
  assert.equal(loads, 1);
});

test('My Proposals database view keeps Reject & Close cases visible', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20260903040000_keep_closed_proposals_visible.sql', import.meta.url),
    'utf8'
  );
  const whereClause = migration.match(/where[\s\S]*?;/)?.[0] || '';
  assert.match(migration, /where status <> 'Superseded'/);
  assert.doesNotMatch(whereClause, /Reject & Close/);
});

test('notification browser storage is scoped to a stable user identity', () => {
  const first = scopedStorageKey('ramssolNotifCenter', 'user-a');
  const second = scopedStorageKey('ramssolNotifCenter', 'user-b');
  assert.notEqual(first, second);
  assert.equal(first, 'ramssolNotifCenter:user-a');
  assert.equal(
    scopedStorageKey('ramssolNotify', 'person@example.com'),
    'ramssolNotify:person%40example.com'
  );
});

test('proposal notifications are durable, recipient-scoped, and trigger-driven', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20260903050000_deliver_recipient_notifications.sql', import.meta.url),
    'utf8'
  );
  const proposalsPage = readFileSync(
    new URL('../src/app/proposals/page.tsx', import.meta.url),
    'utf8'
  );
  const approvalsPage = readFileSync(
    new URL('../src/app/admin/approvals/page.tsx', import.meta.url),
    'utf8'
  );

  assert.match(migration, /alter table public\.notifications enable row level security/);
  assert.match(migration, /recipient_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /profile\.level >= 2/);
  assert.match(migration, /new\.owner_id is distinct from actor/);
  assert.match(migration, /after insert or update of status on public\.proposals/);
  assert.doesNotMatch(migration, /grant\s+insert[^;]*notifications\s+to authenticated/i);
  assert.doesNotMatch(proposalsPage, /\bnotify\s*\(/);
  assert.doesNotMatch(approvalsPage, /\bnotify\s*\(/);
});

test('related deals use a prospect id, or an exact full-name legacy fallback', () => {
  const prospects = [
    { id: 1, name: ' Petronas ' },
    { id: 2, name: 'Healthcare Partners Bhd' },
  ];
  const deals = [
    { prospectId: 1, account: 'Petronas transformation' },
    { prospectId: 2, account: 'Petronas' },
    { account: 'Petronas' },
    { account: 'Healthcare Holdings' },
    { account: ' Healthcare Partners Bhd ' },
  ];

  assert.deepEqual(dealsForProspect(deals, prospects[0]), [deals[0], deals[2]]);
  assert.deepEqual(dealsForProspect(deals, prospects[1]), [deals[1], deals[4]]);
  assert.deepEqual(dealsForProspect(deals, { id: 3, name: '   ' }), []);
});

test('Add Deal resets all modal fields and persists the prospect relationship', () => {
  const page = readFileSync(new URL('../src/app/prospects/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /function emptyDealForm\(\)[\s\S]*stage: '1'/);
  assert.match(page, /function close\(\)\s*{\s*setDeal\(emptyDealForm\(\)\);\s*onClose\(\);/);
  assert.match(page, /key={open\.id}/);
  assert.match(page, /prospectId: prospect\.id/);
});

test('prospect names are trimmed at both the client and database boundaries', () => {
  const modal = readFileSync(
    new URL('../src/components/prospects/AddProspectModal.tsx', import.meta.url),
    'utf8'
  );
  const migration = readFileSync(
    new URL('../supabase/migrations/20260903051000_link_deals_to_prospects.sql', import.meta.url),
    'utf8'
  );
  assert.match(modal, /const companyName = f\.name\.trim\(\)/);
  assert.match(migration, /new\.name := btrim\(new\.name\)/);
  assert.match(migration, /add column prospect_id bigint references public\.prospects\(id\)/);
});
