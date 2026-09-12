import type { InkSegment } from './types.ts';

export const WET_INK_LIMIT = 2048;
export const INK_DRY_SECONDS = 4;
export const WET_INK_UPDATE_SECONDS = 1 / 24;

const clamp = (value: number): number => Math.max(0, Math.min(1, value));

export function inkWetness(ageSeconds: number): number {
  if (!Number.isFinite(ageSeconds)) return 0;
  const progress = clamp(ageSeconds / INK_DRY_SECONDS);
  return 1 - progress * progress * (3 - 2 * progress);
}

export function inkPooling(segment: InkSegment): number {
  const { speed, pressure, from, to } = segment;
  if (speed === undefined || !Number.isFinite(speed) || speed <= 0
    || !Number.isFinite(pressure) || Math.hypot(to.x - from.x, to.y - from.y) <= 1e-6) return 0;
  return clamp((180 - speed) / 160) * clamp((pressure - 0.25) / 0.75);
}

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface WetSegment {
  segment: InkSegment;
  absorption: number;
  pooling: number;
  born: number;
  bounds: Bounds;
}

function validSegment(segment: InkSegment): boolean {
  return [segment.from.x, segment.from.y, segment.to.x, segment.to.y,
    segment.fromWidth, segment.toWidth].every(Number.isFinite);
}

// The same tapered footprint and terminal cap as permanent ink; never bridge pen lifts.
export function fillInkSegment(ctx: CanvasRenderingContext2D, segment: InkSegment, absorption: number): void {
  const { from, to, fromWidth, toWidth } = segment;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const nx = length > 0 ? -dy / length : 0;
  const ny = length > 0 ? dx / length : 1;
  const w0 = Math.max(0.4, fromWidth) * absorption / 2;
  const w1 = Math.max(0.4, toWidth) * absorption / 2;
  ctx.beginPath();
  ctx.moveTo(from.x + nx * w0, from.y + ny * w0);
  ctx.lineTo(to.x + nx * w1, to.y + ny * w1);
  ctx.lineTo(to.x - nx * w1, to.y - ny * w1);
  ctx.lineTo(from.x - nx * w0, from.y - ny * w0);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(to.x, to.y, w1, 0, Math.PI * 2);
  ctx.fill();
}

export class WetInkMask {
  private readonly entries: (WetSegment | undefined)[] = new Array(WET_INK_LIMIT);
  private first = 0;
  private count = 0;
  private time = 0;
  private sinceUpdate = 0;
  private changed = false;
  private reducedMotion = false;
  private disposed = false;
  private maskBounds: Bounds | null = null;
  private maskMinimum = 255;
  private revision = 0;
  private readonly context: CanvasRenderingContext2D;

