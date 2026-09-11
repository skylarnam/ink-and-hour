import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const SELECTION_FILE = 'font-review/selection.json';
export const SAMPLE = 'The quick brown fox jumps over the lazy dog.';

export function projectFile(root, file) {
  if (typeof file !== 'string' || !file || file.includes('\\') || isAbsolute(file)) {
    throw new Error('Font review paths must be project-relative.');
  }
  const path = resolve(root, file);
  const inside = relative(resolve(root), path);
  if (!inside || inside === '..' || inside.startsWith('../')) throw new Error('Font review paths must stay inside the project.');
  return path;
}

export async function readCatalog(root) {
  const catalog = JSON.parse(await readFile(join(root, 'font-review/catalog.json'), 'utf8'));
  if (catalog.version !== 1 || catalog.sample !== SAMPLE || !Array.isArray(catalog.candidates)
    || catalog.candidates.length !== 100) throw new Error('The font review must contain exactly 100 pangram candidates.');
  const ids = new Set();
  for (const candidate of catalog.candidates) {
    if (!candidate || typeof candidate.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(candidate.id) || ids.has(candidate.id)
      || typeof candidate.label !== 'string' || !candidate.label
      || typeof candidate.family !== 'string' || !candidate.family
      || typeof candidate.current !== 'boolean'
      || !['Public domain', 'OFL-1.1', 'Apache-2.0'].includes(candidate.license)
      || !/^https:\/\//.test(candidate.source)
      || !/^[a-f0-9]{64}$/.test(candidate.fontSha256) || !/^[a-f0-9]{64}$/.test(candidate.licenseSha256)) {
      throw new Error('A font candidate has invalid or duplicate identity, licensing, or provenance.');
    }
    projectFile(root, candidate.fontFile);
    projectFile(root, candidate.licenseFile);
    ids.add(candidate.id);
  }
  return catalog;
}

export function validateSelection(value, catalog) {
  const allowed = new Set(catalog.candidates.map(({ id }) => id));
  if (!value || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !Array.isArray(value.selected) || new Set(value.selected).size !== value.selected.length
    || value.selected.some((id) => !allowed.has(id))
    || !(value.updatedAt === null || typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt)))) {
    throw new Error('The saved font selection is invalid. It has not been overwritten.');
  }
  return value;
}

export class ReviewStore {
  constructor(root) {
    this.root = root;
    this.file = projectFile(root, SELECTION_FILE);
    this.pending = Promise.resolve();
    this.listeners = new Set();
  }

  async read() {
    const catalog = await readCatalog(this.root);
    let source;
    try {
      source = await readFile(this.file, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const initial = { version: 1, revision: 0, selected: [], updatedAt: null };
      try {
        await writeFile(this.file, `${JSON.stringify(initial, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      } catch (writeError) {
        if (writeError.code !== 'EEXIST') throw writeError;
      }
      source = await readFile(this.file, 'utf8');
    }
    return validateSelection(JSON.parse(source), catalog);
  }

  update(id, checked) {
    const operation = this.pending.then(async () => {
      const catalog = await readCatalog(this.root);
      if (typeof checked !== 'boolean' || !catalog.candidates.some((candidate) => candidate.id === id)) {
        throw new Error('Choose a known font and a checked or unchecked state.');
      }
      const current = await this.read();
      const selected = new Set(current.selected);
      if (checked) selected.add(id);
      else selected.delete(id);
      const next = {
        version: 1, revision: current.revision + 1,
        selected: catalog.candidates.map((candidate) => candidate.id).filter((candidate) => selected.has(candidate)),
        updatedAt: new Date().toISOString(),
      };
      const temporary = join(this.root, 'font-review', `.selection-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
        await rename(temporary, this.file);
      } finally {
        try { await unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      for (const listener of this.listeners) listener(next);
      return next;
    });
    // Keep the queue usable after a failed write; the caller still receives the rejection.
    this.pending = operation.catch(() => {});
    return operation;
  }

  async summary() {
    const catalog = await readCatalog(this.root);
    const state = await this.read();
    return {
      file: this.file, ...state, total: catalog.candidates.length,
      selectedFonts: catalog.candidates.filter((candidate) => state.selected.includes(candidate.id))
        .map(({ id, label, current, source, license }) => ({ id, label, current, source, license })),
    };
  }
}
