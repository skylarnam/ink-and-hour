import type {
  EngineOptions, InkSegment, LayoutResult, PenSample, Point, WritingFrame, WritingStatus,
} from '../types.ts';
import { clamp, distance, ease, mix } from './paths.ts';

interface Edge {
  from: Point;
  to: Point;
  length: number;
  angle: number;
  pace: number;
  pressureFrom: number;
  pressureTo: number;
}

interface Stroke {
  edges: Edge[];
  length: number;
}

const BASE_SPEED = 132;
const MAX_EDGE_LENGTH = 1.4;
const REST_LIFT = 0.42;

function normalizeOptions(options: EngineOptions): EngineOptions {
  return {
    nib: options.nib === 'fine' || options.nib === 'broad' ? options.nib : 'flex',
    pen: options.pen === 'dip' ? 'dip' : 'fountain',
    speed: Number.isFinite(options.speed) && options.speed > 0 ? clamp(options.speed, 0.1, 4) : 1,
  };
}

export function nibWidth(options: EngineOptions, angle: number, pressure: number): number {
  const force = Number.isFinite(pressure) ? clamp(pressure) : 0;
  const tangent = Number.isFinite(angle) ? angle : 0;
  if (options.nib === 'broad') return 0.95 + 3.45 * Math.abs(Math.sin(tangent - Math.PI / 4));
  if (options.nib === 'fine') return 1.05 + force * (options.pen === 'dip' ? 0.3 : 0.23);
  return 0.85 + Math.pow(force, 1.55) * (options.pen === 'dip' ? 4.4 : 3.5);
}

function edgeEase(offset: number, length: number): number {
  return ease(clamp(Math.min(offset, length - offset) / Math.min(9, length * 0.35)));
}

function pressureAt(offset: number, length: number, angle: number, strokeIndex: number): number {
  const down = Math.max(0, Math.sin(angle));
  return clamp((0.24 + 0.58 * down) * (0.7 + 0.3 * edgeEase(offset, length))
    + 0.018 * Math.sin(offset / 13 + strokeIndex * 0.71), 0.15, 0.92);
}

function compileStroke(points: Point[], strokeIndex: number): Stroke {
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new Error('Handwriting paths must contain finite canvas coordinates.');
  }
  const edges: Edge[] = [];
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    const span = distance(from, to);
    if (!Number.isFinite(span)) throw new Error('Handwriting path length is not finite.');
    if (span < 1e-9) continue;
    const pieces = Math.ceil(span / MAX_EDGE_LENGTH);
    for (let piece = 0; piece < pieces; piece++) {
      const start = mix(from, to, piece / pieces);
      const end = mix(from, to, (piece + 1) / pieces);
      const size = distance(start, end);
      edges.push({
        from: start, to: end, length: size, angle: Math.atan2(end.y - start.y, end.x - start.x),
        pace: 1, pressureFrom: 0, pressureTo: 0,
      });
      length += size;
    }
  }
  if (!edges.length) throw new Error('Every handwriting stroke needs a nonzero centerline.');
  let offset = 0;
  for (let index = 0; index < edges.length; index++) {
    const edge = edges[index];
    const midpoint = offset + edge.length / 2;
    const next = edges[index + 1] ?? edge;
    const bend = (1 - Math.cos(next.angle - edge.angle)) / 2;
    const down = Math.max(0, Math.sin(edge.angle));
    edge.pace = (0.88 - down * 0.12) * (1 - bend * 0.14)
      * (0.79 + 0.21 * edgeEase(midpoint, length))
      * (1 + 0.035 * Math.sin(midpoint / 18 + strokeIndex * 0.71));
    edge.pressureFrom = pressureAt(offset, length, edge.angle, strokeIndex);
    edge.pressureTo = pressureAt(offset + edge.length, length, edge.angle, strokeIndex);
    offset += edge.length;
  }
  return { edges, length };
}

// Exact distance-domain relaxation toward a linear target makes widths independent of frame rate.
function relax(current: number, target: number, slope: number, step: number, response: number): number {
  const blend = -Math.expm1(-step / response);
  return current + (target - current) * blend + slope * (step - response * blend);
}

