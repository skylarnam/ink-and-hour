# Third-party notices

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

The following **unmodified source fonts** were obtained from the official
[google/fonts repository](https://github.com/google/fonts). Each is bundled
with its original license text in the listed directory. OFL-1.1 and Apache-2.0
permit this commercial website use and redistribution; these are not unlicensed
font files inferred from a software package's license.

| Source family | License | Bundled license |
| --- | --- | --- |
| Caveat | OFL-1.1 | [OFL](public/fonts/caveat/OFL.txt) |
| Patrick Hand | OFL-1.1 | [OFL](public/fonts/patrickhand/OFL.txt) |
| Handlee | OFL-1.1 | [OFL](public/fonts/handlee/OFL.txt) |
| Indie Flower | OFL-1.1 | [OFL](public/fonts/indieflower/OFL.txt) |
| Kalam | OFL-1.1 | [OFL](public/fonts/kalam/OFL.txt) |
| Shadows Into Light | OFL-1.1 | [OFL](public/fonts/shadowsintolight/OFL.txt) |
| Shadows Into Light Two | OFL-1.1 | [OFL](public/fonts/shadowsintolighttwo/OFL.txt) |
| Coming Soon | Apache-2.0 | [License](public/fonts/comingsoon/LICENSE.txt) |
| Schoolbell | Apache-2.0 | [License](public/fonts/schoolbell/LICENSE.txt) |
| Architects Daughter | OFL-1.1 | [OFL](public/fonts/architectsdaughter/OFL.txt) |
| Nothing You Could Do | OFL-1.1 | [OFL](public/fonts/nothingyoucoulddo/OFL.txt) |
| Reenie Beanie | OFL-1.1 | [OFL](public/fonts/reeniebeanie/OFL.txt) |
| Homemade Apple | Apache-2.0 | [License](public/fonts/homemadeapple/LICENSE.txt) |
| Sue Ellen Francisco | OFL-1.1 | [OFL](public/fonts/sueellenfrancisco/OFL.txt) |
| Just Another Hand | Apache-2.0 | [License](public/fonts/justanotherhand/LICENSE.txt) |
| La Belle Aurore | OFL-1.1 | [OFL](public/fonts/labelleaurore/OFL.txt) |
| Cedarville Cursive | OFL-1.1 | [OFL](public/fonts/cedarvillecursive/OFL.txt) |
| Dawning of a New Day | OFL-1.1 | [OFL](public/fonts/dawningofanewday/OFL.txt) |
| Give You Glory | OFL-1.1 | [OFL](public/fonts/giveyouglory/OFL.txt) |
| Waiting for the Sunrise | OFL-1.1 | [OFL](public/fonts/waitingforthesunrise/OFL.txt) |

The original copyright statements remain in the source font metadata and
individual license files. The offline-derived centerline datasets in
`src/writing/handwriting-fonts.json` are separately named **Ink Stroke Study
01-20**, and each retains its corresponding source's license. Source family
names in the UI identify the original editor fonts, not renamed replacement TTFs.
No endorsement by the font designers is implied.

These modifications rasterize, skeletonize, simplify, and infer writing
trails; ordinary fonts do not supply a human stroke timeline. Source URLs,
font/license SHA-256 checksums, the study-name mapping, and the three explicit
tiny-punctuation approximations are in
[HANDWRITING-ATTRIBUTION.json](public/data/HANDWRITING-ATTRIBUTION.json).

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
