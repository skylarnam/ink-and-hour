import type { PaperSnapshot } from './textures.ts';

export interface SavedPage extends PaperSnapshot {
  readonly text?: string;
}

export class PageHistory {
  private readonly pages = new Map<number, SavedPage>();
  readonly limit: number;

  constructor(limit = 10) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new RangeError('Keep between one and ten pages.');
    this.limit = limit;
  }

  get size(): number { return this.pages.size; }
  get oldest(): number | undefined { return this.pages.size ? Math.min(...this.pages.keys()) : undefined; }
  get(index: number): SavedPage | undefined { return this.pages.get(index); }
  has(index: number): boolean { return this.pages.has(index); }

  set(index: number, snapshot: SavedPage): void {
    if (!Number.isInteger(index) || index < 0) throw new RangeError('A saved page needs a nonnegative page number.');
    this.pages.set(index, Object.freeze({ ...snapshot }));
    if (this.pages.size > this.limit) {
      const oldest = Math.min(...this.pages.keys());
      this.pages.delete(oldest);
    }
  }

  trimBefore(index: number): void {
    if (!Number.isInteger(index) || index < 0) throw new RangeError('A retained page range needs a nonnegative start.');
    for (const page of this.pages.keys()) if (page < index) this.pages.delete(page);
  }

  clear(): void { this.pages.clear(); }
}
