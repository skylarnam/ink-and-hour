# Ink & Hour

A local-first, ASMR-first 3D writing ritual. This is a playable first edition, not
a productivity tool or a manufacturer-accurate pen simulator.

[Open the live site](https://ink-and-hour.vercel.app/) |
[Private GitHub repository](https://github.com/skylarnam/ink-and-hour)

## Run

Use Node.js 22.18+ (or 24 LTS) and npm.

```sh
npm install
npm run dev
```

Vite binds to `127.0.0.1` and prints the available localhost URL. To choose a port:

```sh
npm run dev -- --port 4173 --strictPort
```

```sh
npm test        # Node's built-in test runner; no browser test dependencies
npm run build  # Strict TypeScript checking, then a production bundle in dist/
npm run preview
```

The runtime requires WebGL 2 and a modern browser. Everything is bundled locally;
there is no backend, account, analytics, paid key, runtime CDN, or remote asset
request. Preferences are stored in validated, versioned local storage. Sound
defaults to on for each visit, but browser autoplay rules are honored: the
AudioContext starts with the first click, tap, or meaningful keypress.

## Hosting

This is a static Vite site. `vercel.json` selects the Vite framework, installs
from the lockfile, runs `npm run build`, and publishes `dist/`. No database,
server process, environment variables, or paid add-ons are needed.

The private GitHub repository is connected to Vercel: pushes to `main` deploy
automatically to the production site on the Hobby plan. For a one-off CLI
deployment, use `npx vercel@latest --prod`; this uses a current uploader without
replacing a globally installed CLI.
The production build includes all local fonts and textures, the attribution
notes, and the full Three.js license.

Local preview servers should run in the app's normal Terminal panel, rather
than an agent background task. A server intentionally remains running; keeping
it in a terminal separates its lifetime from the agent's completed work.

## Settle in

- Write an English note, choose one of **34 handpicked handwritings**, and
  select **Begin writing**. Pause/resume preserves the exact writing position.
  While paused, handwriting and size can change for the unwritten letters. A partially
  written letter finishes in its original style and size; existing ink is never erased
  or moved. The remaining text reflows within the page, and a choice that would
  overflow is rejected without changing the sheet or editor size. Lettering controls stay
  locked while the pen is moving.
  Correspondence is joined by 33 locally bundled Google
  Fonts families. The editable text uses the selected handwriting's source font;
  the additional pen styles are interpreted centerline studies of those faces.
  **Write it again** replays a completed note. **Fresh sheet** clears the ink but
  keeps the words. **Keep this page** exports the completed sheet as a 1560 x 2080 PNG.
  When writing finishes, the pen lifts and settles beside the completed sheet.
- The editor starts at a compact 18px for Correspondence, with calibrated
  sizes for the other faces. Pinch over the textbox with a trackpad or two
  fingers, or use **A- / A+**, to resize **both the editor and actual paper
  lettering**. Size is bounded to 75-200% and scales letters, spaces and line
  spacing, not the physical nib width. Larger lettering fits less on a sheet.
  **Left** is the default alignment; **Center** centers each new line by its
  actual ink bounds within the page margins. On a paused page, any line with
  existing ink keeps its anchor; alignment applies to subsequent untouched lines.
  A fresh sheet or replay applies the choices to the whole note.
  Size and alignment carry across handwriting choices and are saved for the
  next visit. They do not change camera or browser zoom. The textbox remains
  scrollable and resizable while its words are read-only during a run.
- Drag to rotate, or turn on **Move** and hold-drag to pan a little across the
  desk. **Shift-drag** and **right-drag** also pan without switching modes.
  On touchscreens, use one finger in Move mode or two fingers in either mode.
  Scroll/pinch still zooms. Panning stays on the desk plane within a small radius
  of the current preset, so the room cannot get lost.
- **Desk**, **Nib close-up** (which follows the nib until you adjust the view),
  **Overhead**, and the reset button offer accessible camera presets. With the
  canvas focused, arrow keys rotate (or pan in Move mode), Shift-arrow keys pan,
  plus/minus zoom, and Home restores the desk framing. Presets recenter panning.
- **Tools** offers a lacquer fountain pen and a wooden dip holder, three nib
  characters (fine, broad edge, soft flex), three paper surfaces, four preset inks,
  and a **rainbow color picker** for a custom shade.
  Nib, ink, paper, and pace can change during writing. Existing ink keeps its
  color; new strokes use the new color. Text stays read-only during a run;
  handwriting, size and alignment unlock when paused.
  The custom shade persists. Cotton has warmer cellulose mottling, longer
  fibers, more matte relief, and slightly softer/wider absorbed ink; Smooth
  stays fine-grained and lightly finished.
- In rotation mode, click the pen/cap, glass bottle, or tied leather roll in the scene. The same
  cap and roll actions have labeled buttons. The roll unfolds into four pen
  pockets. The dip holder has no cap.
- **Room** changes the actual 3D materials and palette between Rainy Study,
  Sunlit Atelier, and Storybook Nook. Time controls the sun, sky, and lamp.
  Outside, branching trees and leafy crowns sit on rolling terrain, with
  distance haze and slowly changing clouds. Clear/rain/storm is independent
  of mood and time. Varied-depth rain falls outside the window, with brighter
  near-window streaks that remain visible in the default desktop and phone
  views, plus beads and trailing drops on the glass. Clear removes all rain layers.
  Storms have isolated, gentle light pulses with delayed thunder, not repeated
  rapid flashes. The coffee cup has a joined, open-D ceramic handle and sits
  behind the paper, clear of both roll states. Books angle away from the roll.
- Sound is on by default and starts at the first browser-allowed interaction;
  no separate enable click is needed. Click **Sound is on** to mute, even before
  the first interaction. A chosen mute remains in force for the current visit.
  Writing/materials, ambience, music, and overall volume have independent controls.
  Fresh settings use **70% overall, 30% Pen & materials, 20% Outside the window,
  and 20% Background music**. **Lo-fi** is selected by default and starts with
  that first interaction, never before it. The mini-player immediately left of the sound switch offers previous,
  play/pause, and next for three real **CC0 lo-fi recordings**. Click its title
  for artist/source/license credits. The selected track persists; a new visit
  with lo-fi selected queues it behind the first-interaction sound gate.
  Tracks load only when needed and advance
  when they end. **Felt notes** and **Glass garden** remain optional original
  synthesized beds, with the same play/pause control; skipping selects a lo-fi record.
  Previously saved volume and music choices, including **Off**, are preserved. Muting ambience stops
  its rain source, and idle/lifted pens have no continuing friction source.
  The ambience slider controls rain and thunder together. Recordings share
  the music/master mixer and pause when muted, hidden, or set to zero volume.
  No remote music API, streaming account, key, or runtime third-party request
  is needed. The audio assets have separate licensing in the notices below.
- Leaving the tab pauses writing, silences friction, and suspends audio. On
  return, audio can resume if previously enabled, but writing waits for Resume.
  Reduced-motion preferences remove storm flashes and floating dust, freeze
  cloud/leaf motion, and make camera/case/cap/pen-return transitions immediate.

## Font shortlisting

`font-review/index.html` is a self-contained, 100-row font comparison using
"The quick brown fox jumps over the lazy dog." It retains all 100 candidates,
including the original 22 and the 34 now applied to the website. Every checkbox
originally started unchecked; the user's saved choices are preserved.
Original font bytes, source links, checksums,
and licenses are retained alongside `font-review/catalog.json`; the HTML also
embeds the fonts and copyright/license notices.

Open the **Handwriting shortlist** canvas in Copilot to review it. The project
extension saves each checkbox directly to `font-review/selection.json`.
Selections survive panel and app reloads, and the agent can read that file or
the canvas's `read_selection` action after the user says they are done.
Checking a font does **not** apply it to the website. The live collection stays
unchanged until that confirmation, when only the checked candidates should be
integrated. `font-review/applied-selection.json` records the approved 34 IDs
and source revision used for the current collection. Later checkbox changes
do not silently alter the app.

The standalone HTML file also offers **Download selections**, since an ordinary
browser tab cannot automatically write its sibling JSON file. Automatic saving
is available in the app canvas; it does not require the website's dev server.
The review assets are local project files, not additional Vercel site assets.
Rebuild the review without downloading fonts or resetting selections with:

```sh
node scripts/build-font-review.mjs
```

## How the writing works

`src/writing/fonts.json` contains only the public-domain original Hershey
**Script 1-stroke** and **Sans 1-stroke** datasets. Each `M` defines a pen lift;
`L` sequences define writing centerlines, not glyph outlines. The engine rounds
the polylines gently without replacing their stroke order, lays out finite
pages, then advances along their arc lengths. The same live point drives both
new ink segments and the 3D nib tip.

The Correspondence editor face is generated from those same public-domain
centerlines, not just an italic CSS treatment. The original Everyday print
data and editor font remain available for review/provenance but are not an
active writing choice. These static outline fonts are only for the text editor;
the pen still uses stroke-order playback. Regenerate the original two editor
font assets with `npm run fonts`.

The 33 selected additional families come from Google's official `google/fonts`
repository under OFL-1.1 or Apache-2.0; each unmodified TTF and its own license
is bundled. An offline generator rasterizes glyphs, thins them to centerlines,
prunes tiny spurs, infers connected writing trails, and simplifies the paths.
The derived datasets have separate **Ink Stroke Study** names, distinct from the
original source-font names. Their selected family names identify the source
shown in the editor. Actual pen playback draws these generated centerlines,
not outlines, a typeset reveal, or a motion unrelated to the ink.

Stroke order in an ordinary font is **inferred**, not recorded by its designer.
Some shared branches are retraced; completed trails are not gratuitously traced
back to their start. Tiny-glyph interpretations are recorded in the attribution
data. Italianno's original font has a blank underscore: its editor face excludes
that character so the system-serif fallback keeps it visible, while the pen
uses a documented reconstruction from that font's own underline metrics.
The original font bytes remain unmodified; no whole handwriting is substituted.
The source versions, SHA-256 checksums, and individual license paths
are recorded in `public/data/HANDWRITING-ATTRIBUTION.json`.

Offline regeneration (not part of the production build):

```sh
node --experimental-strip-types scripts/generate-handwriting-data.ts
node --experimental-strip-types scripts/render-handwriting-contact-sheet.ts /tmp/ink-hour-font-studies
```

Existing selected centerlines are preserved by default. Use `--regenerate ID`
to deliberately retrace an approved face. Changed source bytes require a
refreshed catalog and explicit approval snapshot before generation will proceed.
`scripts/apply-font-selection.ts` requires both the approved `--revision` and
`--sha256`; it never follows a changing checklist implicitly.

`scripts/fetch-handwriting-fonts.ts` is an opt-in upstream source update command;
it uses the catalog's original filenames even when the local copy was renamed.
Use `--dry-run` to list its URLs without network or file changes. Without that
flag it overwrites those named assets; review source/license changes and update
the approval metadata before intentionally regenerating the stroke data.

Pointed flex width is pressure/downstroke-sensitive; broad-edge width depends
on the relationship between a fixed edge angle and stroke direction. Fine is
restrained. The two holders have different flex/audio responses. A layered 2D
paper/ink canvas is mapped onto the 3D sheet, with grain cached separately.
Paper relief has its own cached height texture; ink changes do not rebuild it.

Writing uses the original soft, filtered friction sound, with a stronger mix
but no pitched grains, resonant chirps, or playback-rate changes. Filtering
and gain follow speed, pressure, paper, nib, and holder. The contact source
exists only during moving contact: it fades to exact zero within 7 ms of a
lift and stops within 12 ms. Material changes reshape the current stroke
without restarting its sound.

Cap, paper, leather, and bottle events are separate short voices. One reusable
AudioContext has writing, ambience, and music buses behind a bounded
master/compressor. Mixer mutes reach exact zero within 21 ms, not an asymptotic
noise floor. Clear weather or zero ambience volume stops the rain source;
changing away from storm also stops a pending thunder voice. Zero music volume
or Music Off stops the music timer and releases its voices. Enable, mute, and
tab-visibility transitions are serialized so a delayed resume cannot override
a newer mute request.
The recording transport separately invalidates stale play promises, pauses its
single reusable media element when unavailable, and routes through the same
music bus at a restrained pre-gain. Loading failures are visible, not silent
fallbacks; playback intent is not stored.

## Honest prototype limits

- English ASCII letters, digits, spaces, newlines, and standard punctuation
  only. Unsupported characters get a visible error; they are never discarded.
  There is a 420-character input ceiling and a stricter physical sheet-capacity
  check. Words and long unbroken text wrap; there is no automatic second page.
- These are 34 user-selected styles, not arbitrary font imports. Correspondence
  uses historical ordered centerlines; the other 33 approximate font shapes and
  infer their writing order. They are not recordings of a calligrapher's motion.
  Some letters use several lifts or shared-stem retracing, and script letters
  are not continuously connected across every character boundary.
- No hand model, fluid simulation, ink depletion, automatic dipping, nib alloy
  simulation, or manufacturer-specific measurements. "Fine", "broad edge", and
  "soft flex" are generic expressive profiles, not claims of real interchangeable
  nib hardware. Broad and flex behavior are deliberately different.
- Friction/weather/material sounds and the two original beds are synthesized,
  not recorded ASMR. The new lo-fi playlist is genuine recorded music.
  Quiet headphones are recommended; output character depends on the device.
- The outdoor view is a lightweight, depth-compressed procedural landscape,
  not a scanned forest, volumetric sky, or physical rain/refraction simulation.
- A page is kept only for the current browser session unless exported. Material,
  room, time, pace, lettering and volume preferences persist, but text and ink do not.
- WebGL rendering and dynamic ink textures can be demanding on older phones.
  Camera travel is constrained to avoid looking through the room walls.

## Source map

`src/main.ts` integrates the ritual and lifecycle; `src/ui.ts` and `src/style.css`
are the responsive, keyboard-labeled interface; `src/scene.ts` builds the room;
`src/outdoors.ts` builds its layered landscape and weather; `src/textures.ts`
makes procedural materials and ink; `src/writing/` owns layout and stroke
playback; `src/audio.ts` owns Web Audio; `src/settings.ts` validates saved
preferences. `tests/` exercises those pure/stateful boundaries.

`src/handwriting.ts` is the 22-style registry, and `src/fonts.css` declares the
local editor faces. `src/ink.ts` resolves preset/custom ink. `src/recorded-music.ts`
owns the recording transport; `src/music-library.ts` declares the three licensed
records without downloading or starting them at import time.

During `npm run dev`, `window.__inkAndHour` is a read-only snapshot getter for
writing contact/progress, audio gain targets/lifecycle, and scene settings.
It provides no mutation methods and is omitted from production builds.

See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for the separately tracked
software, lettering, and recording provenance.

The distinction between soft/pointed flex and stub/music broad-edge behavior
was informed by [Pilot's nib guide](https://www.pilot-custom.jp/en/feature/nib.html);
no manufacturer force curves or hardware compatibility are claimed. Gesture
gating and AudioParam scheduling follow
[MDN's Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices).
