export const MIN_EDITOR_ZOOM = 0.75;
export const MAX_EDITOR_ZOOM = 2;

interface EditorZoomControls {
  smaller: HTMLButtonElement;
  larger: HTMLButtonElement;
  hint: HTMLElement;
}

export function createEditorZoom(textarea: HTMLTextAreaElement, controls: EditorZoomControls): {
  readonly scale: number;
  dispose(): void;
} {
  const lifetime = new AbortController();
  const options = { passive: false, signal: lifetime.signal };
  let scale = 1;
  let pinching = false;
  let previousDistance: number | null = null;
  let previousGestureScale: number | null = null;

  function resize(next: number): void {
    if (!Number.isFinite(next)) throw new RangeError('Editor text zoom must be finite.');
    scale = Math.min(MAX_EDITOR_ZOOM, Math.max(MIN_EDITOR_ZOOM, next));
    textarea.style.setProperty('--editor-scale', String(scale));
    controls.smaller.disabled = scale <= MIN_EDITOR_ZOOM;
    controls.larger.disabled = scale >= MAX_EDITOR_ZOOM;
    controls.hint.textContent = `Pinch to resize text / ${Math.round(scale * 100)}%`;
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
    resize(scale * Math.exp(-delta * 0.005));
  }, options);

  textarea.addEventListener('touchstart', (event) => {
    if (event.targetTouches.length < 2) return;
    event.preventDefault();
    pinching = true;
    previousDistance = touchDistance(event);
  }, options);

  textarea.addEventListener('touchmove', (event) => {
    if (!pinching) return;
    event.preventDefault();
    const distance = touchDistance(event);
    if (previousGestureScale === null && distance !== null && previousDistance !== null) {
      resize(scale * distance / previousDistance);
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
    if (!pinching) previousGestureScale = gestureScale(event) ?? 1;
  }, options);
  textarea.addEventListener('gesturechange', (event) => {
    event.preventDefault();
    const next = gestureScale(event);
    if (previousGestureScale !== null && next !== null) {
      resize(scale * next / previousGestureScale);
      previousGestureScale = next;
    }
  }, options);
  textarea.addEventListener('gestureend', (event) => {
    event.preventDefault();
    previousGestureScale = null;
  }, options);

  controls.smaller.addEventListener('click', () => resize(scale - 0.1), { signal: lifetime.signal });
  controls.larger.addEventListener('click', () => resize(scale + 0.1), { signal: lifetime.signal });
  resize(1);

  return {
    get scale() { return scale; },
    dispose() { lifetime.abort(); },
  };
}
