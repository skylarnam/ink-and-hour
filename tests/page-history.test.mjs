import test from 'node:test';
import assert from 'node:assert/strict';
import { PageHistory } from '../src/page-history.ts';

const snapshot = (page) => ({ paper: 'smooth', ink: `page-${page}` });

test('history retains at most ten ordered page snapshots and replaces a page without growing', () => {
  const history = new PageHistory();
  for (let index = 0; index < 100; index++) {
    history.set(index, snapshot(index));
    assert.ok(history.size <= 10);
  }
  assert.equal(history.size, 10);
  assert.equal(history.oldest, 90);
  assert.equal(history.has(89), false);
  assert.deepEqual(history.get(99), snapshot(99));
  history.set(99, { paper: 'cotton', ink: 'updated' });
  assert.equal(history.size, 10);
  assert.equal(history.get(99).ink, 'updated');
  history.clear();
  assert.equal(history.size, 0);
  assert.equal(history.oldest, undefined);
});

test('out-of-order navigation cannot evict more recent pages or mutate stored snapshots', () => {
  const history = new PageHistory(2);
  const saved = snapshot(2);
  history.set(2, saved);
  history.set(1, snapshot(1));
  assert.equal(history.oldest, 1);
  saved.ink = 'changed externally';
  assert.equal(history.get(2).ink, 'page-2');
  assert.throws(() => { history.get(2).ink = 'changed'; }, TypeError);
  history.set(0, snapshot(0));
  assert.equal(history.size, 2);
  assert.equal(history.has(0), false);
  assert.equal(history.has(1), true);
  assert.equal(history.has(2), true);
});

test('invalid page counts and indexes are explicit failures', () => {
  for (const size of [0, -1, 11, 1.5, NaN, Infinity]) assert.throws(() => new PageHistory(size), RangeError);
  const history = new PageHistory();
  for (const index of [-1, 0.5, NaN, Infinity]) assert.throws(() => history.set(index, snapshot(0)), RangeError);
  assert.equal(history.size, 0);
});

test('continuous history makes room for the current page and keeps its readable text', () => {
  const history = new PageHistory();
  for (let index = 0; index < 10; index++) history.set(index, { ...snapshot(index), text: `Words on page ${index}` });
  history.trimBefore(1);
  assert.equal(history.size, 9);
  assert.equal(history.oldest, 1);
  assert.equal(history.get(0), undefined);
  history.set(10, { ...snapshot(10), text: 'Current reading' });
  assert.equal(history.size, 10);
  assert.equal(history.get(10).text, 'Current reading');
  for (const invalid of [-1, NaN, 0.5]) assert.throws(() => history.trimBefore(invalid), RangeError);
  assert.equal(history.size, 10);
});
