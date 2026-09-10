import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { safeNextPath } from '../src/lib/safe-next.ts';
import { safeFilenamePart } from '../src/lib/docExport.ts';
import { buildProposalHTML, buildReportHTML } from '../src/lib/docTemplates.ts';
import { resolveProfileIdFromWire } from '../src/lib/profile-identity.ts';
import {
  conflictingProposalSectionKeys,
  currentProposalSectionEditRevisions,
  enqueueProposalDraftPersist,
  mergeEditedProposalSections,
  rebaseProposalEditorSections,
  remainingProposalSectionEditRevisions,
} from '../src/lib/proposal-sections.ts';
import {
  clearProposalRevisionWorkingCopy,
  loadProposalRevisionWorkingCopy,
  saveProposalRevisionWorkingCopy,
} from '../src/lib/proposal-working-copy.ts';
import { changesBetween, mergeProposalSnapshot } from '../src/lib/data-changes.ts';
import { dealsForProspect } from '../src/lib/prospect-deals.ts';
import {
  canManageProspect,
  hasProspectDependencies,
  prospectDependencies,
} from '../src/lib/prospect-lifecycle.ts';
import {
  deleteDraftProposalRows,
  writeProposalRows,
} from '../src/lib/server/proposal-writer.ts';
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

test('proposal editor rebases canonical changes without erasing explicit local edits', () => {
  const canonical = {
    executive: 'Updated remotely',
    solution: 'New canonical solution',
    commercials: 'New canonical commercials',
  };
  const local = {
    executive: 'Explicit local rewrite',
    solution: 'Stale editor copy',
    commercials: 'Stale editor copy',
  };

  const editable = rebaseProposalEditorSections(canonical, local, ['executive'], {
    sameProposal: true,
    editable: true,
  });
  assert.deepEqual(editable, {
    sections: {
      executive: 'Explicit local rewrite',
      solution: 'New canonical solution',
      commercials: 'New canonical commercials',
    },
    editedKeys: ['executive'],
  });

  for (const options of [
    { sameProposal: false, editable: true },
    { sameProposal: true, editable: false },
  ]) {
    assert.deepEqual(rebaseProposalEditorSections(canonical, local, ['executive'], options), {
      sections: canonical,
      editedKeys: [],
    });
  }
});

test('proposal editor distinguishes remote conflicts from its own acknowledged save', () => {
  const previous = { executive: 'Original', solution: 'Original solution' };
  const remote = { executive: 'Changed in another tab', solution: 'Remote solution' };

  assert.deepEqual(
    conflictingProposalSectionKeys(previous, remote, ['executive']),
    ['executive']
  );
  assert.deepEqual(
    conflictingProposalSectionKeys(previous, remote, ['executive'], {
      executive: 'Changed in another tab',
    }),
    []
  );
  assert.deepEqual(
    conflictingProposalSectionKeys(previous, remote, ['commercials']),
    []
  );
  assert.deepEqual(
    conflictingProposalSectionKeys(previous, remote, ['executive'], undefined, {
      executive: 'Changed in another tab',
    }),
    []
  );
});

test('editable proposal working copies survive SPA navigation and flag changed revisions', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const allowed = new Set(['executive', 'commercials']);

  saveProposalRevisionWorkingCopy(
    storage,
    'user-1',
    'PROP-1',
    'writer-1',
    '2026-09-10T01:00:00.000Z',
    { executive: 'Original', commercials: 'Canonical' },
    { executive: 'Local revision', commercials: 'Canonical' },
    ['executive']
  );
  assert.deepEqual(
    loadProposalRevisionWorkingCopy(
      storage,
      'user-1',
      'PROP-1',
      '2026-09-10T01:00:00.000Z',
      { executive: 'Original', commercials: 'Canonical' },
      allowed
    ),
    {
      writerId: 'writer-1',
      canonicalUpdatedAt: '2026-09-10T01:00:00.000Z',
      canonicalSections: { executive: 'Original' },
      conflictKeys: [],
      editedKeys: ['executive'],
      sections: { executive: 'Local revision' },
    }
  );
  assert.deepEqual(
    loadProposalRevisionWorkingCopy(
      storage,
      'user-1',
      'PROP-1',
      '2026-09-10T01:00:00.000Z',
      { executive: 'Local revision', commercials: 'Canonical' },
      allowed
    ),
    {
      writerId: 'writer-1',
      canonicalUpdatedAt: '2026-09-10T01:00:00.000Z',
      canonicalSections: { executive: 'Original' },
      conflictKeys: [],
      editedKeys: ['executive'],
      sections: { executive: 'Local revision' },
    }
  );
  assert.deepEqual(
    loadProposalRevisionWorkingCopy(
      storage,
      'user-1',
      'PROP-1',
      '2026-09-10T01:00:00.000Z',
      { executive: 'Remote revision', commercials: 'Canonical' },
      allowed
    )?.conflictKeys,
    ['executive']
  );
  assert.deepEqual(
    loadProposalRevisionWorkingCopy(
      storage,
      'user-1',
      'PROP-1',
      '2026-09-10T01:00:01.000Z',
      { executive: 'Remote revision', commercials: 'Canonical' },
      allowed
    ),
    {
      writerId: 'writer-1',
      canonicalUpdatedAt: '2026-09-10T01:00:00.000Z',
      canonicalSections: { executive: 'Original' },
      conflictKeys: ['executive'],
      editedKeys: ['executive'],
      sections: { executive: 'Local revision' },
    }
  );
  assert.equal(values.size, 1);
  assert.deepEqual(
    loadProposalRevisionWorkingCopy(
      storage,
      'user-1',
      'PROP-1',
      '2026-09-10T01:00:01.000Z',
      { executive: 'Local revision', commercials: 'Changed elsewhere' },
      allowed
    ),
    {
      writerId: 'writer-1',
      canonicalUpdatedAt: '2026-09-10T01:00:00.000Z',
      canonicalSections: { executive: 'Original' },
      conflictKeys: [],
      editedKeys: ['executive'],
      sections: { executive: 'Local revision' },
    }
  );
  assert.equal(values.size, 1);
});

