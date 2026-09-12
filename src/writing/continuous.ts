import type { Reading } from '../readings.ts';
import type { EngineOptions, LayoutOptions } from '../types.ts';
import { WritingBook, emptyBookPage, type PageStream, type StreamPage } from './book.ts';
import { consumePage, restyleFirstPage, MAX_CHARACTERS, type BookPage } from './layout.ts';

export const MAX_READINGS_PER_FILL = 128;

export function formatReading(reading: Reading): string {
  if (typeof reading.title !== 'string' || typeof reading.author !== 'string' || typeof reading.text !== 'string'
    || !/^[\x20-\x7e]*[!-~][\x20-\x7e]*$/.test(reading.title)
    || !/^[\x20-\x7e]*[!-~][\x20-\x7e]*$/.test(reading.author)) {
    throw new Error('Each reading needs an ASCII title and author on a single line.');
  }
  const body = reading.text.replace(/\r\n?/g, '\n');
  if (!/^[\x20-\x7e\n]*$/.test(body) || !/[!-~]/.test(body)) {
    throw new Error('Each reading needs a nonempty English ASCII body.');
  }
  const text = `${reading.title}\nby ${reading.author}\n\n${body}\n\n`;
  if (text.length > MAX_CHARACTERS) throw new Error('This reading exceeds the continuous writing text buffer.');
  return text;
}

/** One shuffled cycle at a time, with no repeated work across a refill when alternatives exist. */
export class ReadingDeck {
  private readings: readonly Reading[];
  private random: () => number;
  private order: Reading[] = [];
  private position = 0;
  private lastId: string | null = null;
  private count = 0;

  constructor(readings: readonly Reading[], random: () => number = Math.random) {
    this.readings = readings.slice();
    this.random = random;
  }

  get drawCount(): number { return this.count; }

  reset(): void {
    this.order = [];
    this.position = this.count = 0;
    this.lastId = null;
  }

  private refill(): void {
    if (!this.readings.length) throw new Error('There are no readings available for continuous writing.');
    const ids = this.readings.map((reading) => reading.id);
    if (ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) {
      throw new Error('Each reading needs its own unique identifier.');
    }
    const next = this.readings.slice();
    for (let i = next.length - 1; i > 0; i--) {
      const random = this.random();
      if (!Number.isFinite(random) || random < 0 || random >= 1) throw new Error('The reading shuffle could not be prepared.');
      const j = Math.floor(random * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    if (next.length > 1 && next[0].id === this.lastId) [next[0], next[1]] = [next[1], next[0]];
    this.order = next;
    this.position = 0;
  }

  private take<T>(format: (reading: Reading) => T): T {
    if (this.position === this.order.length) this.refill();
    const reading = this.order[this.position];
    const id = reading.id;
    const result = format(reading);
    this.position++;
    this.lastId = id;
    this.count++;
    return result;
  }

  next(): Reading { return this.take((reading) => reading); }

  nextText(capacity = MAX_CHARACTERS): string {
    return this.take((reading) => {
      const text = formatReading(reading);
      if (text.length > capacity) throw new Error('This page exceeds the continuous writing text buffer.');
      return text;
    });
  }
}

class ReadingStream implements PageStream {
  private deck: ReadingDeck;
  private options: LayoutOptions;
  private pending = '';
  onError: (message: string) => void;

  constructor(readings: readonly Reading[], options: LayoutOptions, onError: (message: string) => void, random?: () => number) {
    this.deck = new ReadingDeck(readings, random);
    this.options = { ...options };
    this.onError = onError;
  }

  get bufferedCharacterCount(): number { return this.pending.length; }
  get sourceReadCount(): number { return this.deck.drawCount; }

  reset(): void {
    this.pending = '';
    this.deck.reset();
  }

  prepare(
    previous: BookPage | null, startedStrokes: number, options = this.options, fill = true,
  ): StreamPage {
    const selected = { ...options };
    let text = (previous?.text ?? '') + this.pending;
    for (let pulls = 0; ; pulls++) {
      const result = previous
        ? restyleFirstPage(text, previous.layout, selected, startedStrokes)
        : { ...consumePage(text, selected), fromStroke: 0 };
      if (!result.ok) throw new Error(result.error!);
      if (result.full || !fill) {
        return {
          page: result.page!, remainder: result.remainder, fromStroke: result.fromStroke,
          full: result.full, options: selected,
        };
      }
      if (pulls >= MAX_READINGS_PER_FILL) throw new Error('This page needs too many readings to fill safely.');
      const next = this.deck.nextText(MAX_CHARACTERS - text.length);
      // Successful pulls are staged until a page commits; a later source error cannot lose them.
      this.pending += next;
      text += next;
    }
  }

  commit(page: StreamPage, consume = true): void {
    this.options = page.options;
    if (consume) this.pending = page.remainder;
  }
}

/** Lazy: creating/resetting a book never pulls readings. Start or resume performs bounded synchronous fills. */
export function createContinuousBook(
  readings: readonly Reading[], layoutOptions: LayoutOptions, engineOptions: EngineOptions,
  onError: (message: string) => void, random?: () => number,
): WritingBook {
  const page = emptyBookPage();
  return new WritingBook({ ok: true, error: null, pages: [page], characterCount: 0 }, engineOptions,
    new ReadingStream(readings, layoutOptions, onError, random));
}