export class WritingEngine {
  private readonly strokes: Stroke[];
  private readonly totalLength: number;
  private options: EngineOptions;
  private state: WritingStatus = 'idle';
  private strokeIndex = 0;
  private edgeIndex = 0;
  private edgeOffset = 0;
  private drawnLength = 0;
  private phase: 'settle' | 'travel' | 'draw' = 'settle';
  private phaseProgress = 0;
  private position: Point = { x: 0, y: 0 };
  private travelFrom: Point = { x: 0, y: 0 };
  private travelTo: Point = { x: 0, y: 0 };
  private pressure = 0;
  private width = 1;
  private angle = 0;
  private contactSpeed = 0;
  private resumeProgress: number | null = null;
  private suspendedLift = REST_LIFT;

  constructor(layout: LayoutResult, options: EngineOptions) {
    if (!layout.ok || !layout.strokes.length) throw new Error(layout.error ?? 'There is no handwriting to play.');
    this.strokes = layout.strokes.map(compileStroke);
    this.totalLength = this.strokes.reduce((sum, stroke) => sum + stroke.length, 0);
    if (!Number.isFinite(this.totalLength)) throw new Error('Handwriting path length is not finite.');
    this.options = normalizeOptions(options);
    this.reset();
  }

  get status(): WritingStatus { return this.state; }
  get progress(): number { return this.state === 'complete' ? 1 : clamp(this.drawnLength / this.totalLength); }

  start(): void {
    if (this.state === 'idle') this.state = 'writing';
  }

  pause(): void {
    if (this.state !== 'writing') return;
    this.suspendedLift = Math.max(REST_LIFT, this.peek().lift);
    this.state = 'paused';
    this.contactSpeed = 0;
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'writing';
    this.resumeProgress = 0;
  }

  reset(): void {
    this.state = 'idle';
    this.strokeIndex = this.edgeIndex = this.edgeOffset = this.drawnLength = this.phaseProgress = 0;
    this.phase = 'settle';
    this.resumeProgress = null;
    this.suspendedLift = REST_LIFT;
    const first = this.strokes[0].edges[0];
    this.position = { ...first.from };
    this.travelFrom = { ...first.from };
    this.travelTo = { ...first.from };
    this.angle = first.angle;
    this.pressure = this.contactSpeed = 0;
    this.width = nibWidth(this.options, first.angle, 0);
  }

  updateOptions(options: EngineOptions): void {
    this.options = normalizeOptions(options);
  }

  private activeLift(): number {
    if (this.phase === 'settle') return REST_LIFT + (0.035 - REST_LIFT) * ease(this.phaseProgress);
    if (this.phase === 'travel') return 0.035 + 0.57 * Math.sin(Math.PI * this.phaseProgress);
    return 0.035;
  }

  peek(): PenSample {
    const contact = this.state === 'writing' && this.phase === 'draw'
      && this.resumeProgress === null && this.contactSpeed > 0;
    let lift = contact ? 0 : this.activeLift();
    if (this.state === 'idle' || this.state === 'complete') lift = REST_LIFT;
    else if (this.state === 'paused') lift = this.suspendedLift;
    else if (this.resumeProgress !== null) {
      lift = this.suspendedLift + (this.activeLift() - this.suspendedLift) * ease(this.resumeProgress);
    }
    return {
      ...this.position, contact, lift, pressure: contact ? this.pressure : 0,
      speed: contact ? this.contactSpeed : 0, angle: this.angle,
      progress: this.progress, status: this.state,
    };
  }

