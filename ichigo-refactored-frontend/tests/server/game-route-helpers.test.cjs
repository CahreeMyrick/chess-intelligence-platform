'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeResult,
  normalizeUci,
  parseMoveHistory,
  parsePositiveInteger,
} = require('../../server/game-route-helpers.cjs');

test('normalizeUci accepts canonical moves and normalizes case/whitespace', () => {
  assert.equal(normalizeUci(' E7E8Q '), 'e7e8q');
  assert.equal(normalizeUci('e2e4'), 'e2e4');
});

test('normalizeUci rejects non-string and malformed inputs before slice is used', () => {
  assert.equal(normalizeUci({ toString: () => 'e2e4' }), null);
  assert.equal(normalizeUci(1234), null);
  assert.equal(normalizeUci('e2e9'), null);
});

test('parsePositiveInteger accepts only safe positive integer path ids', () => {
  assert.equal(parsePositiveInteger('17'), 17);
  assert.equal(parsePositiveInteger('1.5'), null);
  assert.equal(parsePositiveInteger('abc'), null);
  assert.equal(parsePositiveInteger('0'), null);
});

test('normalizeResult restricts persisted and PGN results', () => {
  for (const value of ['*', '1-0', '0-1', '1/2-1/2']) assert.equal(normalizeResult(value), value);
  assert.equal(normalizeResult('white wins'), null);
});

test('parseMoveHistory validates every persisted UCI move', () => {
  assert.deepEqual(parseMoveHistory('e2e4 e7e5 g1f3'), ['e2e4', 'e7e5', 'g1f3']);
  assert.deepEqual(parseMoveHistory(''), []);
  assert.equal(parseMoveHistory('e2e4 not-a-move'), null);
});
