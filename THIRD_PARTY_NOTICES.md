# Third-party notices

## Classical reading collection: public domain

`src/readings.ts` bundles 12 original English poems and sonnets by William
Shakespeare, William Blake, William Wordsworth, John Keats, and Percy Bysshe
Shelley. The originals were published in 1609-1824 and the authors died in
1616-1850. Only public-domain poem text is reproduced, not modern commentary,
translations, website wrappers, or scanned media.

Transcriptions are credited to Wikisource contributors and follow identified
historical editions. Detailed publication/death evidence, source URLs, reuse
terms and ASCII-normalization notes accompany the distribution in
[public/texts/CREDITS.md](public/texts/CREDITS.md). This text collection has no
runtime text-service dependency and is separate from font and music rights.

## Stroke lettering: public domain

The bundled file `src/writing/fonts.json` contains the `scripts` ("Script
1-stroke") and `futural` ("Sans 1-stroke") entries from the **original Hershey
JSON dataset** distributed by Hershey Text JS. Only those two entries' 94
printable character records are included. No other SVG font assets or renderer
code were copied.

- Original source: https://github.com/techninja/hersheytextjs
- Data: https://raw.githubusercontent.com/techninja/hersheytextjs/master/hersheytext.min.json
- License statement: https://github.com/techninja/hersheytextjs/blob/master/README.md
- Upstream states: "JSON data Public Domain, All other code MIT Licensed."
- Data obtained: 2026-09-09.
- Bundled subset SHA-256: `251bd6a71876eb735e78744bdf98fd445c7b78a43dbeeeb1a2f045f796930098`

The app parses, smooths, positions, and plays those centerline definitions with
its own engine. Software, font, and recording rights are tracked separately.
The software licenses below do not grant rights to unrelated media. Detailed
source checksums and the opt-in regeneration command are in
`public/data/HERSHEY-ATTRIBUTION.txt`.

The editor font files `public/fonts/ink-correspondence.otf` and
`public/fonts/ink-everyday.otf` are locally generated outline derivatives of the
same public-domain lettering, not third-party commercial fonts. Their metadata
preserves that provenance. `scripts/generate-editor-fonts.mjs` reproduces them
with `npm run fonts`; only editor display uses those outlines.

## Additional handwriting: Google Fonts

The **unmodified source fonts** were obtained from the official
[google/fonts repository](https://github.com/google/fonts). Each is bundled
with its original license text under `public/fonts/`. OFL-1.1 and Apache-2.0
permit this commercial website use and redistribution; these are not unlicensed
font files inferred from a software package's license.

The approved collection has 34 active faces: the public-domain Correspondence
face above and 33 Google Fonts. Thirty of the selected Google Fonts use OFL-1.1;
**Homemade Apple, Rock Salt, and Walter Turncoat** use Apache-2.0.
The site's About dialog lists every active family and links its original source
and bundled license. The complete per-family source inventory, exact license
paths, and checksums are in
[HANDWRITING-ATTRIBUTION.json](public/data/HANDWRITING-ATTRIBUTION.json).
The approved IDs and review revision are recorded in
[applied-selection.json](font-review/applied-selection.json).

The original copyright statements remain in the source font metadata and
individual license files. The offline-derived centerline datasets in
`src/writing/handwriting-fonts.json` have separate **Ink Stroke Study**
names, and each retains its corresponding source's license. Source family
names in the UI identify the original editor fonts, not renamed replacement TTFs.
No endorsement by the font designers is implied.

These modifications rasterize, skeletonize, simplify, and infer writing
trails; ordinary fonts do not supply a human stroke timeline. Source URLs,
font/license SHA-256 checksums, the study-name mapping, and any explicit
tiny-glyph interpretations are in
[HANDWRITING-ATTRIBUTION.json](public/data/HANDWRITING-ATTRIBUTION.json).

Italianno's source underscore has no outline. The editor's CSS excludes that
single character from its font face so a system-serif fallback keeps it visible.
The writing dataset reconstructs the underscore from the original font's
underline metrics, recorded in the attribution data. Source font bytes are
unmodified; the fallback does not redistribute a system font.

## Local font-review candidates

The local `font-review/index.html` checklist retains all 100 candidates,
including the original 22 styles and the 34 now selected for the website.
The complete review contains
86 OFL-1.1 faces, 12 Apache-2.0 faces, and the two existing public-domain
Hershey-derived editor faces. These candidates are for selection only; they are
not automatically added to the website's writing collection or runtime assets.
Unselected original font assets and their licenses are preserved for review
and provenance; they are not active handwriting choices. The review catalog
also retains their exact paths and source attribution.

[font-review/catalog.json](font-review/catalog.json) records each candidate's
official source, exact font and license SHA-256 checksums, and local asset paths.
Original additional fonts and copyright/license texts are in `font-review/fonts/`
and `font-review/licenses/`. The standalone comparison HTML embeds the original
font bytes and all corresponding copyright/license notices. No designer
endorsement is implied.

## Recorded music: CC0 1.0

The three local MP3 recordings are shared under explicit CC0 declarations on
their creators' OpenGameArt releases. These declarations cover the uploaded
music assets; an API or software license is not being used as a substitute
for recording/composition permission. No artist endorsement is implied.

| Recording | Artist | Creator's release |
| --- | --- | --- |
| First Snow | HoliznaCC0 | [Lo-Fi and Chill collection](https://opengameart.org/content/lo-fi-and-chill-collection) |
| Chill lofi inspired | omfgdude | [Release](https://opengameart.org/content/chill-lofi-inspired) |
| happy lofi day | Tarush Singhal | [Release](https://opengameart.org/content/happy-lofi-day) |

[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) permits commercial
use, copying, and redistribution without attribution; credits are included
anyway. Audio files are unmodified except for normalized filenames. Playback
gain is adjusted by the app's mixer. Exact download URLs, acquisition date,
and file checksums are in [recording credits](public/audio/lofi/CREDITS.txt).
All playback is from this site's own bundled files, not hotlinked or streamed
from a third-party service.

## Software dependencies

- Three.js and its included add-ons: MIT, https://github.com/mrdoob/three
- Vite (development/build tool): MIT, https://github.com/vitejs/vite
- TypeScript (development tool): Apache-2.0, https://github.com/microsoft/TypeScript
- DefinitelyTyped Three.js definitions (development): MIT, https://github.com/DefinitelyTyped/DefinitelyTyped
- OpenType.js (editor-font generation only): MIT, https://github.com/opentypejs/opentype.js
- @napi-rs/canvas (offline handwriting generation only): MIT, https://github.com/Brooooooklyn/canvas

Exact resolved versions are recorded in `package-lock.json`. Package
distributions include their own license files and notices.

## Original / system-provided material

Room geometry, procedural wood/leather/paper textures, UI icons, short sample
text, friction/weather/interaction synthesis, and the two ambient note sequences
were created for this prototype. There are no downloaded models or stock images.
The additional fonts and recordings are licensed separately above. Interface and paper stationery
labels use the visitor's installed system fonts; those font files are not
redistributed.
