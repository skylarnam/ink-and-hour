import './style.css';
import { RitualAudio } from './audio.ts';
import { createEditorZoom } from './editor-zoom.ts';
import { DeskScene } from './scene.ts';
import { loadSettings, sanitizeSettings, saveSettings } from './settings.ts';
import { PaperSurface } from './textures.ts';
import { icon, renderUI } from './ui.ts';
import { INKS, PAGE } from './types.ts';
import type { CameraPreset, Settings, WritingStatus } from './types.ts';
import { layoutText, MAX_CHARACTERS, WritingEngine } from './writing/index.ts';

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
const textarea = element<HTMLTextAreaElement>('#message');
const editorZoom = createEditorZoom(textarea, {
  smaller: element<HTMLButtonElement>('#smaller-editor-text'),
  larger: element<HTMLButtonElement>('#larger-editor-text'),
  hint: element<HTMLElement>('#editor-size-hint'),
});
const beginButton = element<HTMLButtonElement>('#begin-writing');
const styleSelect = element<HTMLSelectElement>('#style');
const paper = new PaperSurface();
paper.setPaper(settings.paper);
let layout = layoutText(textarea.value, { ...PAGE, style: settings.style });
let engine = new WritingEngine(layout, settings);
let scene: DeskScene | null = null;
let rollOpen = false;
let capped = settings.pen === 'fountain';
let lastStatus: WritingStatus = 'idle';
let dirtyDraft = false;
let disposed = false;
let lastTimestamp = 0;
let elapsed = 0;
let animationId = 0;
let soundActivation: Promise<boolean> | null = null;

const rooms = {
  study: { name: 'Rainy Study', description: 'Walnut, lamplight, and nowhere else to be.' },
  atelier: { name: 'Sunlit Atelier', description: 'Open windows. A softer kind of afternoon.' },
  storybook: { name: 'Storybook Nook', description: 'A little wonder, tucked between the pages.' },
};

function updateAudioButtons(): void {
  const enabled = audio.enabled;
  const top = element<HTMLButtonElement>('#enable-sound');
  top.setAttribute('aria-pressed', String(enabled));
  top.title = enabled ? 'Mute sound' : 'Turn sound on';
  element<HTMLSpanElement>('#enable-sound span').textContent = enabled ? 'Sound is on' : 'Enable sound';
  element<HTMLSpanElement>('#panel-enable-sound span').textContent = enabled ? 'Sound is on - tap to mute' : 'Enable sound to settle in';
  element<HTMLButtonElement>('#panel-enable-sound').setAttribute('aria-pressed', String(enabled));
  element<HTMLParagraphElement>('#sound-note').textContent = enabled
    ? audio.diagnostics.contextState === 'not-created'
      ? 'Sound is ready. Your first click, tap, or keypress starts it.'
      : 'Friction follows each stroke and falls quiet whenever the nib lifts.'
    : 'Sound is muted. Turn it on whenever you like.';
}

function activateDefaultSound(event: PointerEvent | KeyboardEvent): void {
  if (!event.isTrusted || document.hidden || !audio.enabled || soundActivation
    || audio.diagnostics.contextState === 'running') return;
  if (event.target instanceof Element && event.target.closest('#enable-sound, #panel-enable-sound')) return;
  if (event instanceof KeyboardEvent && ['Shift', 'Control', 'Alt', 'Meta', 'Escape'].includes(event.key)) return;
  soundActivation = audio.enable();
  void soundActivation.finally(() => {
    soundActivation = null;
    if (!disposed) updateAudioButtons();
  });
}

async function toggleSound(): Promise<void> {
  const buttons = [element<HTMLButtonElement>('#enable-sound'), element<HTMLButtonElement>('#panel-enable-sound')];
  buttons.forEach((button) => { button.disabled = true; });
  if (audio.enabled) await audio.disable();
  else await audio.enable();
  buttons.forEach((button) => { button.disabled = false; });
  updateAudioButtons();
}

function syncSettings(): void {
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
  textarea.dataset.handwriting = settings.style;
  element<HTMLOutputElement>('#speed-label').value = `${settings.speed.toFixed(1).replace('.0', '')}x`;
  const hours = Math.floor(settings.time) % 24;
  const minutes = Math.round((settings.time % 1) * 60);
  element<HTMLOutputElement>('#time-label').value = `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`;
  element<HTMLElement>('#ink-name').textContent = INKS[settings.ink].label;
  element<HTMLElement>('#room-title').textContent = rooms[settings.mood].name;
  element<HTMLElement>('#room-description').textContent = rooms[settings.mood].description;
  const capButton = element<HTMLButtonElement>('#toggle-cap');
  capButton.hidden = settings.pen === 'dip';
  capButton.textContent = capped ? 'Uncap pen' : 'Replace cap';
  capButton.setAttribute('aria-pressed', String(capped));
  document.documentElement.dataset.mood = settings.mood;
}

