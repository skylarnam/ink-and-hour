import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const url = 'https://raw.githubusercontent.com/techninja/hersheytextjs/master/hersheytext.min.json';
const expectedHash = '73709473c12b3ea48b29a8167ef4f84ea7340cfa3f44e65fc0194690edf41ceb';
const response = await fetch(url);
if (!response.ok) throw new Error(`Hershey download failed: HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(bytes).digest('hex') !== expectedHash) {
  throw new Error('Upstream data changed. Review its provenance before updating this subset.');
}
const source = JSON.parse(bytes.toString('utf8'));
const subset = {};
for (const [style, key] of [['correspondence', 'scripts'], ['print', 'futural']]) {
  const { name, chars } = source[key];
  subset[style] = { name, chars: chars.slice(0, 94) };
}
await writeFile('src/writing/fonts.json', `${JSON.stringify(subset)}\n`);
console.log('Wrote 94 unmodified ASCII glyph records per style from the verified public-domain JSON.');
