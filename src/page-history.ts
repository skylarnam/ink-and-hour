import type { PaperSnapshot } from './textures.ts';

export class PageHistory {
  private readonly pages = new Map<number, PaperSnapshot>();
  readonly limit: number;

  constructor(limit = 10) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new RangeError('Keep between one and ten pages.');
    this.limit = limit;
  }

  get size(): number { return this.pages.size; }
  get oldest(): number | undefined { return this.pages.size ? Math.min(...this.pages.keys()) : undefined; }
  get(index: number): PaperSnapshot | undefined { return this.pages.get(index); }
  has(index: number): boolean { return this.pages.has(index); }

  set(index: number, snapshot: PaperSnapshot): void {
    if (!Number.isInteger(index) || index < 0) throw new RangeError('A saved page needs a nonnegative page number.');
    this.pages.set(index, Object.freeze({ ...snapshot }));
    if (this.pages.size > this.limit) {
      const oldest = Math.min(...this.pages.keys());
      this.pages.delete(oldest);
    }
  }

  clear(): void { this.pages.clear(); }
}
