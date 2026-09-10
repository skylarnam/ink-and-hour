import test from 'node:test';
import assert from 'node:assert/strict';
import { DESIGN_DIRECTIONS, findDesign } from '../src/designs.ts';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/settings.ts';

test('there are five distinct, addressable visual directions with valid scene settings', () => {
  assert.equal(DESIGN_DIRECTIONS.length, 5);
  assert.equal(new Set(DESIGN_DIRECTIONS.map((design) => design.id)).size, 5);
  for (const design of DESIGN_DIRECTIONS) {
    assert.equal(findDesign(design.id), design);
    assert.deepEqual(sanitizeSettings({ ...DEFAULT_SETTINGS, ...design.settings }), { ...DEFAULT_SETTINGS, ...design.settings });
    assert.equal(design.colors.length, 3);
    assert.ok(design.description.length > 100);
    assert.ok(['tools', 'room', 'sound'].includes(design.initialTab));
  }
});

test('an ordinary URL or unknown direction leaves the original ritual selected', () => {
  assert.equal(findDesign(null), undefined);
  assert.equal(findDesign(''), undefined);
  assert.equal(findDesign('made-up'), undefined);
});