function updateSettings(next: unknown): void {
  const previous = settings;
  settings = sanitizeSettings(next);
  if (previous.pen !== settings.pen) {
    capped = settings.pen === 'fountain' && engine.status === 'idle';
    scene?.setCapped(capped);
    audio.cue('cap');
  }
  if (previous.paper !== settings.paper) { paper.setPaper(settings.paper); audio.cue('paper'); }
  if (previous.ink !== settings.ink) audio.cue('ink');
  if (previous.nib !== settings.nib) audio.cue('cap');
  scene?.configure(settings);
  audio.configure(settings);
  engine.updateOptions(settings);
  saveSettings(settings, notify);
  syncSettings();
}

function validateDraft(): void {
  layout = layoutText(textarea.value, { ...PAGE, style: settings.style });
  const error = element<HTMLParagraphElement>('#input-error');
  error.textContent = layout.error;
  error.hidden = layout.ok;
  textarea.setAttribute('aria-invalid', String(!layout.ok));
  element<HTMLElement>('#character-count').textContent = `${textarea.value.length} / ${MAX_CHARACTERS}`;
  beginButton.disabled = !scene || !layout.ok;
}

function syncWriting(): void {
  const status = engine.status;
  const active = status === 'writing';
  const paused = status === 'paused';
  const complete = status === 'complete';
  const buttonIcon = active ? 'pause' : complete ? 'reset' : 'play';
  const label = active ? 'Pause for a moment' : paused ? 'Resume writing' : complete ? 'Write it again' : 'Begin writing';
  beginButton.innerHTML = `${icon(buttonIcon)}<span>${label}</span>${icon('arrow', 'begin-arrow')}`;
  textarea.readOnly = active || paused;
  styleSelect.disabled = active || paused;
  element<HTMLButtonElement>('#export-sheet').hidden = !complete;
  element<HTMLElement>('#scene-status').textContent = active ? 'One stroke at a time.' : paused ? 'A moment of stillness.' : complete ? 'A little moment, kept.' : 'Take your time.';
  element<HTMLElement>('#writing-note').textContent = active ? 'The page is yours. Let it unfold.' : paused ? 'Your place is safe.' : complete ? 'Keep it, or begin again.' : 'No hurry. No right words.';
  element<HTMLButtonElement>('#toggle-cap').disabled = active;
  lastStatus = status;
}

function newSheet(announce = true): void {
  audio.updateContact({ contact: false, speed: 0, pressure: 0 });
  engine.reset();
  paper.clear();
  dirtyDraft = false;
  validateDraft();
  capped = settings.pen === 'fountain';
  scene?.setCapped(capped);
  audio.cue('paper');
  syncSettings();
  syncWriting();
  if (announce) notify('A fresh sheet. The words are still here if you want them.');
}

function handleInteraction(action: 'roll' | 'cap' | 'ink'): void {
  if (action === 'roll') {
    rollOpen = !rollOpen;
    scene?.setRoll(rollOpen);
    audio.cue('leather');
    element<HTMLButtonElement>('#toggle-roll').setAttribute('aria-pressed', String(rollOpen));
    element<HTMLSpanElement>('#toggle-roll span').textContent = rollOpen ? 'Tie leather roll' : 'Untie leather roll';
  } else if (action === 'cap' && settings.pen === 'fountain') {
    if (engine.status === 'writing') {
      notify('Pause the pen before replacing its cap.');
      return;
    }
    capped = !capped;
    scene?.setCapped(capped);
    audio.cue('cap');
    syncSettings();
  } else if (action === 'ink') {
    audio.cue('ink');
    notify(`${INKS[settings.ink].label}. A little glass, a little ink.`);
  }
}

try {
  scene = new DeskScene(element<HTMLCanvasElement>('#desk-canvas'), paper, settings, handleInteraction, () => audio.thunder());
  scene.setCapped(capped);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  scene.setReducedMotion(reducedMotion.matches);
  reducedMotion.addEventListener('change', (event) => scene?.setReducedMotion(event.matches));
  scene.updatePen(engine.peek());
  scene.update(0, 0);
  element<HTMLDivElement>('#scene-loading').hidden = true;
} catch (error) {
  element<HTMLDivElement>('#scene-loading').hidden = true;
  const message = element<HTMLDivElement>('#scene-error');
  message.hidden = false;
  message.textContent = `This little room needs WebGL 2. Try a recent browser with hardware acceleration enabled. ${error instanceof Error ? error.message : ''}`;
  console.error('Ink & Hour could not render the desk:', error);
}

