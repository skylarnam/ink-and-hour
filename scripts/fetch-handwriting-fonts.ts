import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { HANDWRITING_STYLES } from '../src/handwriting.ts';

const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean' } } });
const catalog = JSON.parse(readFileSync(new URL('../font-review/catalog.json', import.meta.url), 'utf8'));

function rawUrl(source: string, path: string): string {
  const match = source.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/);
  if (!match) throw new Error(`Unsupported source URL: ${source}`);
  const [, owner, repo, ref, folder] = match;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${folder}/${path}`;
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Download failed for ${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

for (const style of HANDWRITING_STYLES) {
  if (!style.source.startsWith('https://github.com/google/fonts/tree/main/')) continue;
  const fontPath = style.publicFontPath.replace(/^\/fonts\//, '');
  const licensePath = style.publicLicensePath.replace(/^\/fonts\//, '');
  const candidate = catalog.candidates.find((candidate: { id: string }) => candidate.id === style.id);
  if (!candidate) throw new Error(`Missing original source record for ${style.id}.`);
  const fontDirectory = new URL(`../public/fonts/${fontPath.replace(/[^/]+$/, '')}`, import.meta.url);
  if (!values['dry-run']) mkdirSync(fileURLToPath(fontDirectory), { recursive: true });
  for (const path of [fontPath, licensePath]) {
    const originalUrl = path === fontPath ? candidate.fontUrl : candidate.licenseUrl;
    const url = originalUrl ?? rawUrl(style.source, path.split('/').at(-1)!);
    if (values['dry-run']) { console.log(url); continue; }
    const bytes = await download(url);
    const output = new URL(`../public/fonts/${path}`, import.meta.url);
    writeFileSync(output, bytes);
    console.log(`Wrote ${fileURLToPath(output)} from ${url}`);
  }
}
