import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import opentype from 'opentype.js';
import { HANDWRITING_STYLES } from '../src/handwriting.ts';
import { SAMPLE } from '../font-review/store.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'font-review/catalog.json');
const pool = [
  'Allura', 'Alex Brush', 'Dancing Script', 'Sacramento', 'Satisfy', 'Parisienne',
  'Great Vibes', 'Pacifico', 'Yellowtail', 'Tangerine', 'Bad Script', 'Marck Script',
  'Neucha', 'Amatic SC', 'Caveat Brush', 'Courgette', 'Cookie', 'Charm', 'Chilanka',
  'Delius', 'Delius Swash Caps', 'Delius Unicase', 'Dekko', 'Gochi Hand', 'Gloria Hallelujah',
  'Rock Salt', 'Permanent Marker', 'Just Me Again Down Here', 'Loved by the King',
  'Love Ya Like A Sister', 'Over the Rainbow', 'The Girl Next Door', 'Sunshiney',
  'Swanky and Moo Moo', 'Walter Turncoat', 'Zeyada', 'Vibur', 'Yesteryear', 'Itim',
  'Mali', 'Italianno', 'Kaushan Script', 'Leckerli One', 'Lemonada', 'Licorice',
  'Lumanosimo', 'Mogra', 'Mr Dafoe', 'Mr De Haviland', 'Mrs Saint Delafield',
  'Mrs Sheppards', 'Monsieur La Doulaise', 'Meddon', 'Meie Script', 'MonteCarlo',
  'Ms Madi', 'My Soul', 'Nanum Pen Script', 'Niconne', 'Norican', 'Oooh Baby',
  'Pangolin', 'Passions Conflict', 'Petemoss', 'Petit Formal Script', 'Pinyon Script',
  'Playball', 'Qwigley', 'Quintessential', 'Rancho', 'Rochester', 'Rouge Script',
  'Ruthie', 'Sedgwick Ave', 'Sedgwick Ave Display', 'Send Flowers', 'Sofia',
  'Stalemate', 'Style Script', 'Stylish', 'Tillana', 'Trade Winds', 'Water Brush',
  'Whisper', 'WindSong', 'Bilbo', 'Bilbo Swash Caps', 'Bonbon', 'Butterfly Kids',
  'Calligraffitti', 'Clicker Script', 'Condiment', 'Damion', 'Euphoria Script',
  'Felipa', 'Fondamento', 'Freckle Face', 'Grand Hotel', 'Herr Von Muellerhoff',
  'Kristi', 'Lovers Quarrel', 'Montez', 'Mr Bedfort', 'Grape Nuts', 'Square Peg',
  'Twinkle Star', 'Hurricane', 'Island Moments', 'Kolker Brush', 'Londrina Sketch',
  'Borel', 'Cedarville Cursive', 'Edu NSW ACT Foundation', 'Edu TAS Beginner',
  'Edu QLD Beginner', 'Edu SA Beginner', 'Edu VIC WA NT Beginner', 'Fasthand',
  'Fuzzy Bubbles', 'Klee One', 'Long Cang', 'Mansalva', 'Ma Shan Zheng', 'Redacted Script',
  'Sriracha', 'Srisakdi', 'Ballet', 'Birthstone', 'Birthstone Bounce', 'Bona Nova SC',
];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const slug = (name) => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const parseFont = (bytes) => opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const missingAscii = (font) => Array.from({ length: 95 }, (_, index) => String.fromCharCode(index + 32))
  .filter((character) => font.charToGlyphIndex(character) === 0);

