interface QuietViewOptions {
  document: Document;
  root: HTMLElement;
  enter: HTMLButtonElement;
  exit: HTMLButtonElement;
  toolbar: HTMLElement;
  chrome: HTMLElement[];
  viewport: Pick<Window, 'scrollX' | 'scrollY' | 'scrollTo'>;
  onEnter: () => void;
}

export function createQuietView(options: QuietViewOptions): {
  readonly active: boolean;
  setActive: (active: boolean) => void;
  dispose: () => void;
} {
  let active = false;
  let disposed = false;
  let scroll = { x: 0, y: 0 };
  let previous: { element: HTMLElement; hidden: boolean; inert: boolean }[] = [];

  function setActive(next: boolean, restoreFocus = true): void {
    if (disposed || next === active) return;
    active = next;
    if (next) {
      scroll = { x: options.viewport.scrollX, y: options.viewport.scrollY };
      previous = options.chrome.map((element) => ({ element, hidden: element.hidden, inert: element.inert }));
      options.onEnter();
      options.root.dataset.quietView = 'true';
      options.toolbar.hidden = false;
      options.exit.focus({ preventScroll: true });
      for (const { element } of previous) {
        element.inert = true;
        element.hidden = true;
      }
      options.viewport.scrollTo(0, 0);
    } else {
      delete options.root.dataset.quietView;
      for (const { element, hidden, inert } of previous) {
        element.hidden = hidden;
        element.inert = inert;
      }
      previous = [];
      options.toolbar.hidden = true;
      if (restoreFocus) {
        options.enter.focus({ preventScroll: true });
        options.viewport.scrollTo(scroll.x, scroll.y);
      }
    }
    options.enter.setAttribute('aria-pressed', String(next));
  }

  const enter = (): void => setActive(true);
  const exit = (): void => setActive(false);
  const keydown = (event: KeyboardEvent): void => {
    if (active && event.key === 'Escape' && !event.defaultPrevented && !options.document.querySelector('dialog[open]')) {
      event.preventDefault();
      setActive(false);
    }
  };
  options.enter.addEventListener('click', enter);
  options.exit.addEventListener('click', exit);
  options.document.addEventListener('keydown', keydown);
  return {
    get active() { return active; },
    setActive,
    dispose() {
      if (disposed) return;
      setActive(false, false);
      disposed = true;
      options.enter.removeEventListener('click', enter);
      options.exit.removeEventListener('click', exit);
      options.document.removeEventListener('keydown', keydown);
    },
  };
}