  tick(deltaSeconds: number): WritingFrame {
    const segments: InkSegment[] = [];
    if (this.state !== 'writing' || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      return { pen: this.peek(), segments };
    }
    let remaining = deltaSeconds;
    while (remaining > 0 && this.state === 'writing') {
      if (this.resumeProgress !== null) {
        const duration = 0.16 / Math.sqrt(this.options.speed);
        const left = (1 - this.resumeProgress) * duration;
        const spent = Math.min(remaining, left);
        remaining = spent === remaining ? 0 : remaining - spent;
        this.resumeProgress = spent === left ? null : this.resumeProgress + spent / duration;
        continue;
      }
      if (this.phase !== 'draw') {
        const duration = (this.phase === 'settle' ? 0.16
          : 0.11 + distance(this.travelFrom, this.travelTo) / 490) / Math.sqrt(this.options.speed);
        const left = (1 - this.phaseProgress) * duration;
        const spent = Math.min(remaining, left);
        remaining = spent === remaining ? 0 : remaining - spent;
        this.phaseProgress = spent === left ? 1 : this.phaseProgress + spent / duration;
        if (this.phase === 'travel') {
          const travel = ease(clamp((this.phaseProgress - 0.18) / 0.64));
          this.position = mix(this.travelFrom, this.travelTo, travel);
          if (distance(this.travelFrom, this.travelTo) > 0) {
            this.angle = Math.atan2(this.travelTo.y - this.travelFrom.y, this.travelTo.x - this.travelFrom.x);
          }
        }
        this.contactSpeed = 0;
        if (this.phaseProgress === 1) this.beginStroke();
        continue;
      }

      const edge = this.strokes[this.strokeIndex].edges[this.edgeIndex];
      const speed = BASE_SPEED * this.options.speed * edge.pace;
      const distanceLeft = edge.length - this.edgeOffset;
      const timeLeft = distanceLeft / speed;
      const spent = Math.min(remaining, timeLeft);
      const step = spent === timeLeft ? distanceLeft : spent * speed;
      const fraction = this.edgeOffset / edge.length;
      const targetPressure = edge.pressureFrom + (edge.pressureTo - edge.pressureFrom) * fraction;
      const widthFrom = nibWidth(this.options, edge.angle, edge.pressureFrom);
      const widthTo = nibWidth(this.options, edge.angle, edge.pressureTo);
      const targetWidth = widthFrom + (widthTo - widthFrom) * fraction;
      const previous = { ...this.position };
      const previousWidth = this.width;
      const previousPressure = this.pressure;
      this.pressure = relax(this.pressure, targetPressure,
        (edge.pressureTo - edge.pressureFrom) / edge.length, step, 2.8);
      this.width = relax(this.width, targetWidth, (widthTo - widthFrom) / edge.length, step, 4.5);
      this.edgeOffset = spent === timeLeft ? edge.length : this.edgeOffset + step;
      this.drawnLength += step;
      remaining = spent === remaining ? 0 : remaining - spent;
      this.position = mix(edge.from, edge.to, clamp(this.edgeOffset / edge.length));
      this.angle = edge.angle;
      this.contactSpeed = speed;
      if (step > 0) segments.push({
        from: previous, to: { ...this.position }, fromWidth: previousWidth,
        toWidth: this.width, pressure: (previousPressure + this.pressure) / 2,
      });
      if (spent === timeLeft) this.advanceEdge();
    }
    return { pen: this.peek(), segments };
  }

  private beginStroke(): void {
    const first = this.strokes[this.strokeIndex].edges[0];
    this.phase = 'draw';
    this.position = { ...first.from };
    this.angle = first.angle;
    this.pressure = first.pressureFrom;
    this.width = nibWidth(this.options, first.angle, first.pressureFrom);
    this.contactSpeed = 0;
  }

  private advanceEdge(): void {
    this.edgeOffset = 0;
    this.edgeIndex++;
    if (this.edgeIndex < this.strokes[this.strokeIndex].edges.length) return;
    this.strokeIndex++;
    this.edgeIndex = 0;
    this.contactSpeed = 0;
    if (this.strokeIndex === this.strokes.length) {
      this.state = 'complete';
      this.drawnLength = this.totalLength;
      return;
    }
    this.phase = 'travel';
    this.phaseProgress = 0;
    this.travelFrom = { ...this.position };
    this.travelTo = { ...this.strokes[this.strokeIndex].edges[0].from };
  }
}
