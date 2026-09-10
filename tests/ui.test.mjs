import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { renderUI } from '../src/ui.ts';

test('the footer has the requested quiet-corner sentence without the old copy or gallery', () => {
  const html = renderUI();
  assert.match(html, /Relax, and sit in your quiet corner\./);
  for (const retired of ['A little ink. A little time.', 'Made for being here.', 'Everything stays on your device.',
    'Explore 5 design studies', 'designs.html']) assert.equal(html.includes(retired), false);
  for (const mood of ['Rainy Study', 'Sunlit Atelier', 'Storybook Nook']) assert.ok(html.includes(mood));
  for (const control of ['begin-writing', 'new-sheet', 'toggle-roll', 'move-view', 'style']) assert.ok(html.includes(`id="${control}"`));
});

test('retired design pages and preview assets are removed, while shared editor fonts remain', () => {
  for (const path of ['designs.html', 'src/designs.ts', 'src/design-theme.css', 'src/design-gallery.ts', 'src/design-gallery.css',
    ...['nocturne', 'airmail', 'atelier', 'daydream', 'listening'].map((name) => `public/design-previews/${name}.jpg`)]) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), false, path);
  }
  assert.equal(existsSync(new URL('../src/fonts.css', import.meta.url)), true);
  const hosting = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(hosting.redirects.find((redirect) => redirect.source === '/designs.html'),
    { source: '/designs.html', destination: '/', permanent: true });
});
