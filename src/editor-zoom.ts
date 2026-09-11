import { MIN_TEXT_SCALE, MAX_TEXT_SCALE } from './types.ts';

export const MIN_EDITOR_ZOOM = MIN_TEXT_SCALE;
export const MAX_EDITOR_ZOOM = MAX_TEXT_SCALE;

interface EditorZoomControls {
  smaller: HTMLButtonElement;
  larger: HTMLButtonElement;
  hint: HTMLElement;
  initialScale?: number;
  onChange?: (scale: number) => boolean;
}

export function createEditorZoom(textarea: HTMLTextAreaElement, controls: EditorZoomControls): {
  readonly scale: number;
  setScale(scale: number): void;
  setEnabled(enabled: boolean): void;
  dispose(): void;
} {
  const lifetime = new AbortController();
  const options = { passive: false, signal: lifetime.signal };
  let scale = 1;
  let enabled = true;
  let pinching = false;
  let previousDistance: number | null = null;
  let previousGestureScale: number | null = null;

  function resize(next: number): void {
    if (!Number.isFinite(next)) throw new RangeError('Editor text zoom must be finite.');
    scale = Math.min(MAX_EDITOR_ZOOM, Math.max(MIN_EDITOR_ZOOM, next));
    textarea.style.setProperty('--editor-scale', String(scale));
    controls.smaller.disabled = !enabled || scale <= MIN_EDITOR_ZOOM;
    controls.larger.disabled = !enabled || scale >= MAX_EDITOR_ZOOM;
    controls.hint.textContent = enabled
      ? `Editor & paper size / ${Math.round(scale * 100)}%`
      : `Pause to resize lettering / ${Math.round(scale * 100)}%`;
  }

  function requestResize(next: number): void {
    if (!Number.isFinite(next)) throw new RangeError('Lettering size must be finite.');
    if (!enabled) return;
    const clamped = Math.min(MAX_EDITOR_ZOOM, Math.max(MIN_EDITOR_ZOOM, next));
    if (clamped !== scale && (controls.onChange?.(clamped) ?? true)) resize(clamped);
  }

  function touchDistance(event: TouchEvent): number | null {
    if (event.targetTouches.length !== 2) return null;
    const [first, second] = event.targetTouches;
    const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
    return distance > 2 ? distance : null;
  }

  function gestureScale(event: Event): number | null {
    return 'scale' in event && typeof event.scale === 'number' && Number.isFinite(event.scale) && event.scale > 0
      ? event.scale : null;
  }

  textarea.addEventListener('wheel', (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    if (pinching || previousGestureScale !== null) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? textarea.clientHeight : 1;
    const delta = Math.max(-200, Math.min(200, event.deltaY * unit));
    requestResize(scale * Math.exp(-delta * 0.005));
  }, options);

  textarea.addEventListener('touchstart', (event) => {
    if (event.targetTouches.length < 2) return;
    event.preventDefault();
    if (!enabled) return;
    pinching = true;
    previousDistance = touchDistance(event);
  }, options);

  textarea.addEventListener('touchmove', (event) => {
    if (!pinching) return;
    event.preventDefault();
    const distance = touchDistance(event);
    if (previousGestureScale === null && distance !== null && previousDistance !== null) {
      requestResize(scale * distance / previousDistance);
    }
    previousDistance = distance;
  }, options);

  textarea.addEventListener('touchend', (event) => {
    if (pinching) event.preventDefault();
    previousDistance = touchDistance(event);
    if (event.targetTouches.length === 0) pinching = false;
  }, options);

  textarea.addEventListener('touchcancel', () => {
    pinching = false;
    previousDistance = null;
    previousGestureScale = null;
  }, options);

  // Safari trackpads use GestureEvent; touch and wheel streams must not count it twice.
  textarea.addEventListener('gesturestart', (event) => {
    event.preventDefault();
    if (enabled && !pinching) previousGestureScale = gestureScale(event) ?? 1;
  }, options);
  textarea.addEventListener('gesturechange', (event) => {
    event.preventDefault();
    const next = gestureScale(event);
    if (previousGestureScale !== null && next !== null) {
      requestResize(scale * next / previousGestureScale);
      previousGestureScale = next;
    }
  }, options);
  textarea.addEventListener('gestureend', (event) => {
    event.preventDefault();
    previousGestureScale = null;
  }, options);

  controls.smaller.addEventListener('click', () => requestResize(scale - 0.1), { signal: lifetime.signal });
  controls.larger.addEventListener('click', () => requestResize(scale + 0.1), { signal: lifetime.signal });
  resize(controls.initialScale ?? 1);

  return {
    get scale() { return scale; },
    setScale: resize,
    setEnabled(next: boolean) {
      enabled = next;
      if (!enabled) {
        pinching = false;
        previousDistance = previousGestureScale = null;
      }
      resize(scale);
    },
    dispose() { lifetime.abort(); },
  };
}
