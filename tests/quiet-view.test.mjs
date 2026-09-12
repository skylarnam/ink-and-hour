import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuietView } from '../src/quiet-view.ts';

function setup(t) {
  const state = { focused: null, holds: 0, dialog: false };
  class Element extends EventTarget {
    hidden = false;
    inert = false;
    dataset = {};
    attributes = new Map();
    focus(options) { assert.equal(options.preventScroll, true); state.focused = this; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    click() { this.dispatchEvent(new Event('click')); }
  }
  const document = new EventTarget();
  document.querySelector = (selector) => selector === 'dialog[open]' && state.dialog ? {} : null;
  const root = new Element();
  const enter = new Element();
  const exit = new Element();
  const toolbar = new Element();
  toolbar.hidden = true;
  const chrome = [new Element(), new Element(), enter];
  const viewport = { scrollX: 12, scrollY: 340, scrollTo(x, y) { this.scrollX = x; this.scrollY = y; } };
  const view = createQuietView({ document, root, enter, exit, toolbar, chrome, viewport, onEnter: () => state.holds++ });
  t.after(() => view.dispose());
  const key = (key, prevented = false) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { key });
    if (prevented) event.preventDefault();
    document.dispatchEvent(event);
    return event;
  };
  return { state, root, enter, exit, toolbar, chrome, viewport, view, key };
}

test('entry hides and inerts the chrome, reveals essentials, focuses exit and holds the camera once', (t) => {
  const { view, enter, exit, toolbar, chrome, root, state, viewport } = setup(t);
  assert.equal(view.active, false);
  enter.click();
  assert.equal(view.active, true);
  assert.equal(root.dataset.quietView, 'true');
  assert.equal(toolbar.hidden, false);
  assert.ok(chrome.every((element) => element.hidden && element.inert));
  assert.equal(state.focused, exit);
  assert.equal(viewport.scrollY, 0);
  assert.equal(enter.attributes.get('aria-pressed'), 'true');
  view.setActive(true);
  assert.equal(state.holds, 1);
});

test('Escape restores the exact hidden/inert state, entry focus and mobile scroll position', (t) => {
  const { enter, toolbar, chrome, root, state, viewport, view, key } = setup(t);
  chrome[0].hidden = true;
  chrome[1].inert = true;
  const before = chrome.map((element) => ({ hidden: element.hidden, inert: element.inert }));
  enter.click();
  assert.equal(key('Escape').defaultPrevented, true);
  assert.equal(view.active, false);
  assert.equal(root.dataset.quietView, undefined);
  assert.equal(toolbar.hidden, true);
  assert.deepEqual(chrome.map((element) => ({ hidden: element.hidden, inert: element.inert })), before);
  assert.equal(state.focused, enter);
  assert.deepEqual([viewport.scrollX, viewport.scrollY], [12, 340]);
  assert.equal(enter.attributes.get('aria-pressed'), 'false');
});

test('Show controls exits reliably across repeated entries without changing other key behavior', (t) => {
  const { enter, exit, view, key, state } = setup(t);
  for (let index = 0; index < 20; index++) {
    enter.click();
    assert.equal(key(' ').defaultPrevented, false);
    assert.equal(view.active, true);
    exit.click();
    assert.equal(view.active, false);
  }
  assert.equal(state.holds, 20);
  assert.equal(key('Escape').defaultPrevented, false);
});

test('Escape belongs to an open dialog or an already-handled keyboard interaction first', (t) => {
  const { enter, view, key, state } = setup(t);
  enter.click();
  state.dialog = true;
  assert.equal(key('Escape').defaultPrevented, false);
  assert.equal(view.active, true);
  state.dialog = false;
  key('Escape', true);
  assert.equal(view.active, true);
  key('Escape');
  assert.equal(view.active, false);
});

test('disposal restores the document, removes listeners and does not steal focus or reenter', (t) => {
  const { enter, exit, view, state, root, chrome, key } = setup(t);
  enter.click();
  view.dispose();
  assert.equal(view.active, false);
  assert.equal(root.dataset.quietView, undefined);
  assert.ok(chrome.every((element) => !element.hidden && !element.inert));
  assert.equal(state.focused, exit);
  enter.click();
  view.setActive(true);
  key('Escape');
  assert.equal(view.active, false);
  assert.equal(state.holds, 1);
  view.dispose();
});
