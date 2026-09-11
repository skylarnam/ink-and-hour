import test from 'node:test';
import assert from 'node:assert/strict';
import { inkColor, inkLabel, isInkColor } from '../src/ink.ts';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/settings.ts';
import { INKS, PAPER_COLORS, PAPER_FINISH } from '../src/types.ts';

test('custom ink is validated, normalized and restored without replacing the four presets', () => {
  const settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ink: 'custom', customInk: '#C3407F' });
  assert.equal(settings.ink, 'custom');
  assert.equal(settings.customInk, '#c3407f');
  assert.equal(inkColor(settings), '#c3407f');
  assert.equal(inkLabel(settings), 'Custom #C3407F');
  assert.equal(Object.keys(INKS).length, 4);
  for (const [ink, preset] of Object.entries(INKS)) {
    assert.equal(inkColor({ ...settings, ink }), preset.color);
    assert.equal(inkLabel({ ...settings, ink }), preset.label);
  }
  for (const customInk of ['red', '#fff', '#000000;', 'url(secret)', null, 42]) {
    assert.equal(isInkColor(customInk), false);
    assert.equal(sanitizeSettings({ ...settings, customInk }).customInk, DEFAULT_SETTINGS.customInk);
  }
});

test('cotton is warmer, more matte and has a materially stronger relief than smooth paper', () => {
  assert.notEqual(PAPER_COLORS.cotton, PAPER_COLORS.smooth);
  assert.ok(PAPER_FINISH.cotton.roughness > PAPER_FINISH.smooth.roughness);
  assert.ok(PAPER_FINISH.cotton.bumpScale >= PAPER_FINISH.smooth.bumpScale * 5);
});
