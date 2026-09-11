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

- Write an English note, choose one of **22 handwritings**, and
  select **Begin writing**. Pause/resume preserves the exact writing position.
  Correspondence and Everyday print are joined by 20 locally bundled Google
  Fonts families. The editable text uses the selected handwriting's source font;
  the additional pen styles are interpreted centerline studies of those faces.
  **Write it again** replays a completed note. **Fresh sheet** clears the ink but
  keeps the words. **Keep this page** exports the completed sheet as a 1560 x 2080 PNG.
  When writing finishes, the pen lifts and settles beside the completed sheet.
- The editor starts at a compact 18px for Correspondence and 16px for print.
  Pinch over the textbox with a trackpad or two fingers to resize its text, or
  use the keyboard-accessible **A- / A+** buttons. Display zoom is bounded to
  75-200%, carries across handwriting choices, and resets on reload. It does
  not change the written page, camera, or browser zoom. The textbox remains
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
  color; new strokes use the new color. Text and style are locked during a run.
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
  Writing/materials, ambience, music, and overall volume have independent controls. Music starts
  **Off**. The mini-player immediately left of the sound switch offers previous,
  play/pause, and next for three real **CC0 lo-fi recordings**. Click its title
  for artist/source/license credits. The selected track persists, but recordings
  never auto-resume on a new visit. Tracks load only when needed and advance
  when they end. **Felt notes** and **Glass garden** remain optional original
  synthesized beds, with the same play/pause control; skipping selects a lo-fi record.
  Pen sound is balanced ahead of default rain. New visits start Pen & materials
  at 90%; previously saved volume choices are preserved. Muting ambience stops
  its rain source, and idle/lifted pens have no continuing friction source.
  The ambience slider controls rain and thunder together. Recordings share
  the music/master mixer and pause when muted, hidden, or set to zero volume.
  No remote music API, streaming account, key, or runtime third-party request
  is needed. The audio assets have separate licensing in the notices below.
- Leaving the tab pauses writing, silences friction, and suspends audio. On
  return, audio can resume if previously enabled, but writing waits for Resume.
  Reduced-motion preferences remove storm flashes and floating dust, freeze
  cloud/leaf motion, and make camera/case/cap/pen-return transitions immediate.

## How the writing works

`src/writing/fonts.json` contains only the public-domain original Hershey
**Script 1-stroke** and **Sans 1-stroke** datasets. Each `M` defines a pen lift;
`L` sequences define writing centerlines, not glyph outlines. The engine rounds
the polylines gently without replacing their stroke order, lays out finite
pages, then advances along their arc lengths. The same live point drives both
new ink segments and the 3D nib tip.

The editor's two local OpenType font faces are generated from those same
public-domain centerlines, so selecting a style changes the actual editable
letterforms, not just an italic CSS treatment. These static outline fonts are
only for the text editor; the pen still uses stroke-order playback. Regenerate
the checked-in font assets with `npm run fonts`.

The 20 additional families come from Google's official `google/fonts`
repository under OFL-1.1 or Apache-2.0; each unmodified TTF and its own license
is bundled. An offline generator rasterizes glyphs, thins them to centerlines,
prunes tiny spurs, infers connected writing trails, and simplifies the paths.
The derived datasets are named **Ink Stroke Study 01-20**, distinct from the
original source-font names. Their selected family names identify the source
shown in the editor. Actual pen playback draws these generated centerlines,
not outlines, a typeset reveal, or a motion unrelated to the ink.

Stroke order in an ordinary font is **inferred**, not recorded by its designer.
Some shared branches are retraced; completed trails are not gratuitously traced
back to their start. Tiny periods/colon in Coming Soon and a period in Schoolbell
use explicit short punctuation strokes. No added family silently falls back to
another font. The source versions, SHA-256 checksums, and individual license paths
are recorded in `public/data/HANDWRITING-ATTRIBUTION.json`.

Offline regeneration (not part of the production build):

```sh
node --experimental-strip-types scripts/generate-handwriting-data.ts
node --experimental-strip-types scripts/render-handwriting-contact-sheet.ts /tmp/ink-hour-font-studies
```

`scripts/fetch-handwriting-fonts.ts` is an opt-in source update command; it
downloads the upstream source fonts/licenses again and overwrites those named
assets. Review changes and regenerate the stroke data after an intentional update.

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
- These are 22 curated styles, not arbitrary font imports. The original two
  use historical ordered centerlines; the added 20 approximate font shapes and
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
  room, time, pace, and volume preferences persist, but text and ink do not.
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
