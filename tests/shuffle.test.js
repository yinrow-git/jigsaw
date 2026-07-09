const test = require('node:test');
const assert = require('node:assert/strict');
const { generateShuffleOrder } = require('../puzzle.js');

test('a single-piece order returns immediately instead of hanging (GRID=1 regression)', () => {
  const start = Date.now();
  const order = generateShuffleOrder(1);
  const elapsedMs = Date.now() - start;

  assert.deepEqual(order, [0]);
  assert.ok(elapsedMs < 100, `expected generateShuffleOrder(1) to return quickly, took ${elapsedMs}ms`);
});

test('an empty order returns immediately instead of hanging', () => {
  const order = generateShuffleOrder(0);
  assert.deepEqual(order, []);
});

test('a multi-piece order contains every index exactly once', () => {
  const order = generateShuffleOrder(9);
  assert.deepEqual([...order].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test('a multi-piece order is never the identity order', () => {
  // Run many times since shuffling is random; each run must retry until
  // it differs from [0, 1, ..., n-1].
  for (let trial = 0; trial < 200; trial++) {
    const order = generateShuffleOrder(4);
    assert.ok(!order.every((v, i) => v === i), `got identity order on trial ${trial}`);
  }
});
