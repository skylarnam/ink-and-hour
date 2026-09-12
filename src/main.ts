import './style.css';
import { RitualAudio } from './audio.ts';
import { createSoundStartup, soundPresentation } from './sound-startup.ts';
import { createEditorZoom } from './editor-zoom.ts';
import { createQuietView } from './quiet-view.ts';
import { PageHistory } from './page-history.ts';
import { DeskScene } from './scene.ts';
import { inkColor, inkLabel, isInkColor } from './ink.ts';
import { LOFI_TRACKS } from './music-library.ts';
import { RecordedMusic } from './recorded-music.ts';
import { handwritingStyle, isHandwritingId } from './handwriting.ts';
import { loadSettings, sanitizeSettings, saveSettings } from './settings.ts';
import { PaperSurface } from './textures.ts';
import { icon, renderUI } from './ui.ts';
import { writingSoundDescriptor } from './writing-sounds.ts';
import { PAGE } from './types.ts';
import type { CameraPreset, InteractionCue, LayoutOptions, PenSample, Settings, WritingStatus } from './types.ts';
import { layoutPages, MAX_CHARACTERS, MAX_PAGES, WritingBook } from './writing/index.ts';

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing interface element: ${selector}`);
  return found;
}

element<HTMLDivElement>('#app').innerHTML = renderUI();
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function notify(message: string): void {
  const notice = element<HTMLDivElement>('#notice');
  element<HTMLSpanElement>('#notice span').textContent = message;
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 7500);
}

let settings = loadSettings(notify);
const audio = new RitualAudio(notify);
audio.configure(settings);
const recordedMusic = new RecordedMusic(LOFI_TRACKS, settings.lofiTrack, {
  connect: (media) => audio.connectRecording(media),
  onChange: updateMusicUI,
  onEnded: () => skipMusic(1),
  onError: notify,
});
const textarea = element<HTMLTextAreaElement>('#message');
const editorZoom = createEditorZoom(textarea, {
  smaller: element<HTMLButtonElement>('#smaller-editor-text'),
  larger: element<HTMLButtonElement>('#larger-editor-text'),
  hint: element<HTMLElement>('#editor-size-hint'),
  initialScale: settings.textScale,
  onChange: (textScale) => updateLettering({ textScale }, false),
});
const beginButton = element<HTMLButtonElement>('#begin-writing');
const styleSelect = element<HTMLSelectElement>('#style');
const paper = new PaperSurface();
paper.setPaper(settings.paper);
let layout = layoutPages(textarea.value, letteringOptions());
let engine = layout.ok ? new WritingBook(layout, settings) : null;
const pageHistory = new PageHistory(MAX_PAGES);
let viewedPage = 0;
let loadingPage = false;
let pageRevision = 0;
let reducedMotionEnabled = false;
let scene: DeskScene | null = null;
let rollOpen = false;
let capped = settings.pen === 'fountain';
let lastStatus: WritingStatus = 'idle';
let disposed = false;
let lastTimestamp = 0;
let lastInkTimestamp: number | undefined;
let elapsed = 0;
let animationId = 0;
let disposeMotionPreference = (): void => {};

function letteringOptions(next = settings): LayoutOptions {
  return { ...PAGE, style: next.style, textScale: next.textScale, textAlignment: next.textAlignment };
}

function currentPen(): PenSample {
  return engine?.peek() ?? {
    x: 0, y: 0, contact: false, lift: 0.42, pressure: 0, speed: 0, angle: 0, progress: 0, status: 'idle',
  };
}

function viewingEarlierPage(): boolean {
  return !!engine && viewedPage !== engine.activePageIndex;
}

function resetPageHistory(): void {
  pageRevision++;
  loadingPage = false;
  viewedPage = 0;
  pageHistory.clear();
  scene?.setPageTurn(null);
}

function syncPageControls(): void {
  const status = engine?.status ?? 'idle';
  const count = status === 'idle' ? Math.max(1, layout.pages.length) : engine!.pageCount;
  const turning = engine?.turnProgress != null;
  const canBrowse = (status === 'paused' || status === 'complete') && !loadingPage && !turning;
  element<HTMLElement>('#page-controls').hidden = count <= 1;
  element<HTMLElement>('#page-controls').setAttribute('aria-busy', String(loadingPage));
  element<HTMLElement>('#page-position').textContent = `Page ${viewedPage + 1} of ${count}`;
  element<HTMLButtonElement>('#previous-page').disabled = !canBrowse || !pageHistory.has(viewedPage - 1);
  element<HTMLButtonElement>('#next-page').disabled = !canBrowse || !engine
    || viewedPage >= engine.activePageIndex || !pageHistory.has(viewedPage + 1);
  const quietPage = element<HTMLElement>('#quiet-page');
  quietPage.hidden = count <= 1;
  quietPage.textContent = `${viewedPage + 1} / ${count}`;
}

async function showPage(index: number): Promise<void> {
  if (!engine || loadingPage || index === viewedPage) return;
  if (engine.status === 'writing' || engine.turnProgress !== null) {
    notify('Pause the pen after the page turn to look through the written pages.');
    return;
  }
  if (viewedPage === engine.activePageIndex) pageHistory.set(viewedPage, paper.snapshot());
  const snapshot = pageHistory.get(index);
  if (!snapshot) { notify('That page has not been written yet.'); return; }
  const revision = ++pageRevision;
  loadingPage = true;
  syncWriting();
  try {
    const restored = await paper.restore(snapshot);
    if (!restored || disposed || revision !== pageRevision) return;
    viewedPage = index;
    scene?.setPaperFinish(snapshot.paper);
  } catch (error) {
    if (!disposed && revision === pageRevision) {
      notify(`The saved page could not be opened. ${error instanceof Error ? error.message : ''}`);
    }
  } finally {
    if (!disposed && revision === pageRevision) {
      loadingPage = false;
      syncWriting();
    }
  }
}

function playMaterialCue(cue: InteractionCue): void {
  soundStartup.afterActivation(() => audio.cue(cue));
}

const rooms = {
  study: { name: 'Rainy Study', description: 'Walnut, lamplight, and nowhere else to be.' },
  atelier: { name: 'Sunlit Atelier', description: 'Open windows. A softer kind of afternoon.' },
  storybook: { name: 'Storybook Nook', description: 'A little wonder, tucked between the pages.' },
};

function musicRequested(): boolean {
  return settings.musicTrack === 'lofi' ? recordedMusic.state.requested
    : (settings.musicTrack === 'felt' || settings.musicTrack === 'glass') && !audio.diagnostics.musicPaused;
}

function updateMusicUI(): void {
  const state = recordedMusic.state;
  const synth = settings.musicTrack === 'felt' || settings.musicTrack === 'glass';
  const requested = musicRequested();
  const title = synth ? settings.musicTrack === 'felt' ? 'Felt notes' : 'Glass garden' : state.track.title;
  const detail = !requested ? synth ? 'Original soundscape / paused' : `${state.track.artist} / paused`
    : !audio.enabled ? 'Paused with sound'
    : settings.musicVolume === 0 || settings.masterVolume === 0 ? 'Music volume is zero'
    : audio.diagnostics.contextState !== 'running' ? 'Ready for your first interaction'
    : state.loading && !synth ? 'Loading record...'
    : document.hidden ? 'Paused in the background'
    : synth ? 'Original soundscape' : state.track.artist;
  element<HTMLElement>('#music-title').textContent = title;
  element<HTMLElement>('#music-detail').textContent = detail;
  element<HTMLButtonElement>('#music-credits').title = `${title} / ${detail}. Music details and credits.`;
  const button = element<HTMLButtonElement>('#music-play');
  const label = requested ? 'Pause music' : 'Play music';
  button.innerHTML = icon(requested ? 'pause' : 'play');
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(requested));
  button.title = label;
}

function syncMusicAvailability(): void {
  recordedMusic.setAvailable(settings.musicTrack === 'lofi' && audio.enabled
    && audio.diagnostics.contextState === 'running' && !document.hidden
    && settings.masterVolume > 0 && settings.musicVolume > 0);
  updateMusicUI();
}

async function startRecordedMusic(): Promise<void> {
  updateSettings({ ...settings, musicTrack: 'lofi' });
  recordedMusic.play();
  await audio.enable();
  if (!disposed) updateAudioButtons();
}

async function toggleMusic(): Promise<void> {
  if (musicRequested()) {
    if (settings.musicTrack === 'lofi') recordedMusic.pause();
    else audio.pauseMusic();
    updateMusicUI();
    return;
  }
  if (settings.musicTrack === 'felt' || settings.musicTrack === 'glass') {
    audio.resumeMusic();
    await audio.enable();
    if (!disposed) updateAudioButtons();
  } else await startRecordedMusic();
}

function skipMusic(direction: -1 | 1): void {
  const requested = musicRequested();
  updateSettings({ ...settings, musicTrack: 'lofi', lofiTrack: recordedMusic.adjacent(direction).id });
  if (requested) recordedMusic.play();
  syncMusicAvailability();
}

function updateAudioButtons(): void {
  const enabled = audio.enabled;
  const presentation = soundPresentation(enabled, audio.diagnostics.contextState === 'running');
  const top = element<HTMLButtonElement>('#enable-sound');
  top.setAttribute('aria-pressed', String(enabled));
  top.dataset.soundState = presentation.state;
  top.title = presentation.action;
  top.setAttribute('aria-label', `${presentation.label}. ${presentation.action}.`);
  element<HTMLSpanElement>('#enable-sound span').textContent = presentation.label;
  element<HTMLSpanElement>('#panel-enable-sound span').textContent = presentation.panelLabel;
  element<HTMLButtonElement>('#panel-enable-sound').setAttribute('aria-pressed', String(enabled));
  element<HTMLParagraphElement>('#sound-note').textContent = presentation.note;
  const quietSound = element<HTMLButtonElement>('#quiet-sound');
  quietSound.setAttribute('aria-pressed', String(enabled));
  quietSound.setAttribute('aria-label', `${presentation.label}. ${presentation.action}.`);
  quietSound.title = presentation.action;
  syncMusicAvailability();
}

async function toggleSound(): Promise<void> {
  const buttons = ['#enable-sound', '#panel-enable-sound', '#quiet-sound'].map((selector) => element<HTMLButtonElement>(selector));
  buttons.forEach((button) => { button.disabled = true; });
  if (audio.enabled) {
    recordedMusic.setAvailable(false);
    await audio.disable();
  }
  else await audio.enable();
  if (disposed) return;
  buttons.forEach((button) => { button.disabled = false; });
  updateAudioButtons();
}

function syncSettings(): void {
  const sound = writingSoundDescriptor(settings.writingSound);
  element<HTMLElement>('#writing-sound-description').textContent = sound.description;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-setting]')) {
    const key = button.dataset.setting as keyof Settings;
    button.setAttribute('aria-pressed', String(settings[key] === button.dataset.value));
  }
  for (const input of document.querySelectorAll<HTMLInputElement>('[data-range]')) {
    const key = input.dataset.range as keyof Settings;
    input.value = String(settings[key]);
    const output = document.querySelector<HTMLOutputElement>(`[data-output="${key}"]`);
    if (output) output.value = `${Math.round(Number(settings[key]) * 100)}%`;
  }
  styleSelect.value = settings.style;
  const handwriting = handwritingStyle(settings.style);
  styleSelect.title = handwriting.notes;
  textarea.dataset.handwriting = settings.style;
  textarea.style.setProperty('--editor-font', JSON.stringify(handwriting.family));
  textarea.style.setProperty('--editor-size', `${handwriting.editorSize}px`);
  textarea.style.setProperty('--editor-line-height', `${Math.max(27, handwriting.editorSize * 1.5)}px`);
  textarea.style.textAlign = settings.textAlignment;
  editorZoom.setScale(settings.textScale);
  const handwritingNote = element<HTMLElement>('#handwriting-note');
  handwritingNote.hidden = settings.style === 'correspondence';
  handwritingNote.textContent = settings.style === 'italianno'
    ? 'An interpreted stroke study. A serif fallback keeps its blank source underscores visible.'
    : 'A font-inspired stroke study, with an interpreted pen order.';
  element<HTMLOutputElement>('#speed-label').value = `${settings.speed.toFixed(1).replace('.0', '')}x`;
  const hours = Math.floor(settings.time) % 24;
  const minutes = Math.round((settings.time % 1) * 60);
  element<HTMLOutputElement>('#time-label').value = `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`;
  element<HTMLElement>('#ink-name').textContent = inkLabel(settings);
  element<HTMLInputElement>('#custom-ink-color').value = settings.customInk;
  element<HTMLOutputElement>('#custom-ink-value').value = settings.customInk.toUpperCase();
  element<HTMLElement>('#custom-ink-controls').hidden = settings.ink !== 'custom';
  element<HTMLElement>('#room-title').textContent = rooms[settings.mood].name;
  element<HTMLElement>('#room-description').textContent = rooms[settings.mood].description;
  const capButton = element<HTMLButtonElement>('#toggle-cap');
  capButton.hidden = settings.pen === 'dip';
  capButton.textContent = capped ? 'Uncap pen' : 'Replace cap';
  capButton.setAttribute('aria-pressed', String(capped));
  document.documentElement.dataset.mood = settings.mood;
  syncMusicAvailability();
}

function updateSettings(next: unknown): void {
  const previous = settings;
  settings = sanitizeSettings(next);
  if (settings.musicTrack !== 'lofi') recordedMusic.pause();
  recordedMusic.select(settings.lofiTrack);
  if (previous.pen !== settings.pen) {
    capped = settings.pen === 'fountain' && (engine?.status ?? 'idle') === 'idle';
    scene?.setCapped(capped);
    playMaterialCue('cap');
  }
  if (previous.paper !== settings.paper) { paper.setPaper(settings.paper); playMaterialCue('paper'); }
  if (previous.ink !== settings.ink) playMaterialCue('ink');
  if (previous.nib !== settings.nib) playMaterialCue('cap');
  scene?.configure(settings);
  scene?.setPaperFinish(paper.kind);
  audio.configure(settings);
  engine?.updateOptions(settings);
  if (previous.writingSound !== settings.writingSound) audio.updateContact(currentPen());
  saveSettings(settings, notify);
  syncSettings();
}

function validateDraft(): void {
  layout = layoutPages(textarea.value, letteringOptions());
  const error = element<HTMLParagraphElement>('#input-error');
  error.textContent = layout.error;
  error.hidden = layout.ok;
  textarea.setAttribute('aria-invalid', String(!layout.ok));
  element<HTMLElement>('#character-count').textContent = `${textarea.value.length.toLocaleString()} characters`;
  element<HTMLElement>('#character-count').title = `Up to ${MAX_CHARACTERS.toLocaleString()} characters and ${MAX_PAGES} physical pages.`;
  beginButton.disabled = !scene || !layout.ok;
  element<HTMLButtonElement>('#quiet-play').disabled = beginButton.disabled;
  syncPageControls();
}

function syncWriting(): void {
  const status = engine?.status ?? 'idle';
  const active = status === 'writing';
  const paused = status === 'paused';
  const complete = status === 'complete';
  const earlier = viewingEarlierPage();
  const turning = engine?.turnProgress != null;
  const letteringLocked = active || loadingPage || earlier;
  beginButton.disabled = !scene || loadingPage || (!active && !paused && !layout.ok);
  const buttonIcon = active ? 'pause' : complete ? 'reset' : 'play';
  const label = active ? 'Pause for a moment' : paused ? 'Resume writing' : complete ? 'Write it again' : 'Begin writing';
  beginButton.innerHTML = `${icon(buttonIcon)}<span>${label}</span>${icon('arrow', 'begin-arrow')}`;
  const quietPlay = element<HTMLButtonElement>('#quiet-play');
  quietPlay.innerHTML = `${icon(buttonIcon)}<span>${active ? 'Pause' : paused ? 'Resume' : complete ? 'Replay' : 'Write'}</span>`;
  quietPlay.setAttribute('aria-label', label);
  quietPlay.disabled = beginButton.disabled;
  textarea.readOnly = active || paused || loadingPage || earlier;
  styleSelect.disabled = letteringLocked;
  editorZoom.setEnabled(!letteringLocked);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-setting="textAlignment"]')) {
    button.disabled = letteringLocked;
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-setting]')) {
    if (['pen', 'nib', 'paper', 'ink'].includes(button.dataset.setting ?? '')) button.disabled = loadingPage || earlier;
  }
  element<HTMLInputElement>('#custom-ink-color').disabled = loadingPage || earlier;
  element<HTMLInputElement>('[data-range="speed"]').disabled = loadingPage || earlier;
  element<HTMLButtonElement>('#export-sheet').hidden = loadingPage || (!complete && !earlier);
  element<HTMLElement>('#scene-status').textContent = earlier ? 'A page, kept.' : turning ? 'Making room for more words.'
    : active ? 'One stroke at a time.' : paused ? 'A moment of stillness.' : complete ? 'Relax, and sit in your quiet corner.' : 'Take your time.';
  element<HTMLElement>('#writing-note').textContent = earlier ? `Resume returns to page ${engine!.activePageIndex + 1}.`
    : turning ? paused ? 'The page turn is paused.' : 'Turning to the next sheet.'
      : active ? 'The page is yours. Let it unfold.' : paused ? 'Your place is safe.' : complete ? 'Keep a page, or begin again.' : 'No hurry. No right words.';
  element<HTMLButtonElement>('#toggle-cap').disabled = active || turning || loadingPage || earlier;
  syncPageControls();
  lastStatus = status;
}

function newSheet({ announce = true, sound = true }: { announce?: boolean; sound?: boolean } = {}): void {
  audio.updateContact({ contact: false, speed: 0, pressure: 0 });
  resetPageHistory();
  paper.clear();
  paper.setPaper(settings.paper);
  scene?.setPaperFinish(settings.paper);
  validateDraft();
  engine = layout.ok ? new WritingBook(layout, settings) : null;
  engine?.setReducedMotion(reducedMotionEnabled);
  capped = settings.pen === 'fountain';
  scene?.setCapped(capped);
  if (sound) playMaterialCue('paper');
  syncSettings();
  syncWriting();
  if (announce) notify('Fresh pages. Your words are still here if you want them.');
}

function handleInteraction(action: 'roll' | 'cap' | 'ink'): void {
  if (action === 'roll') {
    rollOpen = !rollOpen;
    scene?.setRoll(rollOpen);
    playMaterialCue('leather');
    element<HTMLButtonElement>('#toggle-roll').setAttribute('aria-pressed', String(rollOpen));
    element<HTMLSpanElement>('#toggle-roll span').textContent = rollOpen ? 'Tie leather roll' : 'Untie leather roll';
  } else if (action === 'cap' && settings.pen === 'fountain') {
    if (engine?.status === 'writing' || engine?.turnProgress != null || loadingPage || viewingEarlierPage()) {
      notify('Pause on the current page, after any page turn, before replacing the cap.');
      return;
    }
    capped = !capped;
    scene?.setCapped(capped);
    playMaterialCue('cap');
    syncSettings();
  } else if (action === 'ink') {
    playMaterialCue('ink');
    notify(`${inkLabel(settings)}. A little glass, a little ink.`);
  }
}

try {
  scene = new DeskScene(element<HTMLCanvasElement>('#desk-canvas'), paper, settings, handleInteraction, () => audio.thunder());
  scene.setCapped(capped);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotionEnabled = reducedMotion.matches;
  scene.setReducedMotion(reducedMotion.matches);
  paper.setReducedMotion(reducedMotion.matches);
  engine?.setReducedMotion(reducedMotion.matches);
  const motionChanged = (event: MediaQueryListEvent): void => {
    reducedMotionEnabled = event.matches;
    scene?.setReducedMotion(event.matches);
    paper.setReducedMotion(event.matches);
    engine?.setReducedMotion(event.matches);
  };
  reducedMotion.addEventListener('change', motionChanged);
  disposeMotionPreference = () => reducedMotion.removeEventListener('change', motionChanged);
  scene.updatePen(currentPen());
  scene.update(0, 0);
  element<HTMLDivElement>('#scene-loading').hidden = true;
} catch (error) {
  element<HTMLDivElement>('#scene-loading').hidden = true;
  const message = element<HTMLDivElement>('#scene-error');
  message.hidden = false;
  message.textContent = `This little room needs WebGL 2. Try a recent browser with hardware acceleration enabled. ${error instanceof Error ? error.message : ''}`;
  console.error('Ink & Hour could not render the desk:', error);
}

const quietView = createQuietView({
  document, root: document.documentElement, viewport: window,
  enter: element<HTMLButtonElement>('#enter-quiet-view'),
  exit: element<HTMLButtonElement>('#exit-quiet-view'),
  toolbar: element<HTMLElement>('#quiet-toolbar'),
  chrome: ['.site-header', '.ritual-panel', '.site-footer', '.stage-heading', '.camera-controls', '.stage-bottom', '#enter-quiet-view']
    .map((selector) => element<HTMLElement>(selector)),
  onEnter: () => scene?.holdCamera(),
});
element<HTMLButtonElement>('#quiet-play').addEventListener('click', () => beginButton.click());
element<HTMLButtonElement>('#quiet-sound').addEventListener('click', () => { void toggleSound(); });

beginButton.addEventListener('click', async () => {
  if (loadingPage) return;
  if (engine?.status === 'paused' && viewingEarlierPage()) {
    const resumingBook = engine;
    await showPage(resumingBook.activePageIndex);
    if (disposed || engine !== resumingBook || loadingPage || viewingEarlierPage()) return;
  }
  if (engine?.status === 'writing') {
    engine.pause();
    audio.updateContact(engine.peek());
  } else if (engine?.status === 'paused') {
    if (capped) { capped = false; scene?.setCapped(false); playMaterialCue('cap'); }
    engine.resume();
  } else {
    validateDraft();
    if (!layout.ok) return;
    resetPageHistory();
    paper.clear();
    paper.setPaper(settings.paper);
    scene?.setPaperFinish(settings.paper);
    engine = new WritingBook(layout, settings);
    engine.setReducedMotion(reducedMotionEnabled);
    if (capped) { capped = false; scene?.setCapped(false); playMaterialCue('cap'); }
    if (settings.pen === 'dip') playMaterialCue('ink');
    engine.start();
  }
  syncSettings();
  syncWriting();
});

textarea.addEventListener('input', () => {
  if (engine?.status === 'complete') {
    resetPageHistory();
    engine = null;
    paper.clear();
    paper.setPaper(settings.paper);
    scene?.setPaperFinish(settings.paper);
  }
  validateDraft();
  syncWriting();
});

function updateLettering(change: Partial<Pick<Settings, 'style' | 'textScale' | 'textAlignment'>>, announce = true): boolean {
  const next = sanitizeSettings({ ...settings, ...change });
  if (next.style === settings.style && next.textScale === settings.textScale
    && next.textAlignment === settings.textAlignment) return true;
  if (engine?.status === 'writing' || loadingPage || viewingEarlierPage()) {
    notify('Pause on the current page before changing the lettering.');
    syncSettings();
    return false;
  }
  if (engine?.status === 'paused') {
    const revised = engine.reflow(letteringOptions(next));
    if (!revised.ok) {
      notify(`Your ink is unchanged. ${revised.error}`);
      syncSettings();
      return false;
    }
    const alignmentChanged = next.textAlignment !== settings.textAlignment;
    layout = revised;
    updateSettings(next);
    syncWriting();
    if (announce) notify(alignmentChanged
      ? 'Lines with ink keep their place. New lines and pages use your chosen alignment.'
      : 'Written pages and the current letter keep their shape. The remaining words use your new lettering.');
    return true;
  }
  updateSettings(next);
  newSheet({ announce: false, sound: false });
  return true;
}

styleSelect.addEventListener('change', () => {
  const style = styleSelect.value;
  if (!isHandwritingId(style)) {
    notify('Choose one of the available handwriting styles.');
    syncSettings();
    return;
  }
  updateLettering({ style });
});

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-setting]')) {
  button.addEventListener('click', () => {
    const key = button.dataset.setting;
    if (key === 'textAlignment') {
      const textAlignment = button.dataset.value;
      if (textAlignment === 'left' || textAlignment === 'center') updateLettering({ textAlignment });
      else notify('Choose left or center alignment.');
    } else if (key === 'musicTrack' && button.dataset.value === 'lofi') void startRecordedMusic();
    else if (key) updateSettings({ ...settings, [key]: button.dataset.value });
  });
}
for (const input of document.querySelectorAll<HTMLInputElement>('[data-range]')) {
  input.addEventListener('input', () => {
    const key = input.dataset.range;
    if (key) updateSettings({ ...settings, [key]: input.valueAsNumber });
  });
}

const colorPicker = element<HTMLInputElement>('#custom-ink-color');
element<HTMLButtonElement>('#custom-ink-swatch').addEventListener('click', () => colorPicker.click());
colorPicker.addEventListener('input', () => {
  const color = colorPicker.value;
  if (!isInkColor(color)) { notify('Choose a six-digit hex ink color.'); return; }
  updateSettings({ ...settings, ink: 'custom', customInk: color.toLowerCase() });
});

function setTab(id: string): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
    const selected = tab.dataset.tab === id;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    element<HTMLElement>(`#panel-${tab.dataset.tab}`).hidden = !selected;
  }
}
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-tab]')];
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => setTab(tab.dataset.tab ?? 'tools'));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[target].focus();
    setTab(tabs[target].dataset.tab ?? 'tools');
  });
});

