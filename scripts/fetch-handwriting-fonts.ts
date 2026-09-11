import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HANDWRITING_STYLES } from '../src/handwriting.ts';

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
  const fontDirectory = new URL(`../public/fonts/${fontPath.replace(/[^/]+$/, '')}`, import.meta.url);
  mkdirSync(fileURLToPath(fontDirectory), { recursive: true });
  for (const path of [fontPath, licensePath]) {
    const url = rawUrl(style.source, path.split('/').at(-1)!);
    const bytes = await download(url);
    const output = new URL(`../public/fonts/${path}`, import.meta.url);
    writeFileSync(output, bytes);
    console.log(`Wrote ${fileURLToPath(output)} from ${url}`);
  }
}