  constructor(context: CanvasRenderingContext2D) {
    this.context = context;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, context.canvas.width, context.canvas.height);
  }

  get diagnostics() {
    return {
      wetSegmentCount: this.count,
      maxWetSegments: WET_INK_LIMIT,
      drySeconds: INK_DRY_SECONDS,
      updateIntervalSeconds: WET_INK_UPDATE_SECONDS,
      oldestAgeSeconds: this.count ? this.time - this.entries[this.first]!.born : 0,
      maskIsWhite: this.maskBounds === null,
      maskMinimum: this.maskMinimum,
      maskRevision: this.revision,
      maskWidth: this.context.canvas.width,
      maskHeight: this.context.canvas.height,
      maskBounds: this.maskBounds ? { ...this.maskBounds } : null,
      reducedMotion: this.reducedMotion,
      disposed: this.disposed,
    } as const;
  }

  add(segment: InkSegment, absorption: number, pooling: number): void {
    if (this.disposed || this.reducedMotion || !validSegment(segment)
      || Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y) <= 1e-6
      || (segment.speed !== undefined && (!Number.isFinite(segment.speed) || segment.speed <= 0))) return;
    const radius = Math.max(0.4, segment.fromWidth, segment.toWidth) * absorption / 2 + 1;
    const bounds = {
      left: Math.max(0, Math.floor(Math.min(segment.from.x, segment.to.x) - radius)),
      top: Math.max(0, Math.floor(Math.min(segment.from.y, segment.to.y) - radius)),
      right: Math.min(this.context.canvas.width, Math.ceil(Math.max(segment.from.x, segment.to.x) + radius)),
      bottom: Math.min(this.context.canvas.height, Math.ceil(Math.max(segment.from.y, segment.to.y) + radius)),
    };
    if (bounds.left >= bounds.right || bounds.top >= bounds.bottom) return;
    const index = (this.first + this.count) % WET_INK_LIMIT;
    this.entries[index] = {
      segment: {
        from: { ...segment.from }, to: { ...segment.to },
        fromWidth: segment.fromWidth, toWidth: segment.toWidth, pressure: segment.pressure,
      },
      absorption, pooling, born: this.time, bounds,
    };
    if (this.count === WET_INK_LIMIT) this.first = (this.first + 1) % WET_INK_LIMIT;
    else this.count++;
    this.changed = true;
  }

  flush(deltaSeconds = 0): boolean {
    if (this.disposed || (!this.count && !this.changed)) return false;
    const delta = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
    if (delta >= INK_DRY_SECONDS) return this.clear();
    this.time += delta;
    this.sinceUpdate += delta;
    while (this.count && this.time - this.entries[this.first]!.born >= INK_DRY_SECONDS) {
      this.entries[this.first] = undefined;
      this.first = (this.first + 1) % WET_INK_LIMIT;
      this.count--;
      this.changed = true;
    }
    if (!this.count) return this.clear();
    if (this.maskBounds && this.sinceUpdate < WET_INK_UPDATE_SECONDS) return false;
    if (!this.changed && delta === 0) return false;
    this.render();
    this.changed = false;
    this.sinceUpdate %= WET_INK_UPDATE_SECONDS;
    if (!this.maskBounds) this.clear();
    return true;
  }

  setReducedMotion(reduced: boolean): boolean {
    this.reducedMotion = reduced;
    return reduced ? this.clear() : false;
  }

  clear(): boolean {
    this.entries.fill(undefined);
    this.first = this.count = this.time = this.sinceUpdate = 0;
    this.changed = false;
    if (!this.maskBounds) return false;
    this.erase();
    this.maskBounds = null;
    this.maskMinimum = 255;
    this.revision++;
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
  }

  private erase(): void {
    if (!this.maskBounds) return;
    const { left, top, right, bottom } = this.maskBounds;
    this.context.fillStyle = '#ffffff';
    this.context.fillRect(left, top, right - left, bottom - top);
  }

  private render(): void {
    const ctx = this.context;
    this.erase();
    this.maskBounds = null;
    this.maskMinimum = 255;
    ctx.save();
    // Minimum blending prevents crossings and dense sampling from stacking into a glossy blob.
    ctx.globalCompositeOperation = 'darken';
    for (let i = 0; i < this.count; i++) {
      const entry = this.entries[(this.first + i) % WET_INK_LIMIT]!;
      const value = Math.round(255 * (1 - (0.48 + entry.pooling * 0.08) * inkWetness(this.time - entry.born)));
      if (value === 255) continue;
      ctx.fillStyle = `rgb(${value},${value},${value})`;
      fillInkSegment(ctx, entry.segment, entry.absorption);
      this.maskMinimum = Math.min(this.maskMinimum, value);
      const { bounds } = entry;
      this.maskBounds = this.maskBounds ? {
        left: Math.min(this.maskBounds.left, bounds.left), top: Math.min(this.maskBounds.top, bounds.top),
        right: Math.max(this.maskBounds.right, bounds.right), bottom: Math.max(this.maskBounds.bottom, bounds.bottom),
      } : { ...bounds };
    }
    ctx.restore();
    this.revision++;
  }
}
