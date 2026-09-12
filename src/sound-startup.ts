export function soundPresentation(enabled: boolean, running: boolean) {
  if (!enabled) return {
    state: 'muted', label: 'Enable sound', action: 'Turn sound on',
    panelLabel: 'Enable sound to settle in',
    note: 'Sound is muted. Turn it on whenever you like.',
  };
  if (!running) return {
    state: 'ready', label: 'Start sound', action: 'Start sound',
    panelLabel: 'Start sound - your browser may need a tap',
    note: 'Sound is requested. If your browser blocks automatic playback, click, tap, or type to start it.',
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
  onGesture?: () => void;
}

export function createSoundStartup(document: Document, options: SoundStartupOptions): {
  afterActivation(action: () => void): void;
  dispose(): void;
} {
  let pending: Promise<boolean> | null = null;
  let disposed = false;
  let cueRevision = 0;
  const activate = (event: Event): void => {
    if (!event.isTrusted || document.hidden || disposed || !options.enabled()) return;
    if (event.type === 'pointerup' && !(event.target instanceof Element && event.target.closest('#desk-canvas'))) return;
    if (event.target instanceof Element
      && event.target.closest('#enable-sound, #panel-enable-sound, #quiet-sound, #music-play, #music-previous, #music-next')) return;
    if (event.type === 'keydown' && 'key' in event && typeof event.key === 'string'
      && ['Shift', 'Control', 'Alt', 'Meta', 'Escape'].includes(event.key)) return;
    options.onGesture?.();
    if (pending || options.running()) return;
    cueRevision++;
    pending = options.enable();
    const settled = (): void => {
      pending = null;
      if (!disposed) options.onSettled();
    };
    void pending.then(settled, settled);
  };
  const onVisibility = (): void => { if (document.hidden) cueRevision++; };
  // A touch pointerdown is not an audio-unlocking gesture in every browser; its click is.
  document.addEventListener('click', activate, { capture: true });
  // Desk materials react on pointerup, before the later click arrives.
  document.addEventListener('pointerup', activate, { capture: true });
  document.addEventListener('keydown', activate, { capture: true });
  document.addEventListener('visibilitychange', onVisibility, { capture: true });
  return {
    afterActivation(action) {
      if (disposed || !options.enabled()) return;
      if (options.running()) action();
      else if (pending && !document.hidden) {
        const revision = cueRevision;
        const requestedAt = Date.now();
        void pending.then((enabled) => {
          if (enabled && revision === cueRevision && Date.now() - requestedAt < 1000
            && !disposed && !document.hidden && options.enabled() && options.running()) action();
        }, () => {});
      }
    },
    dispose() {
      disposed = true;
      cueRevision++;
      document.removeEventListener('click', activate, { capture: true });
      document.removeEventListener('pointerup', activate, { capture: true });
      document.removeEventListener('keydown', activate, { capture: true });
      document.removeEventListener('visibilitychange', onVisibility, { capture: true });
    },
  };
}
