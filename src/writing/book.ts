import type { EngineOptions, LayoutOptions, PenSample, WritingFrame, WritingStatus } from '../types.ts';
import { WritingEngine } from './engine.ts';
import { MAX_PAGES, restyleRemainingPages, type BookLayout, type BookPage } from './layout.ts';

export const PAGE_TURN_SECONDS = 1.15;

export interface BookFrame extends WritingFrame {
  pageChanged: boolean;
  previousPageIndex: number | null;
}

export interface StreamPage {
  page: BookPage;
  remainder: string;
  fromStroke: number;
  full: boolean;
  options: LayoutOptions;
}

export interface PageStream {
  readonly bufferedCharacterCount: number;
  readonly sourceReadCount: number;
  prepare(previous: BookPage | null, startedStrokes: number, options?: LayoutOptions, fill?: boolean): StreamPage;
  commit(page: StreamPage, consume?: boolean): void;
  reset(): void;
  onError(message: string): void;
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

export const emptyBookPage = (): BookPage => ({
  text: '',
  layout: { ok: true, error: null, strokes: [], characters: [], lineCount: 1, characterCount: 0 },
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
  private stream: PageStream | undefined;
  private needsFill = false;

  constructor(layout: BookLayout, options: EngineOptions, stream?: PageStream) {
    if (!layout.ok || !layout.pages.length || layout.pages.length > MAX_PAGES
      || layout.pages.some((page) => !page.layout.ok)
      || !stream && !layout.pages.some((page) => page.layout.strokes.length)) {
      throw new Error(layout.error ?? 'There is no manuscript to play.');
    }
    this.sheets = layout.pages.slice();
    this.stream = stream;
    this.needsFill = stream !== undefined;
    this.options = { ...options };
    this.engine = this.makeEngine(this.sheets[0]);
    this.blankPen = this.blankPagePen();
  }

  get status(): WritingStatus { return this.state; }
  get pages(): readonly BookPage[] { return this.sheets; }
  get activePage(): BookPage { return this.sheets[this.stream ? 0 : this.pageIndex]; }
  get activePageIndex(): number { return this.pageIndex; }
  get pageCount(): number { return this.stream ? this.pageIndex + 1 : this.sheets.length; }
  get continuous(): boolean { return this.stream !== undefined; }
  get bufferedPageCount(): number { return this.sheets.length; }
  get pendingCharacterCount(): number { return this.stream?.bufferedCharacterCount ?? 0; }
  get bufferedCharacterCount(): number {
    return this.sheets.reduce((count, page) => count + page.text.length, this.pendingCharacterCount);
  }
  get sourceReadCount(): number { return this.stream?.sourceReadCount ?? 0; }
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
    const point = reference?.layout.strokes[0][0] ?? this.blankPen;
    return { ...restingPen(), x: point.x, y: point.y };
  }

  start(): void {
    if (this.state !== 'idle') return;
    this.state = 'writing';
    if (this.needsFill && !this.fillCurrentPage()) return;
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
      if (this.needsFill && !this.fillCurrentPage()) return;
      this.engine?.resume();
      this.engine?.start();
    }
  }