function camera(preset: CameraPreset): void {
  scene?.setCamera(preset);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-camera]')) {
    const active = button.dataset.camera === preset;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}
const moveViewButton = element<HTMLButtonElement>('#move-view');
moveViewButton.addEventListener('click', () => {
  const moving = moveViewButton.getAttribute('aria-pressed') !== 'true';
  scene?.setDragMode(moving ? 'pan' : 'orbit');
  moveViewButton.setAttribute('aria-pressed', String(moving));
  moveViewButton.classList.toggle('active', moving);
  element<HTMLElement>('#camera-drag-hint').textContent = moving
    ? 'Drag to move across the desk'
    : 'Drag to rotate / Shift-drag to move';
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-camera]')) {
  button.addEventListener('click', () => {
    const preset = button.dataset.camera;
    if (preset === 'desk' || preset === 'detail' || preset === 'overhead') camera(preset);
  });
}
element<HTMLButtonElement>('#reset-view').addEventListener('click', () => camera('desk'));
element<HTMLButtonElement>('#new-sheet').addEventListener('click', () => newSheet());
element<HTMLButtonElement>('#export-sheet').addEventListener('click', () => {
  paper.exportPNG(engine && engine.pageCount > 1 ? `ink-and-hour-page-${viewedPage + 1}.png` : 'ink-and-hour.png');
});
element<HTMLButtonElement>('#previous-page').addEventListener('click', () => { void showPage(viewedPage - 1); });
element<HTMLButtonElement>('#next-page').addEventListener('click', () => { void showPage(viewedPage + 1); });
element<HTMLButtonElement>('#toggle-roll').addEventListener('click', () => handleInteraction('roll'));
element<HTMLButtonElement>('#toggle-cap').addEventListener('click', () => handleInteraction('cap'));
element<HTMLButtonElement>('#enable-sound').addEventListener('click', () => { void toggleSound(); });
element<HTMLButtonElement>('#panel-enable-sound').addEventListener('click', () => { void toggleSound(); });
element<HTMLButtonElement>('#music-play').addEventListener('click', () => { void toggleMusic(); });
element<HTMLButtonElement>('#music-previous').addEventListener('click', () => skipMusic(-1));
element<HTMLButtonElement>('#music-next').addEventListener('click', () => skipMusic(1));
const soundStartup = createSoundStartup(document, {
  enabled: () => audio.enabled,
  running: () => audio.diagnostics.contextState === 'running',
  musicRequested,
  enable: () => audio.enable(),
  onSettled: updateAudioButtons,
});
element<HTMLButtonElement>('#dismiss-notice').addEventListener('click', () => { element<HTMLDivElement>('#notice').hidden = true; });
const dialog = element<HTMLDialogElement>('#about-dialog');
element<HTMLButtonElement>('#about-button').addEventListener('click', () => { dialog.showModal(); dialog.scrollTop = 0; });
element<HTMLButtonElement>('#music-credits').addEventListener('click', () => {
  dialog.showModal();
  element<HTMLElement>('#music-attribution').scrollIntoView({ block: 'start' });
});
element<HTMLButtonElement>('#close-about').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
function visibilityChanged(): void {
  if (document.hidden) recordedMusic.setAvailable(false);
  if (document.hidden && engine?.status === 'writing') { engine.pause(); syncWriting(); }
  lastTimestamp = 0;
  void audio.setHidden(document.hidden).then(() => { if (!disposed) updateAudioButtons(); });
}
document.addEventListener('visibilitychange', visibilityChanged);
element<HTMLCanvasElement>('#desk-canvas').addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  engine?.pause();
  audio.updateContact(currentPen());
  syncWriting();
  notify('The graphics context was interrupted. Reload the page to restore the room.');
});
element<HTMLCanvasElement>('#desk-canvas').addEventListener('keydown', (event) => {
  if (event.key === 'Home') { event.preventDefault(); camera('desk'); }
  else if (scene?.adjustCamera(event.key, event.shiftKey)) event.preventDefault();
});

