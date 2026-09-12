export const BACKGROUND_FRAME_MS = 1000 / 30;
export const BACKGROUND_STALL_MS = 250;

export interface PlaybackFrame {
  background: boolean;
  stalled: boolean;
}

interface PlaybackClockOptions {
  document: Document;
  onFrame: (timestamp: number, frame: PlaybackFrame) => void;
  onError: (error: unknown) => void;
  now?: () => number;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (id: number) => void;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
}

export function createPlaybackClock(options: PlaybackClockOptions) {
  const now = options.now ?? (() => performance.now());
  const request = options.requestFrame ?? ((callback: FrameRequestCallback) => requestAnimationFrame(callback));
  const cancel = options.cancelFrame ?? ((id: number) => cancelAnimationFrame(id));
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let frameId: number | null = null;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let last: number | undefined;
  let wasBackground = options.document.hidden;
  let running = false;
  let disposed = false;

  function cancelPending(): void {
    if (frameId !== null) cancel(frameId);
    if (timerId !== null) clearTimer(timerId);
    frameId = timerId = null;
  }

  function schedule(): void {
    if (!running || disposed) return;
    if (options.document.hidden) timerId = setTimer(() => run(now()), BACKGROUND_FRAME_MS);
    else frameId = request(run);
  }

  function run(timestamp: number): void {
    frameId = timerId = null;
    if (!running || disposed) return;
    const background = options.document.hidden;
    const stalled = last !== undefined && (background || wasBackground) && timestamp - last > BACKGROUND_STALL_MS;
    last = timestamp;
    wasBackground = background;
    try {
      options.onFrame(timestamp, { background, stalled });
    } catch (error) {
      running = false;
      options.onError(error);
      return;
    }
    schedule();
  }

  const visibilityChanged = (): void => {
    if (!running || disposed) return;
    cancelPending();
    run(now());
  };
  options.document.addEventListener('visibilitychange', visibilityChanged);
  return {
    get running() { return running; },
    start(): void {
      if (running || disposed) return;
      running = true;
      last = undefined;
      wasBackground = options.document.hidden;
      schedule();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      running = false;
      cancelPending();
      options.document.removeEventListener('visibilitychange', visibilityChanged);
    },
  };
}
