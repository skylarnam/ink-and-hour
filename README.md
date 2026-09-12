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
defaults to on for each visit and attempts playback on load. Browser autoplay
rules still apply: if playback is blocked, Start sound or an ordinary eligible
interaction retries it. The app does not deliberately wait for that interaction.

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
  or moved. The remaining text reflows across the current and future pages; choices
  exceeding ten pages are rejected without changing the ink or editor size. Lettering controls stay
  locked while the pen is moving.
  Correspondence is joined by 33 locally bundled Google
  Fonts families. The editable text uses the selected handwriting's source font;
  the additional pen styles are interpreted centerline studies of those faces.
  **Write it again** replays a completed manuscript. **Start over** clears all
  pages but keeps the words. **Keep this page** exports the viewed completed
  sheet as a 1560 x 2080 PNG, with page numbers in multi-page filenames.
  When the whole manuscript finishes, the pen lifts and settles beside it.
- Long manuscripts flow across **up to ten physical pages**, with a separate
  **20,000-character safety limit**. Actual capacity depends on handwriting,
  lettering size and line breaks. A gentle slide/dissolve replaces a full page,
  with the pen lifted throughout; reduced motion skips this animation. Pause
  also pauses a page turn. Previous/next controls browse already written pages
  while paused or finished; **Resume writing** restores the active page and
  exact pen position. Earlier pages are read-only. Their original paper and ink
  are retained as compressed, in-memory snapshots, not ten live canvases.
  Page history is cleared by Start over, editing a completed manuscript, or
  leaving the visit. Export pages individually if you want to keep them.
- **Write something random** starts continuous writing from 12 bundled
  public-domain poems and sonnets by Shakespeare, Blake, Wordsworth, Keats,
  and Shelley. Titles and authors are written too. Readings are shuffled
  without immediate repeats at a cycle boundary and share a sheet when there
  is room; a work ending does not force a page turn. This mode continues beyond
  page ten until you pause, switch modes, or close the page. Only the latest
  ten physical pages, including the current one, stay available for browsing
  and individual export. Unshaped text is bounded and only one active page
  layout/engine is retained, so the transcript does not grow indefinitely.
  While paused, handwriting/size/alignment still reflow only the unwritten
  words. **New reading** resets to fresh pages and waits for Begin; **Use my
  words** stops automatic writing and restores your typed draft. Switching
  modes clears the old rendered pages, not that held draft. Automatic mode
  and words are not saved between visits. **Sources & credits** lists the
  original editions, publication dates, and public-domain evidence, also
  bundled in `public/texts/CREDITS.md`. There is no runtime text API or network
  retrieval, and source spellings are preserved with documented ASCII
  punctuation normalization.
- The editor starts at a compact 18px for Correspondence, with calibrated
  sizes for the other faces. Pinch over the textbox with a trackpad or two
  fingers, or use **A- / A+**, to resize **both the editor and actual paper
  lettering**. Size is bounded to 75-200% and scales letters, spaces and line
  spacing, not the physical nib width. Larger lettering fits less on a sheet.
  **Left** is the default alignment; **Center** centers each new line by its
  actual ink bounds within the page margins. On a paused page, any line with
  existing ink keeps its anchor; alignment applies to subsequent untouched lines.
  Start over or replay applies the choices to the whole manuscript.
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
- **Quiet view** fills the window with the desk and hides the editor, settings,
  headings, and camera controls without interrupting writing or sound. It holds
  the current camera position rather than automatically following the nib;
  deliberate camera drags and zoom still work. A small bar retains writing,
  sound, and **Show controls**. Escape also exits, restoring keyboard focus and
  the previous scroll position. Quiet view is not saved between visits.