test('stale editor completions cannot overwrite or clear a newer working copy', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const allowed = new Set(['executive']);
  const canonical = { executive: 'Original' };

  assert.equal(saveProposalRevisionWorkingCopy(
    storage,
    'user-1',
    'PROP-1',
    'writer-old',
    '2026-09-10T01:00:00.000Z',
    canonical,
    { executive: 'Old local revision' },
    ['executive']
  ), true);
  assert.equal(saveProposalRevisionWorkingCopy(
    storage,
    'user-1',
    'PROP-1',
    'writer-new',
    '2026-09-10T01:00:00.000Z',
    canonical,
    { executive: 'New local revision' },
    ['executive']
  ), true);

  assert.equal(saveProposalRevisionWorkingCopy(
    storage,
    'user-1',
    'PROP-1',
    'writer-old',
    '2026-09-10T01:00:00.000Z',
    canonical,
    { executive: 'Late old completion' },
    ['executive'],
    [],
    { expectedWriterId: 'writer-old' }
  ), false);
  assert.equal(clearProposalRevisionWorkingCopy(
    storage,
    'user-1',
    'PROP-1',
    'writer-old'
  ), false);
  assert.deepEqual(loadProposalRevisionWorkingCopy(
    storage,
    'user-1',
    'PROP-1',
    '2026-09-10T01:00:00.000Z',
    canonical,
    allowed
  ), {
    writerId: 'writer-new',
    canonicalUpdatedAt: '2026-09-10T01:00:00.000Z',
    canonicalSections: canonical,
    conflictKeys: [],
    editedKeys: ['executive'],
    sections: { executive: 'New local revision' },
  });
  assert.equal(clearProposalRevisionWorkingCopy(
    storage,
    'user-1',
    'PROP-1',
    'writer-new'
  ), true);
  assert.equal(values.size, 0);
});

test('claiming a recovered optimistic working copy preserves its original baseline', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const allowed = new Set(['executive']);
  const optimisticCanonical = { executive: 'Local revision' };

  saveProposalRevisionWorkingCopy(
    storage,
    'user-1',
    'PROP-1',
    'writer-old',
    '2026-09-10T01:00:00.000Z',
    { executive: 'Original' },
    { executive: 'Local revision' },
    ['executive']
  );
  const restored = loadProposalRevisionWorkingCopy(
    storage,
    'user-1',
    'PROP-1',
    '2026-09-10T01:00:00.000Z',
    optimisticCanonical,
    allowed
  );
  assert.ok(restored);

  saveProposalRevisionWorkingCopy(
    storage,
    'user-1',
    'PROP-1',
    'writer-new',
    restored.canonicalUpdatedAt,
    restored.canonicalSections,
    { ...optimisticCanonical, ...restored.sections },
    restored.editedKeys,
    restored.conflictKeys
  );
  assert.deepEqual(loadProposalRevisionWorkingCopy(
    storage,
    'user-1',
    'PROP-1',
    '2026-09-10T01:00:00.000Z',
    optimisticCanonical,
    allowed
  ), {
    writerId: 'writer-new',
    canonicalUpdatedAt: '2026-09-10T01:00:00.000Z',
    canonicalSections: { executive: 'Original' },
    conflictKeys: [],
    editedKeys: ['executive'],
    sections: { executive: 'Local revision' },
  });
});

test('completed autosaves clear only the exact edit revisions they persisted', () => {
  const current = new Map([
    ['executive', 3],
    ['commercials', 2],
  ]);
  const persisted = new Map([
    ['executive', 1],
    ['commercials', 2],
  ]);

  assert.deepEqual(
    remainingProposalSectionEditRevisions(current, persisted),
    new Map([['executive', 3]])
  );
  assert.deepEqual(current, new Map([
    ['executive', 3],
    ['commercials', 2],
  ]));

  assert.deepEqual(
    currentProposalSectionEditRevisions(current, persisted),
    new Map([['commercials', 2]])
  );
});

