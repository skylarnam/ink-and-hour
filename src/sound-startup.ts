export function soundPresentation(enabled: boolean, running: boolean) {
  if (!enabled) return {
    state: 'muted', label: 'Enable sound', action: 'Turn sound on',
    panelLabel: 'Enable sound to settle in',
    note: 'Sound is muted. Turn it on whenever you like.',
  };
  if (!running) return {
    state: 'ready', label: 'Sound ready', action: 'Keep sound muted before it starts',
    panelLabel: 'Sound ready - tap to keep muted',
    note: 'Your browser waits for a first click, tap, or keypress. Sound then starts automatically.',
  };
  return {
    state: 'running', label: 'Sound is on', action: 'Mute sound',
    panelLabel: 'Sound is on - tap to mute',
    note: 'Friction follows each stroke and falls quiet whenever the nib lifts.',
  };
}

interface SoundStartupOptions {
  enabled: () => boolean;
  running: () => boolean;
  musicRequested: () => boolean;
  enable: () => Promise<boolean>;
  onSettled: () => void;
}

export function createSoundStartup(document: Document, options: SoundStartupOptions): {
  afterActivation(action: () => void): void;
  dispose(): void;
} {
  let pending: Promise<boolean> | null = null;
  let disposed = false;
  const activate = (event: Event): void => {
    if (!event.isTrusted || document.hidden || disposed || pending || !options.enabled() || options.running()) return;
    if (event.type === 'pointerup' && !(event.target instanceof Element && event.target.closest('#desk-canvas'))) return;
    if (event.target instanceof Element
      && (event.target.closest('#enable-sound, #panel-enable-sound, #quiet-sound')
        || event.target.closest('#music-play') && options.musicRequested())) return;
    if (event.type === 'keydown' && 'key' in event && typeof event.key === 'string'
      && ['Shift', 'Control', 'Alt', 'Meta', 'Escape'].includes(event.key)) return;
    pending = options.enable();
    void pending.finally(() => {
      pending = null;
      if (!disposed) options.onSettled();
    });
  };
  // A touch pointerdown is not an audio-unlocking gesture in every browser; its click is.
  document.addEventListener('click', activate, { capture: true });
  // Desk materials react on pointerup, before the later click arrives.
  document.addEventListener('pointerup', activate, { capture: true });
  document.addEventListener('keydown', activate, { capture: true });
  return {
    afterActivation(action) {
      if (disposed || document.hidden || !options.enabled()) return;
      if (options.running()) action();
      else if (pending) void pending.then((enabled) => {
        if (enabled && !disposed && !document.hidden && options.enabled() && options.running()) action();
      });
    },
    dispose() {
      disposed = true;
      document.removeEventListener('click', activate, { capture: true });
      document.removeEventListener('pointerup', activate, { capture: true });
      document.removeEventListener('keydown', activate, { capture: true });
    },
  };
}