- **Tools** offers a lacquer fountain pen and a wooden dip holder, three nib
  characters (fine, broad edge, soft flex), three paper surfaces, four preset inks,
  and a **rainbow color picker** for a custom shade.
  Nib, ink, paper, and pace can change during writing. Existing ink keeps its
  color; new strokes use the new color. Text stays read-only during a run;
  handwriting, size and alignment unlock when paused.
  The custom shade persists. Cotton has warmer cellulose mottling, longer
  fibers, more matte relief, and slightly softer/wider absorbed ink; Smooth
  stays fine-grained and lightly finished.
  Fresh strokes have a restrained wet finish that catches the room's light and
  dries over four seconds, including while paused. Slower, loaded strokes leave
  slightly denser ink within the same nib footprint, not enlarged blobs.
  Reduced motion settles the sheen immediately; exported pages contain only
  permanent ink and paper.
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
- Sound attempts to start automatically on load. If browser policy blocks it,
  **Start sound** or an ordinary click, tap, or typing key retries playback;
  opening the Sound tab is not required. The blocked state is not a user mute.
  Touch activation uses release/click gestures rather than an early pointerdown.
  A first tap on a desk material waits for the context to be ready before its cue.
  **Sound is on** mutes playback; a chosen mute remains in force for the visit.
  Writing/materials, ambience, music, and overall volume have independent controls.
  Fresh settings use **70% overall, 30% Pen & materials, 20% Outside the window,
  and 20% Background music**. **Lo-fi** is selected by default and also attempts
  playback automatically. If media autoplay is separately blocked, Play music
  or another eligible interaction retries without losing the selected track.
  The mini-player immediately left of the sound switch offers previous,
  play/pause, and next for three real **CC0 lo-fi recordings**. Click its title
  for artist/source/license credits. The selected track persists; a new visit
  with lo-fi selected requests playback as soon as the audio context is available.
  Tracks load only when needed and advance
  when they end. **Felt notes** and **Glass garden** remain optional original
  synthesized beds, with the same play/pause control; skipping selects a lo-fi record.
  Previously saved volume and music choices, including **Off**, are preserved. Muting ambience stops
  its rain source, and idle/lifted pens have no continuing friction source.
  **Sound > Writing sound** offers **Textured** (the default), **Soft glide**,
  **Fine feedback**, and **Dry fibers**. Switch during a stroke to compare;
  it does not restart the pen or change the page. The choice persists across
  visits. Saved choices among these four are preserved; missing or retired
  choices use Textured. This choice affects only writing friction, not the mixer levels,
  rain, music, cap, leather, paper, or bottle sounds.
  **Spatial sound > Gentle stereo** adds optional, restrained left/right placement
  for the pen/materials and window as you move the camera. It starts **Off** and
  remembers your choice. It does not change the four sound textures or music,
  add pitch effects, or attenuate volume with distance. Returning to Off restores
  the normal centered sound.
  The ambience slider controls rain and thunder together. Recordings share
  the music/master mixer and pause when explicitly paused, muted, or set to zero volume.
  No remote music API, streaming account, key, or runtime third-party request
  is needed. The audio assets have separate licensing in the notices below.
- Switching tabs does not mute music or ambience. Writing uses a bounded
  background clock without rendering WebGL frames. If the browser stalls that
  clock, the pen pauses instead of leaving a stale friction loop sounding;
  music and weather can keep playing. Browser/OS background restrictions,
  especially on mobile, cannot be overridden by the site. Explicit Pause,
  mute, and Music Off remain authoritative.
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
The graph traversal covers each retained segment once, lifting to reach a new
branch rather than drawing back over completed ink. Compact raster junctions
are merged with bounded endpoint movement to avoid tiny false branches.
Tiny-glyph interpretations are recorded in the attribution
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
to deliberately regenerate an approved face. `--audit-stroke-flow ID` reports
unique retained graph length versus drawn trail length for that face. Changed source bytes require a
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
Fresh ink uses a separate 780 x 1040 linear roughness mask, updated at most
about 24 times a second. Only the latest 2,048 wet segments are retained;
older permanent ink is never removed. Dry masks are exactly white and stop
uploading, preserving the selected paper's matte finish. Aging does not rebuild
paper grain or the full-resolution color texture. Pooling is a small density
change based on actual segment speed and pressure, not a fluid simulation.