function frame(timestamp: number): void {
  if (disposed) return;
  const delta = lastTimestamp ? Math.min(0.06, (timestamp - lastTimestamp) / 1000) : 0;
  lastTimestamp = timestamp;
  if (!document.hidden && scene) {
    elapsed += delta;
    // Ink still dries while the tab is hidden; age old marks before adding a new frame.
    paper.flush(lastInkTimestamp === undefined ? 0 : Math.max(0, (timestamp - lastInkTimestamp) / 1000));
    lastInkTimestamp = timestamp;
    const wasTurning = engine?.turnProgress != null;
    const result = engine?.tick(delta) ?? { pen: currentPen(), segments: [], pageChanged: false, previousPageIndex: null };
    if (result.pageChanged && engine) {
      if (result.previousPageIndex !== null) pageHistory.set(result.previousPageIndex, paper.snapshot());
      paper.clear();
      paper.setPaper(settings.paper);
      scene.setPaperFinish(settings.paper);
      viewedPage = engine.activePageIndex;
      playMaterialCue('paper');
    }
    paper.draw(result.segments, inkColor(settings));
    paper.flush();
    if (engine?.status === 'complete' && lastStatus !== 'complete') {
      pageHistory.set(engine.activePageIndex, paper.snapshot());
    }
    scene.setPageTurn(engine?.turnProgress ?? null);
    const shownPen: PenSample = loadingPage || viewingEarlierPage()
      ? { ...result.pen, status: 'idle', contact: false, pressure: 0, speed: 0, lift: 0.42 } : result.pen;
    scene.updatePen(shownPen, delta);
    audio.updateContact(shownPen);
    scene.update(delta, elapsed);
    audio.updateSpatial(scene.soundPlacement);
    if (result.pen.status !== lastStatus || result.pageChanged || wasTurning !== (engine?.turnProgress != null)) syncWriting();
  }
  animationId = requestAnimationFrame(frame);
}

