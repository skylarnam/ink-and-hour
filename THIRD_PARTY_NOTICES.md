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
its own engine. The permissive software licenses below do not grant rights to
unrelated fonts, models, or music; no such assets are bundled here. Detailed
source checksums and the opt-in regeneration command are in
`public/data/HERSHEY-ATTRIBUTION.txt`.

The editor font files `public/fonts/ink-correspondence.otf` and
`public/fonts/ink-everyday.otf` are locally generated outline derivatives of the
same public-domain lettering, not third-party commercial fonts. Their metadata
preserves that provenance. `scripts/generate-editor-fonts.mjs` reproduces them
with `npm run fonts`; only editor display uses those outlines.

## Software dependencies

- Three.js and its included add-ons: MIT, https://github.com/mrdoob/three
- Vite (development/build tool): MIT, https://github.com/vitejs/vite
- TypeScript (development tool): Apache-2.0, https://github.com/microsoft/TypeScript
- DefinitelyTyped Three.js definitions (development): MIT, https://github.com/DefinitelyTyped/DefinitelyTyped
- OpenType.js (editor-font generation only): MIT, https://github.com/opentypejs/opentype.js

Exact resolved versions are recorded in `package-lock.json`. Package
distributions include their own license files and notices.

## Original / system-provided material

Room geometry, procedural wood/leather/paper textures, UI icons, short sample
text, friction/weather/interaction synthesis, and the two ambient note sequences
were created for this prototype. There are no downloaded models, recordings,
stock images, or embedded commercial fonts. Interface and paper stationery
labels use the visitor's installed system fonts; those font files are not
redistributed.
