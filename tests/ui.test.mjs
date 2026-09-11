import test from 'node:test';
import assert from 'node:assert/strict';
import { LOFI_TRACKS } from '../src/music-library.ts';
import { HANDWRITING_STYLES } from '../src/handwriting.ts';
import { existsSync, readFileSync } from 'node:fs';
import { renderUI } from '../src/ui.ts';

test('the footer no longer duplicates the completed scene caption or retired gallery', () => {
  const html = renderUI();
  const footer = html.match(/<footer[\s\S]*?<\/footer>/)[0];
  assert.equal(footer.includes('Relax, and sit in your quiet corner.'), false);
  assert.ok(footer.includes('about-button'));
  for (const retired of ['A little ink. A little time.', 'Made for being here.', 'Everything stays on your device.',
    'Explore 5 design studies', 'designs.html']) assert.equal(html.includes(retired), false);
  for (const mood of ['Rainy Study', 'Sunlit Atelier', 'Storybook Nook']) assert.ok(html.includes(mood));
  for (const control of ['begin-writing', 'new-sheet', 'toggle-roll', 'move-view', 'style']) assert.ok(html.includes(`id="${control}"`));
});

test('the ink choices retain four presets and add an accessible rainbow color picker', () => {
  const html = renderUI();
  assert.equal((html.match(/data-setting="ink"/g) ?? []).length, 5);
  assert.match(html, /class="ink-swatch rainbow-swatch"/);
  assert.match(html, /type="color" id="custom-ink-color"/);
  assert.match(html, /aria-label="Custom ink color"/);
  assert.equal(html.includes('A color to linger in'), false);
  assert.equal(html.includes('New strokes only'), false);
});

test('the mini-player is before the sound switch and includes transport labels and recording credits', () => {
  const html = renderUI();
  assert.ok(html.indexOf('id="music-play"') < html.indexOf('id="enable-sound"'));
  for (const label of ['Previous lo-fi track', 'Play music', 'Next lo-fi track', 'Music details and credits']) {
    assert.ok(html.includes(`aria-label="${label}"`));
  }
  for (const track of LOFI_TRACKS) {
    assert.ok(html.includes(track.artist));
    assert.ok(html.includes(`href="${track.source}"`));
    assert.ok(html.includes(`href="${track.license}"`));
  }
});

test('all 22 handwriting choices expose their source licenses and the inferred-order limitation', () => {
  const html = renderUI();
  const selector = html.match(/<select id="style"[\s\S]*?<\/select>/)[0];
  assert.equal((selector.match(/<option /g) ?? []).length, 22);
  for (const style of HANDWRITING_STYLES) {
    assert.ok(selector.includes(`value="${style.id}"`));
    assert.ok(html.includes(`href="${style.publicLicensePath}"`));
  }
  assert.ok(html.includes('id="handwriting-note"'));
  assert.ok(html.includes('inferred centerlines, not its outline'));
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
