import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import opentype from 'opentype.js';
import { HANDWRITING_STYLES } from '../src/handwriting.ts';
import { ReviewStore, readCatalog, projectFile, SAMPLE } from '../font-review/store.mjs';
import { startReviewServer } from '../font-review/server.mjs';

test('the real collection preserves 100 distinct licensed faces and marks all 34 applied styles', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const catalog = await readCatalog(root);
  assert.equal(new Set(catalog.candidates.map(({ family }) => family.toLowerCase())).size, 100);
  assert.deepEqual(catalog.candidates.filter(({ current }) => current).map(({ id }) => id),
    HANDWRITING_STYLES.map(({ id }) => id));
  for (const candidate of catalog.candidates) {
    const bytes = await readFile(projectFile(root, candidate.fontFile));
    const license = await readFile(projectFile(root, candidate.licenseFile));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), candidate.fontSha256);
    assert.equal(createHash('sha256').update(license).digest('hex'), candidate.licenseSha256);
    const face = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    for (let code = 32; code <= 126; code++) assert.notEqual(face.charToGlyphIndex(String.fromCharCode(code)), 0, `${candidate.id}: ${code}`);
    if (candidate.license === 'OFL-1.1') assert.match(license.toString('utf8'), /Open Font License|SIL OPEN FONT LICENSE/i);
    if (candidate.license === 'Apache-2.0') assert.match(license.toString('utf8'), /Apache License/);
  }
  const html = await readFile(join(root, 'font-review/index.html'), 'utf8');
  assert.equal((html.match(/<section class="candidate"/g) ?? []).length, 100);
  const checkboxes = html.match(/<input type="checkbox"[^>]*>/g) ?? [];
  assert.equal(checkboxes.length, 100);
  assert.ok(checkboxes.every((markup) => !/\schecked(?:\s|=|>)/.test(markup)));
  assert.equal((html.match(/@font-face\s*\{/g) ?? []).length, 100);
  assert.equal((html.match(/class="sample"/g) ?? []).length, 100);
  assert.match(html, /including all 34 currently applied styles/);
  assert.match(html, /font-review\/applied-selection\.json/);
  assert.equal(catalog.candidates.find(({ id }) => id === 'print').current, false);
});

async function fixture(t) {
  const root = join(fileURLToPath(new URL('../', import.meta.url)), `.font-review-test-${randomUUID()}`);
  await mkdir(root);
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'font-review'));
  const candidates = Array.from({ length: 100 }, (_, index) => ({
    id: `font-${index}`, label: `Font ${index}`, family: `Font ${index}`, current: index < 34,
    fontFile: `font-review/fonts/font-${index}.ttf`, licenseFile: `font-review/licenses/font-${index}/OFL.txt`,
    source: 'https://github.com/google/fonts', license: 'OFL-1.1',
    fontSha256: 'a'.repeat(64), licenseSha256: 'b'.repeat(64), missingAscii: [],
  }));
  await writeFile(join(root, 'font-review/catalog.json'), JSON.stringify({ version: 1, sample: SAMPLE, candidates }));
  await writeFile(join(root, 'font-review/index.html'),
    '<!doctype html><meta name="review-token" content=""><script id="initial-selection" type="application/json">{}</script>');
  return { root, store: new ReviewStore(root) };
}

test('all 100 fonts, including the current ones, start unchecked in a real persistent file', async (t) => {
  const { root, store } = await fixture(t);
  assert.equal((await readCatalog(root)).candidates.length, 100);
  const state = await store.read();
  assert.equal(state.revision, 0);
  assert.deepEqual(state.selected, []);
  assert.deepEqual(JSON.parse(await readFile(store.file, 'utf8')), state);
});

test('queued checkbox changes preserve every selection and survive a new store instance', async (t) => {
  const { root, store } = await fixture(t);
  const first = store.update('font-80', true);
  const second = store.update('font-2', true);
  const third = store.update('font-99', true);
  await first;
  await second;
  await third;
  const restored = new ReviewStore(root);
  assert.deepEqual((await restored.read()).selected, ['font-2', 'font-80', 'font-99']);
  await restored.update('font-80', false);
  const summary = await store.summary();
  assert.deepEqual(summary.selectedFonts.map(({ id }) => id), ['font-2', 'font-99']);
  assert.equal(summary.revision, 4);
  assert.equal(summary.file, join(root, 'font-review/selection.json'));
});

test('later checkbox edits never overwrite the separately applied website snapshot', async (t) => {
  const { root, store } = await fixture(t);
  const path = join(root, 'font-review/applied-selection.json');
  const approved = '{"version":1,"sourceRevision":34,"selected":["font-4"]}\n';
  await writeFile(path, approved);
  await store.update('font-80', true);
  await store.update('font-4', false);
  assert.deepEqual((await store.read()).selected, ['font-80']);
  assert.equal(await readFile(path, 'utf8'), approved);
});

test('unknown choices reject explicitly without poisoning the next valid save', async (t) => {
  const { store } = await fixture(t);
  await assert.rejects(store.update('missing-font', true), /known font/);
  await assert.rejects(store.update('font-2', 'yes'), /checked or unchecked state/);
  await store.update('font-2', true);
  assert.deepEqual((await store.read()).selected, ['font-2']);
});

test('malformed saved selections are not silently reset or overwritten', async (t) => {
  const { store } = await fixture(t);
  await store.read();
  const broken = '{"version":1,"revision":1,"selected":["unknown"],"updatedAt":null}';
  await writeFile(store.file, broken);
  await assert.rejects(store.read(), /not been overwritten/);
  await assert.rejects(store.update('font-2', true), /not been overwritten/);
  assert.equal(await readFile(store.file, 'utf8'), broken);
});

test('candidate counts, duplicate identities and escaped file paths are rejected', async (t) => {
  const { root } = await fixture(t);
  const path = join(root, 'font-review/catalog.json');
  const catalog = await readCatalog(root);
  await writeFile(path, JSON.stringify({ ...catalog, candidates: catalog.candidates.slice(1) }));
  await assert.rejects(readCatalog(root), /exactly 100/);
  catalog.candidates[99].id = catalog.candidates[0].id;
  await writeFile(path, JSON.stringify(catalog));
  await assert.rejects(readCatalog(root), /duplicate identity/);
  for (const path of ['../outside.ttf', '/outside.ttf', 'font-review\\outside.ttf']) {
    assert.throws(() => projectFile(root, path), /project-relative|inside the project/);
  }
});

test('the loopback checklist saves authorized changes and refuses cross-origin writes', async (t) => {
  const { store } = await fixture(t);
  const errors = [];
  const server = await startReviewServer(store, (error) => errors.push(error.message));
  t.after(() => server.close());
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  const html = await (await fetch(server.url)).text();
  const token = html.match(/name="review-token" content="([^"]+)"/)[1];
  assert.equal(token.length, 64);
  const origin = new URL(server.url).origin;
  const request = (headers) => fetch(`${server.url}api/selection`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ id: 'font-5', checked: true }),
  });
  assert.equal((await request({ Origin: 'https://outside.example', 'X-Review-Token': token })).status, 403);
  assert.equal((await request({ Origin: origin })).status, 403);
  assert.deepEqual((await store.read()).selected, []);
  const saved = await request({ Origin: origin, 'X-Review-Token': token });
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).selected, ['font-5']);
  const restored = await (await fetch(`${server.url}api/selection`)).json();
  assert.deepEqual(restored.selected, ['font-5']);
  assert.deepEqual(errors, []);
});
