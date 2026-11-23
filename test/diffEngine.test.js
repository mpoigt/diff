'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { computeDiff, toUnifiedText } = require('../src/utils/diffEngine');

test('trailing spaces on the third line leave it aligned and unchanged', () => {
  const before = 'old first\nold second\nshared\n\nlast';
  const after = 'new first\nnew second\nshared     \n\nlast';
  const { changes, stats } = computeDiff(before, after);

  assert.deepEqual(changes.find(({ oldLine }) => oldLine === 3), {
    type: 'equal', oldLine: 3, newLine: 3, content: 'shared',
  });
  assert.equal(stats.added, 2);
  assert.equal(stats.removed, 2);
  assert.equal(stats.unchanged, 3);
  assert.equal(stats.similarity, 60);
});

test('tabs at end of line are ignored while indentation and internal whitespace matter', () => {
  assert.equal(computeDiff('data\t\r\nend', 'data\nend').stats.identical, true);
  assert.equal(computeDiff('  data', 'data').stats.identical, false);
  assert.equal(computeDiff('a  b', 'a b').stats.identical, false);
});

test('the exact comparison can still export changes consisting only of whitespace', () => {
  const { changes } = computeDiff('data', 'data\t', { ignoreTrailingWhitespace: false });
  const patch = toUnifiedText({ fileA: { name: 'before' }, fileB: { name: 'after' }, changes });
  assert.equal(patch, '--- before\n+++ after\n-data\n+data\t');
});
