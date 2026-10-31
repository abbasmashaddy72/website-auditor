import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPageEvidence, historicalWarningCandidate } from '../src/lib/page-classification';

const result = (category: string, message = 'audit note', status = 200) => ({
  status,
  issues: [{ category, message }],
  warnings: [],
});
test('successful HTTP with only nonfatal audit issues becomes warning', () => {
  assert.equal(classifyPageEvidence(result('performance')), 'warning');
  assert.equal(classifyPageEvidence(result('accessibility')), 'warning');
  assert.equal(classifyPageEvidence(result('assets', 'Broken image detected')), 'warning');
  assert.equal(classifyPageEvidence(result('ui', 'Horizontal viewport overflow')), 'warning');
  assert.equal(classifyPageEvidence(result('seo', 'Meta title missing')), 'warning');
});
test('functional/browser failures remain failures regardless of HTTP 200', () => {
  assert.equal(classifyPageEvidence(result('javascript', 'Uncaught TypeError')), 'failed');
  assert.equal(
    classifyPageEvidence(result('framework', 'This feature is temporarily unavailable')),
    'failed',
  );
  assert.equal(classifyPageEvidence(result('network', 'Livewire POST failed')), 'failed');
  assert.equal(classifyPageEvidence(result('http', 'Main document HTTP 500')), 'failed');
  assert.equal(classifyPageEvidence(result('performance', 'Slow request', 503)), 'failed');
  assert.equal(
    classifyPageEvidence({ status: 200, issues: [], warnings: ['Uncaught exception during Livewire'] }),
    'failed',
  );
});
test('legacy migration conservatively skips ambiguous 200 cases', () => {
  assert.equal(historicalWarningCandidate({ ...result('performance'), classification: 'failed' }), true);
  assert.equal(historicalWarningCandidate({ ...result('javascript'), classification: 'failed' }), false);
  assert.equal(
    historicalWarningCandidate({ status: 200, issues: [], warnings: [], classification: 'failed' }),
    false,
  );
  assert.equal(
    historicalWarningCandidate({
      status: 200,
      issues: [],
      warnings: ['Long load'],
      classification: 'failed',
    }),
    true,
  );
  assert.equal(historicalWarningCandidate({ ...result('performance'), classification: 'warning' }), false);
});