beginButton.addEventListener('click', () => {
  if (engine.status === 'writing') {
    engine.pause();
    audio.updateContact(engine.peek());
  } else if (engine.status === 'paused') {
    if (capped) { capped = false; scene?.setCapped(false); audio.cue('cap'); }
    engine.resume();
  } else {
    validateDraft();
    if (!layout.ok) return;
    if (engine.status === 'complete' || dirtyDraft) paper.clear();
    engine = new WritingEngine(layout, settings);
    if (capped) { capped = false; scene?.setCapped(false); audio.cue('cap'); }
    if (settings.pen === 'dip') audio.cue('ink');
    engine.start();
    dirtyDraft = false;
  }
  syncSettings();
  syncWriting();
});

textarea.addEventListener('input', () => {
  dirtyDraft = true;
  if (engine.status === 'complete') {
    engine.reset();
    paper.clear();
    syncWriting();
  }
  validateDraft();
});

styleSelect.addEventListener('change', () => {
  updateSettings({ ...settings, style: styleSelect.value });
  newSheet(false);
});

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-setting]')) {
  button.addEventListener('click', () => {
    const key = button.dataset.setting;
    if (key) updateSettings({ ...settings, [key]: button.dataset.value });
  });
}
for (const input of document.querySelectorAll<HTMLInputElement>('[data-range]')) {
  input.addEventListener('input', () => {
    const key = input.dataset.range;
    if (key) updateSettings({ ...settings, [key]: input.valueAsNumber });
  });
}

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
element<HTMLButtonElement>('#export-sheet').addEventListener('click', () => paper.exportPNG());
element<HTMLButtonElement>('#toggle-roll').addEventListener('click', () => handleInteraction('roll'));
element<HTMLButtonElement>('#toggle-cap').addEventListener('click', () => handleInteraction('cap'));
element<HTMLButtonElement>('#enable-sound').addEventListener('click', () => { void toggleSound(); });
element<HTMLButtonElement>('#panel-enable-sound').addEventListener('click', () => { void toggleSound(); });
document.addEventListener('pointerdown', activateDefaultSound, { capture: true });
document.addEventListener('keydown', activateDefaultSound, { capture: true });
element<HTMLButtonElement>('#dismiss-notice').addEventListener('click', () => { element<HTMLDivElement>('#notice').hidden = true; });
const dialog = element<HTMLDialogElement>('#about-dialog');
element<HTMLButtonElement>('#about-button').addEventListener('click', () => dialog.showModal());
element<HTMLButtonElement>('#close-about').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && engine.status === 'writing') { engine.pause(); syncWriting(); }
  lastTimestamp = 0;
  void audio.setHidden(document.hidden).then(updateAudioButtons);
});
element<HTMLCanvasElement>('#desk-canvas').addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  engine.pause();
  audio.updateContact(engine.peek());
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
    const result = engine.tick(delta);
    paper.draw(result.segments, settings.ink);
    paper.flush();
    scene.updatePen(result.pen);
    audio.updateContact(result.pen);
    scene.update(delta, elapsed);
    if (engine.status !== lastStatus) syncWriting();
  }
  animationId = requestAnimationFrame(frame);
}

syncSettings();
validateDraft();
syncWriting();
updateAudioButtons();
animationId = requestAnimationFrame(frame);

if (import.meta.env.DEV) {
  Object.defineProperty(window, '__inkAndHour', {
    configurable: true,
    get: () => ({
      scene: scene?.diagnostics ?? null, writing: { ...engine.peek(), strokeCount: layout.strokes.length },
      audio: audio.diagnostics, settings: { ...settings }, validInput: layout.ok, inputError: layout.error,
      editor: { zoom: editorZoom.scale },
    }),
  });
}

function dispose(): void {
  if (disposed) return;
  disposed = true;
  cancelAnimationFrame(animationId);
  clearTimeout(noticeTimer);
  document.removeEventListener('pointerdown', activateDefaultSound, { capture: true });
  document.removeEventListener('keydown', activateDefaultSound, { capture: true });
  editorZoom.dispose();
  audio.dispose();
  scene?.dispose();
  paper.dispose();
}
window.addEventListener('pagehide', (event) => { if (!event.persisted) dispose(); });
if (import.meta.hot) import.meta.hot.dispose(dispose);
