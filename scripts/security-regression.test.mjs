import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { safeNextPath } from '../src/lib/safe-next.ts';
import { safeFilenamePart } from '../src/lib/docExport.ts';
import { buildProposalHTML, buildReportHTML } from '../src/lib/docTemplates.ts';
import { mergeEditedProposalSections } from '../src/lib/proposal-sections.ts';
import { writeProposalRows } from '../src/lib/server/proposal-writer.ts';

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