test('Draft autosaves are serialized before the next canonical snapshot is read', async () => {
  let releaseFirst;
  let markFirstStarted;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
  const reads = [];
  let canonicalRevision = 'old-token';

  const first = enqueueProposalDraftPersist(null, async () => {
    reads.push(canonicalRevision);
    markFirstStarted();
    await firstGate;
    canonicalRevision = 'new-token';
    return true;
  });
  const second = enqueueProposalDraftPersist(first, async () => {
    reads.push(canonicalRevision);
    return true;
  });

  await firstStarted;
  assert.deepEqual(reads, ['old-token']);
  releaseFirst();
  assert.equal(await second, true);
  assert.deepEqual(reads, ['old-token', 'new-token']);
});

test('a Draft autosave delayed by global sync reads the latest edit revisions', async () => {
  let releaseSync;
  const syncGate = new Promise((resolve) => { releaseSync = resolve; });
  const edits = new Map([['executive', 1]]);
  const editor = { executive: 'Local revision' };
  const writes = [];

  const operation = enqueueProposalDraftPersist(null, async () => {
    await syncGate;
    const effectiveEdits = new Map(edits);
    if (!effectiveEdits.size) return true;
    writes.push({ sections: { ...editor }, edits: effectiveEdits });
    return true;
  });
  await Promise.resolve();
  edits.clear();
  editor.executive = 'Confirmed original';
  releaseSync();

  assert.equal(await operation, true);
  assert.deepEqual(writes, []);
});

