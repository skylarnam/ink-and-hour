export const icons = {
  nib: '<path d="m12 2-7 13 7 7 7-7-7-13Z"/><path d="M12 3v11"/><circle cx="12" cy="15" r="1.7"/>',
  sound: '<path d="M4 14v-4h4l5-4v12l-5-4H4Z"/><path d="M17 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14"/>',
  room: '<path d="M3 21V4h18v17M3 13h18M12 4v17M2 21h20"/>',
  tools: '<path d="m5 19 2-6L17 3l4 4-10 10-6 2Zm2-6 4 4M15 5l4 4M3 22h18"/>',
  play: '<path d="m9 5 10 7-10 7V5Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  reset: '<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/>',
  freshSheet: '<path d="M13 2H5v20h14V8l-6-6Zm0 0v6h6"/><path d="M9 15h6m-3-3v6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4"/>',
  chevron: '<path d="m8 5 7 7-7 7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  rain: '<path d="M6 14a4 4 0 1 1 1-8 6 6 0 0 1 11 2 3 3 0 0 1 0 6M7 17l-1 3m6-3-1 3m6-3-1 3"/>',
  storm: '<path d="M6 14a4 4 0 1 1 1-8 6 6 0 0 1 11 2 3 3 0 0 1 0 6m-6-2-3 5h4l-3 5"/>',
  orbit: '<ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(-30 12 12)"/><circle cx="12" cy="12" r="2"/>',
  move: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3"/>',
  roll: '<path d="M4 5h15v14H4M4 5c-4 0-4 14 0 14s4-14 0-14Zm7 0v14m3-9 4 4m-4 0 4-4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
};

export function icon(name: keyof typeof icons, className = ''): string {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}

function choice(setting: string, value: string, label: string, extra = ''): string {
  return `<button type="button" class="choice ${extra}" data-setting="${setting}" data-value="${value}" aria-pressed="false">${label}</button>`;
}

function volume(key: string, label: string, hint: string): string {
  return `<label class="volume-control"><span>${label}<output data-output="${key}"></output></span><input type="range" data-range="${key}" min="0" max="1" step="0.01" aria-label="${label} volume"><small>${hint}</small></label>`;
}

