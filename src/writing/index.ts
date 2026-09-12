export { MAX_CHARACTERS, MAX_PAGES, layoutText, layoutPages, consumePage, restyleRemainingText } from './layout.ts';
export type { BookLayout, BookPage, PageConsumption } from './layout.ts';
export { WritingBook, PAGE_TURN_SECONDS } from './book.ts';
export type { BookFrame } from './book.ts';
export { createContinuousBook, ReadingDeck, formatReading, MAX_READINGS_PER_FILL } from './continuous.ts';
export { WritingEngine, nibWidth } from './engine.ts';
export { parseStrokePath } from './paths.ts';