if (settings.musicTrack === 'lofi') recordedMusic.play();
syncSettings();
validateDraft();
syncWriting();
updateAudioButtons();
animationId = requestAnimationFrame(frame);

if (import.meta.env.DEV) {
  Object.defineProperty(window, '__inkAndHour', {
    configurable: true,
    get: () => ({
      scene: scene?.diagnostics ?? null, writing: {
        ...currentPen(), strokeCount: engine?.pages[engine.activePageIndex]?.layout.strokes.length ?? 0,
        pageCount: (engine?.status ?? 'idle') === 'idle' ? layout.pages.length : engine?.pageCount ?? 0,
        activePageIndex: engine?.activePageIndex ?? 0, viewedPage, turnProgress: engine?.turnProgress ?? null,
        savedPages: pageHistory.size, loadingPage,
      },
      audio: audio.diagnostics, settings: { ...settings }, validInput: layout.ok, inputError: layout.error,
      music: recordedMusic.state,
      editor: { zoom: editorZoom.scale, alignment: settings.textAlignment },
      quietView: quietView.active,
      paper: paper.diagnostics,
    }),
  });
}

function dispose(): void {
  if (disposed) return;
  disposed = true;
  pageRevision++;
  cancelAnimationFrame(animationId);
  clearTimeout(noticeTimer);
  soundStartup.dispose();
  quietView.dispose();
  disposeMotionPreference();
  document.removeEventListener('visibilitychange', visibilityChanged);
  editorZoom.dispose();
  recordedMusic.dispose();
  audio.dispose();
  scene?.dispose();
  paper.dispose();
}
window.addEventListener('pagehide', (event) => { if (!event.persisted) dispose(); });
if (import.meta.hot) import.meta.hot.dispose(dispose);