export function renderUI(): string {
  return `
    <header class="site-header">
      <a class="brand" href="./" aria-label="Ink and Hour home">
        <span class="brand-mark">${icon('nib')}</span>
        <span><span class="brand-name">Ink <i>&amp;</i> Hour</span><span class="brand-note">A WRITING RITUAL</span></span>
      </a>
      <p class="header-thought">For the pleasure of putting pen to paper.</p>
      <button class="sound-toggle" id="enable-sound" type="button" aria-pressed="true" title="Mute sound">${icon('sound')}<span>Sound is on</span><span class="sound-dot"></span></button>
    </header>
    <main class="workspace">
      <section class="stage" aria-label="Interactive three-dimensional writing desk">
        <canvas id="desk-canvas" tabindex="0" aria-label="Writing desk. Drag to rotate, or enable Move and drag to pan. Shift-drag, right-drag, or two-finger drag also pans. Arrow keys rotate; Shift and arrow keys pan. Scroll, pinch, or plus and minus zoom. Home resets the camera."></canvas>
        <div class="stage-heading"><span class="eyebrow">YOUR QUIET CORNER</span><h1 id="room-title">Rainy Study</h1><p id="room-description">Walnut, lamplight, and nowhere else to be.</p></div>
        <div class="camera-controls" role="group" aria-label="Camera views and movement">
          <button type="button" data-camera="desk" class="active" aria-pressed="true">Desk</button>
          <button type="button" data-camera="detail" aria-pressed="false">Nib close-up</button>
          <button type="button" data-camera="overhead" aria-pressed="false">Overhead</button>
          <button type="button" id="move-view" class="drag-mode" aria-label="Move view by dragging" aria-pressed="false" title="Turn on to drag across the desk. Turn off to rotate. Shift-drag also moves.">${icon('move')}Move</button>
        </div>
        <div class="stage-bottom">
          <div class="ritual-status"><span class="status-light"></span><span id="scene-status">Take your time.</span></div>
          <span class="camera-hint">${icon('orbit')}<span id="camera-drag-hint">Drag to rotate / Shift-drag to move</span><span class="hint-dot">/</span>Scroll to zoom</span>
          <button type="button" id="reset-view" class="stage-icon" aria-label="Reset camera to the desk" title="Reset camera">${icon('reset')}</button>
        </div>
        <div class="scene-loading" id="scene-loading"><span class="loading-nib">${icon('nib')}</span><p>Making a little room for you...</p></div>
        <div class="scene-error" id="scene-error" hidden role="alert"></div>
      </section>
      <aside class="ritual-panel" aria-label="Your writing ritual">
        <div class="panel-tabs" role="tablist" aria-label="Ritual settings">
          <button id="tab-tools" type="button" role="tab" aria-controls="panel-tools" aria-selected="true" tabindex="0" data-tab="tools">${icon('tools')}Tools</button>
          <button id="tab-room" type="button" role="tab" aria-controls="panel-room" aria-selected="false" tabindex="-1" data-tab="room">${icon('room')}Room</button>
          <button id="tab-sound" type="button" role="tab" aria-controls="panel-sound" aria-selected="false" tabindex="-1" data-tab="sound">${icon('sound')}Sound</button>
        </div>
        <div class="settings-content">
          <section id="panel-tools" role="tabpanel" aria-labelledby="tab-tools" class="settings-panel">
            <div class="panel-intro"><h2>A few favorite things.</h2><p>Find the combination that feels like you.</p></div>
            <fieldset><legend>THE PEN</legend><div class="choices pen-choices">
              ${choice('pen', 'fountain', '<span class="pen-illustration fountain-illustration"></span><span>Fountain pen<small>Lacquer &amp; brass</small></span>')}
              ${choice('pen', 'dip', '<span class="pen-illustration dip-illustration"></span><span>Dip pen<small>Wood &amp; steel</small></span>')}
            </div></fieldset>
            <fieldset><legend>NIB CHARACTER <span title="Interpretive nib profiles, not interchangeable manufacturer parts.">i</span></legend><div class="choices compact">
              ${choice('nib', 'fine', 'Fine')}${choice('nib', 'broad', 'Broad edge')}${choice('nib', 'flex', 'Soft flex')}
            </div></fieldset>
            <fieldset><legend>THE INK <span id="ink-name">Midnight blue</span></legend><div class="ink-choices">
              <button type="button" class="ink-swatch" style="--ink:#24384d" data-setting="ink" data-value="midnight" aria-label="Midnight blue ink" aria-pressed="false"></button>
              <button type="button" class="ink-swatch" style="--ink:#76503b" data-setting="ink" data-value="sepia" aria-label="Warm sepia ink" aria-pressed="false"></button>
              <button type="button" class="ink-swatch" style="--ink:#793e4b" data-setting="ink" data-value="burgundy" aria-label="Oxblood ink" aria-pressed="false"></button>
              <button type="button" class="ink-swatch" style="--ink:#3f5947" data-setting="ink" data-value="forest" aria-label="Deep moss ink" aria-pressed="false"></button>
              <span class="ink-note">A color to linger in.</span>
            </div></fieldset>
            <fieldset><legend>THE PAPER</legend><div class="choices paper-choices">
              ${choice('paper', 'smooth', '<span class="paper-sample smooth"></span>Smooth')}
              ${choice('paper', 'parchment', '<span class="paper-sample parchment"></span>Parchment')}
              ${choice('paper', 'cotton', '<span class="paper-sample cotton"></span>Cotton')}
            </div></fieldset>
            <div class="tactile-actions"><button type="button" id="toggle-roll" aria-pressed="false">${icon('roll')}<span>Untie leather roll</span></button><button type="button" id="toggle-cap" aria-pressed="true">Uncap pen</button></div>
          </section>
          <section id="panel-room" role="tabpanel" aria-labelledby="tab-room" class="settings-panel" hidden>
            <div class="panel-intro"><h2>A room of your own.</h2><p>Same little ritual. A different kind of day.</p></div>
            <fieldset><legend>THE ATMOSPHERE</legend><div class="mood-choices">
              ${choice('mood', 'study', '<span class="mood-thumbnail study"></span><span>Rainy Study<small>Walnut, brass, warm lamplight</small></span>')}
              ${choice('mood', 'atelier', '<span class="mood-thumbnail atelier"></span><span>Sunlit Atelier<small>Pale wood, ivory, a clear mind</small></span>')}
              ${choice('mood', 'storybook', '<span class="mood-thumbnail storybook"></span><span>Storybook Nook<small>Soft colors, a little wonder</small></span>')}
            </div></fieldset>
            <label class="time-control"><span class="eyebrow">TIME OF DAY <output id="time-label">5:00 PM</output></span><input type="range" id="time" data-range="time" min="0" max="24" step="0.25" aria-label="Time of day"><span class="range-bookends"><span>Midnight</span><span>Noon</span><span>Midnight</span></span></label>
            <fieldset><legend>OUTSIDE THE WINDOW</legend><div class="choices weather-choices">
              ${choice('weather', 'clear', `${icon('sun')}Clear`)}${choice('weather', 'rain', `${icon('rain')}Rain`)}${choice('weather', 'storm', `${icon('storm')}Storm`)}
            </div></fieldset>
            <p class="small-note">Weather is independent of your room and time. Storms bring slow, occasional lightning, never a strobe.</p>
          </section>
          <section id="panel-sound" role="tabpanel" aria-labelledby="tab-sound" class="settings-panel" hidden>
            <div class="panel-intro"><h2>Listen a little closer.</h2><p>Headphones welcome. Music entirely optional.</p></div>
            <button type="button" id="panel-enable-sound" class="audio-gate" aria-pressed="true">${icon('sound')}<span>Sound is on - tap to mute</span></button>
            <div class="volume-controls">
              ${volume('masterVolume', 'Overall volume', 'Keep it gentle.')}
              ${volume('writingVolume', 'Pen & materials', 'Nib friction, paper, cap and leather.')}
              ${volume('ambienceVolume', 'Outside the window', 'Rain and distant thunder. Silent on clear days.')}
              ${volume('musicVolume', 'Background music', 'An original, softly synthesized companion.')}
            </div>
            <fieldset><legend>A LITTLE BACKGROUND</legend><div class="choices compact">
              ${choice('musicTrack', 'off', 'Off')}${choice('musicTrack', 'felt', 'Felt notes')}${choice('musicTrack', 'glass', 'Glass garden')}
            </div></fieldset>
            <p class="small-note" id="sound-note">Sound is ready. Your first click, tap, or keypress starts it.</p>
          </section>
        </div>
        <section class="writing-editor" aria-labelledby="editor-heading">
          <div class="editor-heading"><h2 id="editor-heading">What will you leave here?</h2><div class="editor-zoom" role="group" aria-label="Editor text size"><button id="smaller-editor-text" type="button" aria-label="Smaller editor text" aria-controls="message" title="Smaller editor text">A-</button><button id="larger-editor-text" type="button" aria-label="Larger editor text" aria-controls="message" title="Larger editor text">A+</button></div></div>
          <label class="visually-hidden" for="message">Your English text</label>
          <textarea id="message" spellcheck="false" rows="3" aria-describedby="input-hint editor-size-hint input-error">Let the world wait.
Stay a little while.</textarea>
          <div class="input-meta"><span class="input-guide"><span id="input-hint">English letters &amp; punctuation</span><span id="editor-size-hint">Pinch to resize text</span></span><span id="character-count"></span></div>
          <p id="input-error" class="input-error" role="status" hidden></p>
          <div class="writing-options">
            <label><span>Handwriting</span><select id="style" aria-label="Handwriting style"><option value="correspondence">Correspondence</option><option value="print">Everyday print</option></select></label>
            <label class="pace-control"><span>Pace <output id="speed-label">1x</output></span><input type="range" data-range="speed" min="0.5" max="2" step="0.1" aria-label="Writing pace"></label>
          </div>
          <div class="writing-actions">
            <button type="button" class="begin-button" id="begin-writing">${icon('play')}<span>Begin writing</span>${icon('arrow', 'begin-arrow')}</button>
            <button type="button" class="new-sheet-button" id="new-sheet" title="Start a fresh sheet" aria-label="Start a fresh sheet">${icon('freshSheet')}<span>Fresh sheet</span></button>
          </div>
          <div class="sheet-actions"><span id="writing-note">No hurry. No right words.</span><button type="button" id="export-sheet" hidden>${icon('download')}Keep this page</button></div>
        </section>
      </aside>
    </main>
    <footer class="site-footer"><span>Relax, and sit in your quiet corner.</span><button id="about-button" type="button">About this little world ${icon('info')}</button></footer>
    <div id="notice" class="toast" role="status" hidden><span></span><button id="dismiss-notice" aria-label="Dismiss message">${icon('close')}</button></div>
    <dialog id="about-dialog"><button id="close-about" class="dialog-close" aria-label="Close about">${icon('close')}</button><span class="eyebrow">INK &amp; HOUR / FIRST EDITION</span><h2>Nothing to finish.<br>Just something to feel.</h2><p>A small, local-first writing ritual. Choose your materials, leave a few words on the page, and listen to the space between strokes.</p><p>Drag to rotate, or turn on Move and drag to explore a little across the desk. Shift-drag and right-drag also move; on touchscreens, use two fingers. Scroll or pinch to zoom. With the canvas focused, arrow keys rotate (or pan in Move mode), Shift-arrow keys pan, plus/minus zoom, and Home resets the view. Movement stays gently bounded around your camera preset. In rotation mode, click the leather roll, cap, or ink bottle to handle them.</p><p>This first edition uses real stroke-defined Hershey lettering, not traced font outlines. Nib pressure and sounds are expressive interpretations, not a fluid-dynamics or manufacturer-specific simulation. There is no hand model, arbitrary font import, or physical ink depletion.</p><p>English letters, digits and standard punctuation are supported. Long notes wrap within one finite sheet. Change ink or nib while writing; text and handwriting edits start a fresh page.</p><p class="small-note">All room geometry, textures and synthesized sounds are original. The two original Hershey stroke datasets are public domain. No external fonts, recordings, account, analytics or runtime CDN.</p></dialog>
  `;
}