  reset(): void {
    this.state = 'idle';
    this.pageIndex = 0;
    this.turn = null;
    if (this.stream) {
      this.stream.reset();
      this.sheets = [emptyBookPage()];
      this.needsFill = true;
    }
    this.blankPen = restingPen();
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

  private replaceActiveEngine(page: BookPage, fromStroke: number): WritingEngine | null {
    if (this.engine && (this.engine.status === 'paused' || this.engine.status === 'complete')) {
      this.engine.replaceUnwrittenStrokes(fromStroke, page.layout.strokes.slice(fromStroke), true);
      return this.engine;
    }
    const engine = this.makeEngine(page);
    if (this.state === 'paused' && !this.turn) {
      engine?.start();
      engine?.pause();
    }
    return engine;
  }

  private failSource(reason: unknown): void {
    this.pause();
    const message = reason instanceof Error ? reason.message : 'The next reading could not be prepared.';
    // A notification callback cannot be allowed to break the animation loop either.
    try { this.stream?.onError(message); } catch (error) {
      console.error('The reading paused, but its error message could not be shown.', error);
    }
  }

  private fillCurrentPage(): boolean {
    if (!this.stream) return true;
    try {
      const prepared = this.stream.prepare(this.activePage, this.startedStrokeCount);
      const engine = this.replaceActiveEngine(prepared.page, prepared.fromStroke);
      this.stream.commit(prepared);
      this.sheets = [prepared.page];
      this.engine = engine;
      this.blankPen = this.blankPagePen();
      this.needsFill = !prepared.full;
      return true;
    } catch (reason) {
      this.failSource(reason);
      return false;
    }
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
      const progress = this.reducedMotion ? 1
        : Math.min(1, this.turn.progress + deltaSeconds / PAGE_TURN_SECONDS);
      let previousPageIndex: number | null = null;
      if (!this.turn.swapped && progress >= 0.5) {
        let page: BookPage;
        let engine: WritingEngine | null;
        if (this.stream) {
          try {
            const prepared = this.stream.prepare(null, 0);
            engine = this.makeEngine(prepared.page);
            this.stream.commit(prepared);
            page = prepared.page;
            this.needsFill = !prepared.full;
          } catch (reason) {
            this.turn.progress = 0.5;
            this.failSource(reason);
            return frame();
          }
        } else {
          page = this.sheets[this.pageIndex + 1];
          engine = this.makeEngine(page);
        }
        previousPageIndex = this.pageIndex;
        this.pageIndex++;
        if (this.stream) this.sheets = [page];
        this.blankPen = this.blankPagePen();
        this.engine = engine;
        this.turn.swapped = true;
      }
      this.turn.progress = progress;
      if (this.turn.progress === 1) {
        this.turn = null;
        if (this.needsFill && !this.fillCurrentPage()) return frame(previousPageIndex !== null, previousPageIndex);
        this.engine?.start();
      }
      // Even a very large delta must leave the swap frame free of new-sheet ink.
      return frame(previousPageIndex !== null, previousPageIndex);
    }
    const written = this.engine?.tick(deltaSeconds);
    if (!this.engine || this.engine.status === 'complete') {
      if (!this.stream && this.pageIndex === this.sheets.length - 1) this.state = 'complete';
      else this.turn = { progress: 0, swapped: false, pen: this.peek() };
    }
    return { ...frame(), segments: written?.segments ?? [] };
  }

  reflow(options: LayoutOptions): BookLayout {
    const characterCount = this.bufferedCharacterCount;
    const error = (message: string): BookLayout => ({ ok: false, error: message, pages: [], characterCount });
    if (this.state !== 'paused') return error('Pause the pen before changing the remaining handwriting.');

    if (this.stream) {
      try {
        const outgoing = this.turn && !this.turn.swapped;
        const prepared = this.stream.prepare(outgoing ? null : this.activePage,
          outgoing ? 0 : this.startedStrokeCount, options, false);
        if (outgoing) this.stream.commit(prepared, false);
        else {
          const engine = this.replaceActiveEngine(prepared.page, prepared.fromStroke);
          this.stream.commit(prepared);
          this.sheets = [prepared.page];
          this.engine = engine;
          this.blankPen = this.blankPagePen();
          this.needsFill = !prepared.full;
        }
        return { ok: true, error: null, pages: this.sheets.slice(), characterCount };
      } catch (reason) {
        return error(reason instanceof Error ? reason.message : 'The remaining handwriting could not be laid out.');
      }
    }

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
        replacement = this.replaceActiveEngine(changed.pages[0], changed.fromStroke);
      }
    } catch (reason) {
      return error(reason instanceof Error ? reason.message : 'The remaining handwriting could not be laid out.');
    }
    this.sheets = [...this.sheets.slice(0, index), ...changed.pages];
    this.engine = replacement;
    return { ok: true, error: null, pages: this.sheets.slice(), characterCount };
  }
}