Writing has four independently selectable sound profiles, with **Textured**
as the default. They blend original, procedurally generated rubbing and irregular
paper-fiber detail through broad, non-resonant filters. Their balance follows
speed, pressure, paper, nib, and holder; broad-edge contact also follows stroke
direction. They use no pitched grains, control oscillators, or playback-rate
changes. **Textured**, **Soft glide**, **Fine feedback**, and **Dry fibers**
share that contact model, with distinct rubbing drift, fiber-patch
lengths/gaps, spectral bands, and layer balances. They are synthesis palettes,
not recordings of particular pen models. All four retain their established timbres.
A downstroke is not automatically treated as a hard contact.
All profiles exist only during moving contact: their friction fades to exact
zero within 7 ms of a lift and their sources stop within 12 ms. Material
changes reshape the current stroke without restarting its sound; switching
profiles briefly crossfades the sources without restarting writing.
Two contact filter/gain layers are reused, with at most three lazily generated
buffer pairs cached for comparisons.

Cap, paper, leather, and bottle events are separate short voices. Textbox pinch,
A-/A+, and other typography-driven page resets are silent; the explicit Fresh
sheet action still has its paper sound. The pen writes at a lower 42-degree
inclination, with its cross-edge level and its live nib point anchored to the ink.
One reusable
AudioContext has writing, ambience, and music buses behind a bounded
master/compressor. Mixer mutes reach exact zero within 21 ms, not an asymptotic
noise floor. Clear weather or zero ambience volume stops the rain source;
changing away from storm also stops a pending thunder voice. Zero music volume
or Music Off stops the music timer and releases its voices. Autoplay, gesture
retries and explicit mute preserve current intent, so a delayed resume cannot
override a newer mute request. Hidden-tab contact has a native gain-expiry
watchdog; browser timer suspension cannot leave a stale pen hiss.
The recording transport separately invalidates stale play promises, pauses its
single reusable media element when unavailable, and routes through the same
music bus at a restrained pre-gain. Loading failures are visible, not silent
fallbacks; playback intent is not stored.

## Honest prototype limits

- English ASCII letters, digits, spaces, newlines, and standard punctuation
  only. Unsupported characters get a visible error; they are never discarded.
  Typed manuscripts have a 20,000-character safety ceiling and a ten-page
  physical capacity limit. Continuous readings keep only their latest ten
  pages and use a bounded 20,000-character working buffer rather than a total
  transcript limit. Words and long unbroken text wrap without dropping characters. The
  page animation is a lightweight slide/dissolve, not a physically simulated
  curled sheet. PNG export is per page, not a combined PDF.
- These are 34 user-selected styles, not arbitrary font imports. Correspondence
  uses historical ordered centerlines; the other 33 approximate font shapes and
  infer their writing order. They are not recordings of a calligrapher's motion.
  Some letters use several lifts, and script letters
  are not continuously connected across every character boundary.
- No hand model, fluid simulation, ink depletion, automatic dipping, nib alloy
  simulation, or manufacturer-specific measurements. "Fine", "broad edge", and
  "soft flex" are generic expressive profiles, not claims of real interchangeable
  nib hardware. Broad and flex behavior are deliberately different.
- Friction/weather/material sounds and the two original beds are synthesized,
  not recorded ASMR. The new lo-fi playlist is genuine recorded music.
  The four contact-texture profiles are experimental interpretations of contact
  mechanics, not a calibrated physical model or a reproduction of reference
  recordings. No YouTube audio was sampled or bundled; reference study used
  visual/signal analysis and specialist sources, not direct audio audition.
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
playback; `src/audio.ts` owns Web Audio; `src/contact-texture.ts` generates the
experimental contact textures and their parameter model; `src/settings.ts` validates saved
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