try {
  await access(output);
  throw new Error('A font catalog already exists. It has been preserved; do not recollect over an active shortlist.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

async function download(url, optional = false) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (optional && response.status === 404) return null;
  if (!response.ok) throw new Error(`Font download failed: HTTP ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function preserveFile(relative, bytes) {
  const path = join(root, relative);
  await mkdir(dirname(path), { recursive: true });
  try {
    const current = await readFile(path);
    if (!current.equals(bytes)) throw new Error(`The existing ${relative} differs and was not overwritten.`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(path, bytes, { flag: 'wx' });
  }
}

const candidates = [];
for (const style of HANDWRITING_STYLES) {
  const fontFile = `public${style.publicFontPath}`;
  const licenseFile = `public${style.publicLicensePath}`;
  const bytes = await readFile(join(root, fontFile));
  const license = await readFile(join(root, licenseFile));
  candidates.push({
    id: style.id, label: style.label, family: style.family, current: true,
    fontFile, licenseFile, source: style.source, license: style.license,
    fontSha256: digest(bytes), licenseSha256: digest(license),
    missingAscii: missingAscii(parseFont(bytes)),
  });
}
if (candidates.length !== 22) throw new Error('Collect this review against the unchanged 22-style collection.');
const existing = new Set(candidates.map(({ label }) => slug(label)));
const families = new Set(candidates.map(({ family }) => family.toLowerCase()));
const additions = [];
const rejected = [];

for (const name of pool) {
  if (candidates.length + additions.length === 100) break;
  if (existing.has(slug(name))) continue;
  const directory = slug(name).replaceAll('-', '');
  let metadata = null;
  let folder = '';
  for (const licenseRoot of ['ofl', 'apache']) {
    folder = `${licenseRoot}/${directory}`;
    metadata = await download(`https://raw.githubusercontent.com/google/fonts/main/${folder}/METADATA.pb`, true);
    if (metadata) break;
  }
  if (!metadata) {
    rejected.push({ name, reason: 'No official metadata at the expected family path.' });
    continue;
  }
  const description = metadata.toString('utf8');
  const label = description.match(/^name:\s*"([^"]+)"/m)?.[1];
  const category = description.match(/^category:\s*"([^"]+)"/m)?.[1];
  const metadataLicense = description.match(/^license:\s*"([^"]+)"/m)?.[1];
  const blocks = [...description.matchAll(/fonts\s*\{([\s\S]*?)\n\}/g)].map((match) => match[1]);
  const block = blocks.find((value) => /style:\s*"normal"/.test(value) && /weight:\s*400\b/.test(value))
    ?? blocks.find((value) => /style:\s*"normal"/.test(value));
  const filename = block?.match(/filename:\s*"([^"]+)"/)?.[1];
  if (!label || !filename || !['OFL', 'APACHE2'].includes(metadataLicense) || category !== 'HANDWRITING') {
    rejected.push({ name, reason: 'Not an explicitly licensed regular handwriting family.' });
    continue;
  }
  const licenseName = metadataLicense === 'OFL' ? 'OFL.txt' : 'LICENSE.txt';
  const raw = `https://raw.githubusercontent.com/google/fonts/main/${folder}`;
  const fontUrl = `${raw}/${filename.split('/').map(encodeURIComponent).join('/')}`;
  const bytes = await download(fontUrl);
  const license = await download(`${raw}/${licenseName}`);
  const font = parseFont(bytes);
  const missing = missingAscii(font);
  if (missing.length) {
    rejected.push({ name: label, reason: `Missing printable ASCII: ${JSON.stringify(missing)}` });
    continue;
  }
  const family = font.names.preferredFamily?.en ?? font.names.fontFamily?.en ?? label;
  if (families.has(family.toLowerCase())) {
    rejected.push({ name: label, reason: 'Another weight or alias of an already included family.' });
    continue;
  }
  const licensed = metadataLicense === 'OFL' ? /SIL OPEN FONT LICENSE|Open Font License/i.test(license.toString('utf8'))
    : /Apache License/.test(license.toString('utf8')) && /Version 2\.0/.test(license.toString('utf8'));
  if (!licensed) throw new Error(`The expected commercial-use license was not present for ${label}.`);
  const id = slug(label);
  const fontFile = `font-review/fonts/${id}.${filename.endsWith('.otf') ? 'otf' : 'ttf'}`;
  const licenseFile = `font-review/licenses/${id}/${licenseName}`;
  await preserveFile(fontFile, bytes);
  await preserveFile(licenseFile, license);
  additions.push({
    id, label, family, current: false, fontFile, licenseFile,
    source: `https://github.com/google/fonts/tree/main/${folder}`,
    license: metadataLicense === 'OFL' ? 'OFL-1.1' : 'Apache-2.0',
    fontSha256: digest(bytes), licenseSha256: digest(license), missingAscii: missing,
    fontUrl, licenseUrl: `${raw}/${licenseName}`, category,
  });
  families.add(family.toLowerCase());
  console.log(`${candidates.length + additions.length}/100 ${label}`);
}
if (candidates.length + additions.length !== 100) {
  throw new Error(`Only ${candidates.length + additions.length} eligible candidates were found. ${JSON.stringify(rejected)}`);
}
additions.sort((a, b) => a.label.localeCompare(b.label, 'en'));
await writeFile(output, `${JSON.stringify({
  version: 1, sample: SAMPLE, collectedAt: new Date().toISOString(),
  candidates: [...candidates, ...additions], rejected,
}, null, 2)}\n`, { flag: 'wx' });
console.log(`Saved exactly 100 distinct candidates, including all 22 current styles. Excluded ${rejected.length} unsuitable families.`);
