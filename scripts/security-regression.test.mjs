import assert from 'node:assert/strict';
import test from 'node:test';
import { safeNextPath } from '../src/lib/safe-next.ts';
import { safeFilenamePart } from '../src/lib/docExport.ts';
import { buildProposalHTML, buildReportHTML } from '../src/lib/docTemplates.ts';

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
