import type { EngineOptions, LayoutOptions, PenSample, WritingFrame, WritingStatus } from '../types.ts';
import { WritingEngine } from './engine.ts';
import { MAX_PAGES, restyleRemainingPages, type BookLayout, type BookPage } from './layout.ts';

export const PAGE_TURN_SECONDS = 1.15;

export interface BookFrame extends WritingFrame {
  pageChanged: boolean;
  previousPageIndex: number | null;
}

interface PageTurn {
  progress: number;
  swapped: boolean;
  pen: PenSample;
}

const restingPen = (): PenSample => ({
  x: 0, y: 0, contact: false, lift: 0.42, pressure: 0, speed: 0,
  angle: 0, progress: 0, status: 'idle',
});

/** Only the active sheet is compiled. Progress is local to that physical sheet. */
export class WritingBook {
  private sheets: BookPage[];
  private engine: WritingEngine | null;
  private options: EngineOptions;
  private state: WritingStatus = 'idle';
  private pageIndex = 0;
  private turn: PageTurn | null = null;
  private reducedMotion = false;
  private blankPen = restingPen();

  constructor(layout: BookLayout, options: EngineOptions) {
    if (!layout.ok || !layout.pages.length || layout.pages.length > MAX_PAGES
      || layout.pages.some((page) => !page.layout.ok)
      || !layout.pages.some((page) => page.layout.strokes.length)) {
      throw new Error(layout.error ?? 'There is no manuscript to play.');
    }
    this.sheets = layout.pages.slice();
    this.options = { ...options };
    this.engine = this.makeEngine(this.sheets[0]);
    this.blankPen = this.blankPagePen();
  }

  get status(): WritingStatus { return this.state; }
  get pages(): readonly BookPage[] { return this.sheets; }
  get activePageIndex(): number { return this.pageIndex; }
  get pageCount(): number { return this.sheets.length; }
  get turnProgress(): number | null { return this.turn?.progress ?? null; }
  get startedStrokeCount(): number { return this.engine?.startedStrokeCount ?? 0; }
  get progress(): number {
    return this.engine?.progress ?? (this.state === 'complete' || this.turn && !this.turn.swapped ? 1 : 0);
  }

  private makeEngine(page: BookPage): WritingEngine | null {
    return page.layout.strokes.length ? new WritingEngine(page.layout, this.options) : null;
  }

  private blankPagePen(): PenSample {
    const reference = this.sheets.slice(this.pageIndex).find((page) => page.layout.strokes.length)
      ?? this.sheets.find((page) => page.layout.strokes.length);
    return { ...restingPen(), ...reference?.layout.strokes[0][0] };
  }

  start(): void {
    if (this.state !== 'idle') return;
    this.state = 'writing';
    this.engine?.start();
  }

  pause(): void {
    if (this.state !== 'writing') return;
    this.engine?.pause();
    this.state = 'paused';
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'writing';
    if (!this.turn) {
      this.engine?.resume();
      this.engine?.start();
    }
  }

  reset(): void {
    this.state = 'idle';
    this.pageIndex = 0;
    this.turn = null;
    this.blankPen = this.blankPagePen();
    this.engine = this.makeEngine(this.sheets[0]);
  }

  updateOptions(options: EngineOptions): void {
    this.options = { ...options };
    this.engine?.updateOptions(options);
  }

  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
  }

  peek(): PenSample {
    const pen = this.turn && !this.turn.swapped
      ? this.turn.pen : this.engine?.peek() ?? this.blankPen;
    if (this.turn || this.state !== 'writing' || !this.engine) {
      return {
        ...pen, contact: false, pressure: 0, speed: 0, lift: Math.max(0.42, pen.lift),
        progress: this.progress, status: this.state,
      };
    }
    return { ...pen, status: this.state };
  }

  tick(deltaSeconds: number): BookFrame {
    const frame = (pageChanged = false, previousPageIndex: number | null = null): BookFrame => ({
      pen: this.peek(), segments: [], pageChanged, previousPageIndex,
    });
    if (this.state !== 'writing' || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return frame();
    if (this.turn) {
      this.turn.progress = this.reducedMotion ? 1
        : Math.min(1, this.turn.progress + deltaSeconds / PAGE_TURN_SECONDS);
      let previousPageIndex: number | null = null;
      if (!this.turn.swapped && this.turn.progress >= 0.5) {
        previousPageIndex = this.pageIndex;
        this.pageIndex++;
        this.blankPen = this.blankPagePen();
        this.engine = this.makeEngine(this.sheets[this.pageIndex]);
        this.turn.swapped = true;
      }
      if (this.turn.progress === 1) {
        this.turn = null;
        this.engine?.start();
      }
      // Even a very large delta must leave the swap frame free of new-sheet ink.
      return frame(previousPageIndex !== null, previousPageIndex);
    }
    const written = this.engine?.tick(deltaSeconds);
    if (!this.engine || this.engine.status === 'complete') {
      if (this.pageIndex === this.sheets.length - 1) this.state = 'complete';
      else this.turn = { progress: 0, swapped: false, pen: this.peek() };
    }
    return { ...frame(), segments: written?.segments ?? [] };
  }

  reflow(options: LayoutOptions): BookLayout {
    const characterCount = this.sheets.reduce((count, page) => count + page.text.length, 0);
    const error = (message: string): BookLayout => ({ ok: false, error: message, pages: [], characterCount });
    if (this.state !== 'paused') return error('Pause the pen before changing the remaining handwriting.');

    // The outgoing sheet is already committed once a turn has begun.
    const index = this.pageIndex + (this.turn && !this.turn.swapped ? 1 : 0);
    const previous = this.sheets[index].layout;
    const startedStrokes = index === this.pageIndex ? this.startedStrokeCount : 0;
    const text = this.sheets.slice(index).map((page) => page.text).join('');
    const changed = restyleRemainingPages(text, previous, options, startedStrokes, MAX_PAGES - index);
    if (!changed.ok) return error(changed.error!.replace(/\d+-page limit/, `${MAX_PAGES}-page limit`));

    let replacement = this.engine;
    try {
      if (index === this.pageIndex) {
        if (this.engine && (this.engine.status === 'paused' || this.engine.status === 'complete')) {
          this.engine.replaceUnwrittenStrokes(changed.fromStroke,
            changed.pages[0].layout.strokes.slice(changed.fromStroke), true);
        } else {
          replacement = this.makeEngine(changed.pages[0]);
          if (!this.turn) {
            replacement?.start();
            replacement?.pause();
          }
        }
      }
    } catch (reason) {
      return error(reason instanceof Error ? reason.message : 'The remaining handwriting could not be laid out.');
    }
    this.sheets = [...this.sheets.slice(0, index), ...changed.pages];
    this.engine = replacement;
    return { ok: true, error: null, pages: this.sheets.slice(), characterCount };
  }
}