test('Draft autosave failures are caller-owned while canonical rollback remains mandatory', () => {
  const proposalsPage = readFileSync(
    new URL('../src/app/proposals/page.tsx', import.meta.url),
    'utf8'
  );
  const dataSync = readFileSync(new URL('../src/lib/data-sync.ts', import.meta.url), 'utf8');

  assert.match(
    proposalsPage,
    /saveProposals\(next, \{ suppressSyncError: true \}\)/
  );
  assert.match(proposalsPage, /draftPersistRef\.current === operation[\s\S]*Draft not saved/);
  assert.match(
    dataSync,
    /restoreCanonicalCollection\(collection\);[\s\S]*if \(!options\.suppressSyncError\)/
  );
  assert.match(
    dataSync,
    /async function refreshRemoteData\(\)[\s\S]*post-write hydration owns its error[\s\S]*\.catch\(\(\) => undefined\)/
  );
  assert.doesNotMatch(dataSync, /void refreshRemoteData\(\)\.catch/);
  assert.match(
    proposalsPage,
    /async function openEditor\(id: string\)[\s\S]*await runProposalDataTransaction\(\(\) => \{[\s\S]*const latestStore = ensureProposalStore\(\)/
  );
  assert.match(
    proposalsPage,
    /const operation = runProposalDataTransaction\(async \(\) => \{[\s\S]*const effectiveEdits = new Map\(editedSectionRevisions\.current\);[\s\S]*const capturedSections = \{ \.\.\.editorSectionsRef\.current \}/
  );
  assert.match(
    proposalsPage,
    /confirmedCollectionSnapshot<Proposal>\('proposals'\)[\s\S]*restored\.canonicalUpdatedAt[\s\S]*restored\.canonicalSections/
  );
  assert.match(
    dataSync,
    /export async function waitForPendingDataSync\(\)[\s\S]*pending === syncQueue/
  );
  assert.match(
    dataSync,
    /export function runProposalDataTransaction<[\s\S]*proposalTransactionCoordinator\.run[\s\S]*await waitForPendingDataSync\(\);[\s\S]*return transaction\(\)/
  );
  assert.match(
    dataSync,
    /function restoreCanonicalCollection[\s\S]*new Event\('rams:remote-data'\)/
  );
});

test('proposal updates are timestamp-safe and use status plus updated_at compare-and-swap', async () => {
  const calls = [];
  const client = {
    from(table) {
      assert.equal(table, 'proposals');
      return {
        select(columns) {
          assert.equal(columns, 'id,status,updated_at');
          return {
            async in(column, ids) {
              calls.push(['lookup', column, ids]);
              return {
                data: [{
                  id: 'PROP-EXISTING',
                  status: 'Draft',
                  updated_at: '2026-09-07T01:02:03.456Z',
                }],
                error: null,
              };
            },
          };
        },
        async insert(rows) {
          calls.push(['insert', rows]);
          return { error: null };
        },
        update(row) {
          assert.equal('id' in row, false);
          const filters = [];
          const query = {
            eq(column, value) {
              filters.push([column, value]);
              return query;
            },
            async select(columns) {
              calls.push(['update', row, filters, columns]);
              return { data: [{ id: 'PROP-EXISTING' }], error: null };
            },
          };
          return query;
        },
      };
    },
  };
  const fail = (context, error) => {
    assert.equal(error, null, context);
  };
  const existing = {
    id: 'PROP-EXISTING',
    case_id: 'CASE-ORIGINAL',
    version: 1,
    status: 'Draft',
    opportunity_id: 'OPP-1',
    company: 'Existing account',
    deal: 'Draft proposal',
    value: 123,
    sections: { commercials: 'Edited' },
    generated_on: '2026-09-01',
    submitted_at: '2026-09-01T00:00:00.000Z',
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-07T01:02:03.456Z',
  };
  await writeProposalRows(client, [existing], fail);

  assert.deepEqual(calls, [
    ['lookup', 'id', ['PROP-EXISTING']],
    ['update', {
      status: 'Draft',
      opportunity_id: 'OPP-1',
      company: 'Existing account',
      deal: 'Draft proposal',
      value: 123,
      sections: { commercials: 'Edited' },
    }, [
      ['id', 'PROP-EXISTING'],
      ['status', 'Draft'],
      ['updated_at', '2026-09-07T01:02:03.456Z'],
    ], 'id'],
  ]);
  assert.equal('case_id' in calls[1][1], false);
  assert.equal('version' in calls[1][1], false);
  assert.equal('generated_on' in calls[1][1], false);
  assert.equal('submitted_at' in calls[1][1], false);
  assert.equal('created_at' in calls[1][1], false);
  assert.equal('updated_at' in calls[1][1], false);
});

test('new proposal inserts discard inherited server timestamps', async () => {
  let inserted = null;
  const client = {
    from() {
      return {
        select() {
          return { async in() { return { data: [], error: null }; } };
        },
        async insert(rows) {
          inserted = rows;
          return { error: null };
        },
      };
    },
  };
  const fail = (context, error) => assert.equal(error, null, context);

  await writeProposalRows(client, [{
    id: 'PROP-NEW',
    company: 'New account',
    created_at: 'inherited-created-at',
    updated_at: 'inherited-updated-at',
  }], fail);

  assert.deepEqual(inserted, [{ id: 'PROP-NEW', company: 'New account' }]);
});

test('submitted proposal review updates omit immutable content and submission timestamps', async () => {
  let written = null;
  const client = {
    from(table) {
      assert.equal(table, 'proposals');
      return {
        select(columns) {
          assert.equal(columns, 'id,status,updated_at');
          return {
            async in() {
              return {
                data: [{
                  id: 'PROP-REVIEW',
                  status: 'Pending Review',
                  updated_at: '2026-09-07T03:04:05.678Z',
                }],
                error: null,
              };
            },
          };
        },
        update(row) {
          const filters = [];
          const query = {
            eq(column, value) {
              filters.push([column, value]);
              return query;
            },
            async select(columns) {
              written = { row, filters, columns };
              return { data: [{ id: 'PROP-REVIEW' }], error: null };
            },
          };
          return query;
        },
      };
    },
  };
  const fail = (context, error) => assert.equal(error, null, context);
  await writeProposalRows(client, [{
    id: 'PROP-REVIEW',
    case_id: 'CASE-1',
    version: 1,
    opportunity_id: 'OPP-1',
    company: 'Immutable company',
    deal: 'Immutable deal',
    value: 456,
    submitted_by: 'Original submitter',
    owner: 'Original owner',
    generated_on: '2026-09-01',
    submitted_at: '2026-09-01T12:34:56.000Z',
    created_at: '2026-09-01T12:00:00.000Z',
    updated_at: '2026-09-07T03:04:05.678Z',
    sections: { executive: 'Immutable submitted content' },
    status: 'Approved',
    reviewer_id: 'reviewer-id',
    reviewer: 'Reviewer',
    reviewed_at: '2026-09-07T00:00:00.000Z',
    rejection_reason: '',
    review_note: 'Approved after review',
    outcome: 'Pending',
  }], fail);

  assert.deepEqual(written, {
    row: {
      status: 'Approved',
      reviewer_id: 'reviewer-id',
      reviewer: 'Reviewer',
      reviewed_at: '2026-09-07T00:00:00.000Z',
      rejection_reason: '',
      review_note: 'Approved after review',
      outcome: 'Pending',
    },
    filters: [
      ['id', 'PROP-REVIEW'],
      ['status', 'Pending Review'],
      ['updated_at', '2026-09-07T03:04:05.678Z'],
    ],
    columns: 'id',
  });
});

test('a same-status Draft edit with a stale revision is rejected before it can overwrite', async () => {
  let updates = 0;
  const client = {
    from() {
      return {
        select() {
          return {
            async in() {
              return {
                data: [{
                  id: 'PROP-DRAFT',
                  status: 'Draft',
                  updated_at: '2026-09-07T04:00:00.000Z',
                }],
                error: null,
              };
            },
          };
        },
        update() {
          updates += 1;
          assert.fail('a stale draft must not reach UPDATE');
        },
      };
    },
  };
  const fail = (context, error) => {
    if (!error) return;
    throw Object.assign(new Error(`${context}: ${error.message}`), error);
  };

  await assert.rejects(
    writeProposalRows(client, [{
      id: 'PROP-DRAFT',
      status: 'Draft',
      updated_at: '2026-09-07T03:59:59.000Z',
      company: 'Stale writer',
      deal: 'Draft',
    }], fail),
    (error) => error.code === '42501' && /changed elsewhere/.test(error.message)
  );
  assert.equal(updates, 0);
});

test('a zero-row proposal update is a stale-write failure, not a successful save', async () => {
  const filters = [];
  const client = {
    from() {
      return {
        select() {
          return {
            async in() {
              return {
                data: [{
                  id: 'PROP-DRAFT',
                  status: 'Draft',
                  updated_at: '2026-09-07T05:00:00.000Z',
                }],
                error: null,
              };
            },
          };
        },
        update() {
          const query = {
            eq(column, value) {
              filters.push([column, value]);
              return query;
            },
            async select(columns) {
              assert.equal(columns, 'id');
              return { data: [], error: null };
            },
          };
          return query;
        },
      };
    },
  };
  const fail = (context, error) => {
    if (!error) return;
    throw Object.assign(new Error(`${context}: ${error.message}`), error);
  };

  await assert.rejects(
    writeProposalRows(client, [{
      id: 'PROP-DRAFT',
      status: 'Draft',
      updated_at: '2026-09-07T05:00:00.000Z',
      company: 'Concurrent writer',
      deal: 'Draft',
    }], fail),
    (error) => error.code === '42501' && /changed elsewhere/.test(error.message)
  );
  assert.deepEqual(filters, [
    ['id', 'PROP-DRAFT'],
    ['status', 'Draft'],
    ['updated_at', '2026-09-07T05:00:00.000Z'],
  ]);
});

test('a zero-row Draft delete is a permission/stale-state failure', async () => {
  const calls = [];
  const client = {
    from(table) {
      assert.equal(table, 'proposals');
      return {
        delete() {
          const query = {
            eq(column, value) {
              calls.push(['eq', column, value]);
              return query;
            },
            async select(columns) {
              calls.push(['select', columns]);
              return { data: [], error: null };
            },
          };
          return query;
        },
      };
    },
  };
  const fail = (context, error) => {
    if (!error) return;
    throw Object.assign(new Error(`${context}: ${error.message}`), error);
  };

  await assert.rejects(
    deleteDraftProposalRows(client, [{
      id: 'PROP-DRAFT',
      updated_at: '2026-09-07T05:00:00.000Z',
    }], fail),
    (error) => error.code === '42501' && /Only current draft/.test(error.message)
  );
  assert.deepEqual(calls, [
    ['eq', 'id', 'PROP-DRAFT'],
    ['eq', 'status', 'Draft'],
    ['eq', 'updated_at', '2026-09-07T05:00:00.000Z'],
    ['select', 'id'],
  ]);
});

test('a resubmit pair uses the atomic proposal RPC instead of split writes', async () => {
  const calls = [];
  const client = {
    from(table) {
      assert.equal(table, 'proposals');
      return {
        select(columns) {
          assert.equal(columns, 'id,status,updated_at');
          return {
            async in(column, ids) {
              calls.push(['lookup', column, ids]);
              return {
                data: [{
                  id: 'PROP-V1',
                  status: 'Reject & Revise',
                  updated_at: '2026-09-07T02:03:04.567Z',
                }],
                error: null,
              };
            },
          };
        },
        async insert() {
          assert.fail('replacement must not use a standalone insert');
        },
        update() {
          assert.fail('predecessor must not use a standalone update');
        },
      };
    },
    async rpc(name, args) {
      calls.push(['rpc', name, args]);
      return { data: null, error: null };
    },
  };
  const fail = (context, error) => assert.equal(error, null, context);
  const predecessor = {
    id: 'PROP-V1',
    case_id: 'CASE-1',
    version: 1,
    status: 'Superseded',
    updated_at: '2026-09-07T02:03:04.567Z',
    sections: { commercials: 'Original' },
  };
  const replacement = {
    id: 'PROP-V2',
    case_id: 'CASE-1',
    version: 2,
    status: 'Pending Review',
    updated_at: '2026-09-07T02:03:04.567Z',
    sections: { commercials: 'Revised' },
  };

  await writeProposalRows(client, [predecessor, replacement], fail);

  assert.deepEqual(calls, [
    ['lookup', 'id', ['PROP-V1', 'PROP-V2']],
    ['rpc', 'resubmit_proposal', {
      p_predecessor_id: 'PROP-V1',
      p_new_id: 'PROP-V2',
      p_sections: { commercials: 'Revised' },
      p_expected_updated_at: '2026-09-07T02:03:04.567Z',
    }],
  ]);
});

test('proposal batches fail before any non-atomic multi-row mutation starts', async () => {
  let mutations = 0;
  const client = {
    from() {
      return {
        select() {
          return {
            async in() {
              return {
                data: [
                  { id: 'PROP-A', status: 'Draft', updated_at: '2026-09-07T06:00:00.000Z' },
                  { id: 'PROP-B', status: 'Draft', updated_at: '2026-09-07T06:00:00.000Z' },
                ],
                error: null,
              };
            },
          };
        },
        insert() { mutations += 1; },
        update() { mutations += 1; },
      };
    },
  };
  const fail = (context, error) => {
    if (!error) return;
    throw Object.assign(new Error(`${context}: ${error.message}`), error);
  };

  await assert.rejects(
    writeProposalRows(client, [
      { id: 'PROP-A', status: 'Draft', updated_at: '2026-09-07T06:00:00.000Z' },
      { id: 'PROP-B', status: 'Draft', updated_at: '2026-09-07T06:00:00.000Z' },
    ], fail),
    (error) => error.code === '42501' && /exactly one logical change/.test(error.message)
  );
  assert.equal(mutations, 0);

  let deleteQueries = 0;
  await assert.rejects(
    deleteDraftProposalRows({ from() { deleteQueries += 1; } }, [
      { id: 'PROP-A', updated_at: '2026-09-07T06:00:00.000Z' },
      { id: 'PROP-B', updated_at: '2026-09-07T06:00:00.000Z' },
    ], fail),
    (error) => error.code === '42501' && /Only current draft/.test(error.message)
  );
  assert.equal(deleteQueries, 0);

  const serverData = readFileSync(
    new URL('../src/lib/server/supabase-data.ts', import.meta.url),
    'utf8'
  );
  assert.match(serverData, /if \(collection === 'proposals'\) assertProposalChangeShape\(changes\)/);
  assert.match(serverData, /\(upserts\.length && deletes\.length\)/);
  assert.match(serverData, /const reviewerId = actorProfile\?\.id \|\| null/);
});

test('resubmit rejects a stale client revision before calling the RPC', async () => {
  let rpcCalls = 0;
  const client = {
    from() {
      return {
        select() {
          return {
            async in() {
              return {
                data: [{
                  id: 'PROP-V1',
                  status: 'Reject & Revise',
                  updated_at: '2026-09-07T07:00:01.000Z',
                }],
                error: null,
              };
            },
          };
        },
      };
    },
    async rpc() { rpcCalls += 1; return { data: null, error: null }; },
  };
  const fail = (context, error) => {
    if (!error) return;
    throw Object.assign(new Error(`${context}: ${error.message}`), error);
  };

  await assert.rejects(
    writeProposalRows(client, [
      {
        id: 'PROP-V1', case_id: 'CASE-1', version: 1,
        status: 'Superseded', updated_at: '2026-09-07T07:00:00.000Z',
      },
      {
        id: 'PROP-V2', case_id: 'CASE-1', version: 2,
        status: 'Pending Review', sections: { executive: 'Stale rewrite' },
      },
    ], fail),
    (error) => error.code === '42501' && /changed elsewhere/.test(error.message)
  );
  assert.equal(rpcCalls, 0);
});

test('proposal resubmission is atomic, stale-safe, and keeps one live version per case', () => {
  const migration = readFileSync(
    new URL(
      '../supabase/migrations/20260907085440_atomic_proposal_resubmission.sql',
      import.meta.url
    ),
    'utf8'
  );
  const identityMigration = readFileSync(
    new URL(
      '../supabase/migrations/20260907093531_enforce_proposal_identity_immutability.sql',
      import.meta.url
    ),
    'utf8'
  );
  const hardeningMigration = readFileSync(
    new URL(
      '../supabase/migrations/20260910022200_harden_proposal_workflow_invariants.sql',
      import.meta.url
    ),
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
  const dataSync = readFileSync(new URL('../src/lib/data-sync.ts', import.meta.url), 'utf8');

  assert.match(migration, /create unique index proposals_one_live_version_per_case_idx[\s\S]*where status <> 'Superseded'/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /for update/);
  assert.match(migration, /predecessor\.status <> 'Reject & Revise'/);
  assert.match(migration, /new\.version > 1/);
  assert.match(migration, /proposals_enforce_atomic_version_chain/);
  assert.match(migration, /proposal_resubmit_predecessor_id/);
  assert.match(migration, /update public\.proposals[\s\S]*set status = 'Superseded'[\s\S]*insert into public\.proposals/);
  assert.match(migration, /revoke all on function public\.resubmit_proposal[\s\S]*from public, anon/);
  assert.match(migration, /grant execute on function public\.resubmit_proposal[\s\S]*to authenticated/);
  assert.match(identityMigration, /security invoker/);
  assert.match(identityMigration, /new\.id is distinct from old\.id/);
  assert.match(identityMigration, /new\.case_id is distinct from old\.case_id/);
  assert.match(identityMigration, /new\.version is distinct from old\.version/);
  assert.match(identityMigration, /before update of id, case_id, version/);
  assert.doesNotMatch(
    hardeningMigration,
    /private\.current_access_level\(\) >= 3[\s\S]*return new/
  );
  assert.match(hardeningMigration, /p_expected_updated_at timestamptz/);
  assert.match(
    hardeningMigration,
    /predecessor\.updated_at is distinct from p_expected_updated_at/
  );
  assert.match(hardeningMigration, /new\.reviewer_id := actor_id/);
  assert.match(hardeningMigration, /new\.reviewer := actor_name/);
  assert.match(hardeningMigration, /Reviewer audit fields can only be set/);
  assert.match(proposalsPage, /target\.status !== 'Draft'/);
  assert.match(proposalsPage, /const persisted = await saveProposals\(next\)/);
  assert.match(proposalsPage, /if \(!persisted\)[\s\S]*return;[\s\S]*toast\(`📤 Resubmitted/);
  assert.match(proposalsPage, /const editorBusy = submitting \|\| leavingEditor/);
  assert.match(proposalsPage, /const canEdit = statusAllowsEdit && !editorBusy/);
  assert.match(proposalsPage, /className="back-btn" disabled=\{editorBusy\}/);
  assert.match(proposalsPage, /className=\{`proposal-step[\s\S]*disabled=\{editorBusy\}/);
  assert.match(proposalsPage, /rebaseProposalEditorSections\([\s\S]*canonicalEditingUpdatedAt/);
  assert.match(
    proposalsPage,
    /const operation = runProposalDataTransaction\(async \(\) => \{[\s\S]*const canonicalStore = ensureProposalStore\(\)/
  );
  assert.match(
    proposalsPage,
    /runProposalDataTransaction\(async \(\) => \{[\s\S]*const effectiveEdits = new Map\(editedSectionRevisions\.current\);[\s\S]*if \(!effectiveEdits\.size\) return true;[\s\S]*mergeEditedProposalSections\([\s\S]*effectiveEdits\.keys\(\)/
  );
  assert.match(
    proposalsPage,
    /registerCanonicalSectionConflicts\(target\);\s*if \(!confirmSectionConflictOverwrite\(\)\) return false;/
  );
  assert.match(
    proposalsPage,
    /registerCanonicalSectionConflicts\(currentEditing\);\s*if \(!confirmSectionConflictOverwrite\(\)\) return;/
  );
  assert.match(
    proposalsPage,
    /function openEditor\(id: string\)[\s\S]*?editorProposalIdRef\.current = id;[\s\S]*?setEditingId\(id\);/
  );
  assert.match(
    proposalsPage,
    /Discard your revision changes\? They have not been submitted\./
  );
  assert.match(
    proposalsPage,
    /const canonicalSections = \{ \.\.\.canonical\.sections \};[\s\S]*setSections\(canonicalSections\)/
  );
  assert.doesNotMatch(proposalsPage, /^\s*saveProposals\(/m);
  assert.doesNotMatch(approvalsPage, /^\s*saveProposals\(/m);
  assert.match(approvalsPage, /const persisted = await saveProposals\(next\)/);
  assert.match(dataSync, /restoreCanonicalCollection\(collection\);[\s\S]*emitSync\(/);
});

test('proposal sync never infers destructive deletes from a stale full-store snapshot', () => {
  const previous = [
    { id: 'PROP-EDITED', company: 'Original' },
    { id: 'PROP-CONCURRENT', company: 'Created in another tab' },
  ];
  const staleNext = [{ id: 'PROP-EDITED', company: 'Updated' }];
  const safeNext = mergeProposalSnapshot(previous, staleNext);

  assert.deepEqual(safeNext, [staleNext[0], previous[1]]);
  const updateOnly = changesBetween('proposals', previous, safeNext);
  assert.deepEqual(updateOnly.upserts, staleNext);
  assert.deepEqual(updateOnly.deletes, []);

  const deleteSnapshot = mergeProposalSnapshot(previous, staleNext, ['PROP-CONCURRENT']);
  const confirmedDelete = changesBetween('proposals', previous, deleteSnapshot, {
    proposalDeleteIds: ['PROP-CONCURRENT'],
  });
  assert.deepEqual(confirmedDelete.deletes, [previous[1]]);
});

test('prospect sync deletes only the explicitly confirmed record', () => {
  const previous = [
    { id: 41, name: 'Keep me' },
    { id: 42, name: 'Delete me' },
  ];
  const next = [previous[0]];

  assert.deepEqual(changesBetween('prospects', previous, next).deletes, []);
  assert.deepEqual(
    changesBetween('prospects', previous, next, { prospectDeleteIds: [42] }).deletes,
    [previous[1]]
  );
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
  const proposalWriter = readFileSync(
    new URL('../src/lib/server/proposal-writer.ts', import.meta.url),
    'utf8'
  );
  const dataSync = readFileSync(new URL('../src/lib/data-sync.ts', import.meta.url), 'utf8');
  const proposalsPage = readFileSync(new URL('../src/app/proposals/page.tsx', import.meta.url), 'utf8');

  assert.match(migration, /create policy "proposals_delete_own_draft"/);
  assert.match(
    migration,
    /using \(owner_id = \(select auth\.uid\(\)\) and status = 'Draft'\)/
  );
  assert.match(migration, /grant delete on public\.proposals to authenticated/);
  assert.match(serverData, /deleteDraftProposalRows\(client, rows, fail\)/);
  assert.match(
    proposalWriter,
    /\.delete\(\)[\s\S]*\.eq\('id', row\.id\)[\s\S]*\.eq\('status', 'Draft'\)[\s\S]*\.eq\('updated_at', row\.updated_at\)[\s\S]*\.select\('id'\)/
  );
  assert.doesNotMatch(serverData, /Proposal versions are permanent and cannot be deleted/);
  assert.match(dataSync, /changesBetween\(collection, previous, next, options\)/);
  assert.match(proposalsPage, /saveProposals\(next, \{ deletedIds: \[id\] \}\)/);
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

test('Add Deal keeps drafts consistently and scopes prospect drafts to the account', () => {
  const modal = readFileSync(
    new URL('../src/components/deals/AddDealModal.tsx', import.meta.url),
    'utf8'
  );
  const prospectPage = readFileSync(
    new URL('../src/app/prospects/page.tsx', import.meta.url),
    'utf8'
  );
  const pipelinePage = readFileSync(
    new URL('../src/app/pipeline/page.tsx', import.meta.url),
    'utf8'
  );

  assert.match(modal, /Closing this window keeps your draft\./);
  assert.match(modal, />\s*Clear form\s*</);
  assert.match(modal, />\s*Close\s*</);
  assert.doesNotMatch(modal, />\s*Cancel\s*</);
  assert.match(prospectPage, /const \[dealDrafts, setDealDrafts\] = useState<Record<number, DealDraft>>/);
  assert.match(prospectPage, /dealDrafts\[open\.id\] \|\| emptyDealDraft\(currentUser\(\), open\.name\)/);
  assert.match(prospectPage, /\[open\.id\]: emptyDealDraft\(currentUser\(\), open\.name\)/);
  assert.match(prospectPage, /prospectId: prospect\.id/);
  assert.doesNotMatch(prospectPage, /key=\{open\.id\}/);
  assert.match(prospectPage, /<AddDealModal/);
  assert.match(pipelinePage, /<AddDealModal/);
  assert.match(pipelinePage, /onClose=\{\(\) => setAddOpen\(false\)\}/);
  assert.match(pipelinePage, /onClear=\{\(\) => setForm\(emptyDealDraft/);
});

test('prospect removal deletes only empty records and archives linked records', () => {
  const prospect = { id: 7, name: 'Example Co', opportunities: 0, ownerId: 'owner-a' };
  const empty = prospectDependencies(prospect, [], [], []);
  const linked = prospectDependencies(
    prospect,
    [{ prospectId: 7, account: 'Different display label' }],
    [{ company: ' example co ' }],
    [{ account: 'EXAMPLE CO' }]
  );

  assert.deepEqual(empty, { opportunities: 0, deals: 0, proposals: 0 });
  assert.equal(hasProspectDependencies(empty), false);
  assert.deepEqual(linked, { opportunities: 0, deals: 2, proposals: 1 });
  assert.equal(hasProspectDependencies(linked), true);
  assert.equal(canManageProspect(prospect, 1, 'owner-a'), true);
  assert.equal(canManageProspect(prospect, 1, 'owner-b'), false);
  assert.equal(canManageProspect(prospect, 2, 'owner-b'), true);

  const page = readFileSync(new URL('../src/app/prospects/page.tsx', import.meta.url), 'utf8');
  const detail = readFileSync(
    new URL('../src/components/prospects/ProspectDetail.tsx', import.meta.url),
    'utf8'
  );
  const server = readFileSync(
    new URL('../src/lib/server/supabase-data.ts', import.meta.url),
    'utf8'
  );
  const migration = readFileSync(
    new URL('../supabase/migrations/20260910034952_add_prospect_archiving.sql', import.meta.url),
    'utf8'
  );

  assert.match(page, /hasProspectDependencies\(dependencies\) \? 'archive' : 'delete'/);
  assert.match(page, /saveProspects\([\s\S]*deletedIds: \[target\.id\]/);
  assert.match(page, /<Modal[\s\S]*Delete Prospect[\s\S]*Archive Prospect/);
  assert.doesNotMatch(page, /\bconfirm\s*\(/);
  assert.match(detail, /removalMode === 'delete' \? 'Delete Prospect' : 'Archive Prospect'/);
  assert.match(server, /assertProspectsCanBeDeleted\(client, numericIds\)/);
  assert.match(server, /\.delete\(\)\.in\('id', numericIds\)\.select\('id'\)/);
  assert.match(migration, /add column status text not null default 'Active'/);
  assert.match(migration, /current_access_level\(\)\) >= 2/);
  assert.match(migration, /create trigger prevent_linked_prospect_delete/);
  assert.match(migration, /Prospect .* has linked work and must be archived instead/);
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
