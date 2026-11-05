import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderUI } from '../src/ui.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the home link uses the approved horizontal logo with reserved dimensions and an accessible name', () => {
  const brand = renderUI().match(/<a class="brand"[\s\S]*?<\/a>/)[0];
  assert.match(brand, /href="\.\/" aria-label="Ink and Hour home"/);
  assert.match(brand, /src="\/brand\/ink-and-hour-horizontal\.svg" width="162" height="48" alt="Ink &amp; Hour"/);
  assert.equal(brand.includes('brand-mark'), false);
  assert.equal(brand.includes('brand-name'), false);
});

test('both approved lockups use portable outlined lettering rather than runtime fonts or remote images', () => {
  const horizontal = read('public/brand/ink-and-hour-horizontal.svg');
  const stacked = read('public/brand/ink-and-hour-stacked.svg');
  assert.match(horizontal, /viewBox="0 0 162 48"/);
  assert.match(horizontal, /horizontal logo with 16px gap/);
  assert.match(stacked, /approved 20px stacked logo/);
  for (const svg of [horizontal, stacked]) {
    assert.match(svg, /data-part="wordmark"/);
    assert.match(svg, /<path\b/);
    assert.doesNotMatch(svg, /<(?:text|image|script|foreignObject|rect)\b/);
    assert.doesNotMatch(svg, /@font-face|font-family|href=/);
  }
  assert.match(read('public/brand/MANROPE-LICENSE.txt'), /SIL OPEN FONT LICENSE Version 1\.1/);
});

test('the favicon uses the approved pen-and-dial symbol and the page requests its new version', () => {
  const favicon = read('public/favicon.svg');
  for (const shape of ['M106 64A43 43 0 1 1 64 21', 'M58 68L79 30L108 16L93 45Z', 'M59 67L96 29']) {
    assert.ok(favicon.includes(shape));
    assert.ok(read('public/brand/ink-and-hour-horizontal.svg').includes(shape));
  }
  assert.match(favicon, /fill="#a38452"/);
  assert.match(read('index.html'), /href="\/favicon\.svg\?v=2"/);
});
