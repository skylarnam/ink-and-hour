import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorZoom, MIN_EDITOR_ZOOM, MAX_EDITOR_ZOOM } from '../src/editor-zoom.ts';

class ElementStub extends EventTarget {
  disabled = false;
  textContent = '';
  clientHeight = 90;
  properties = new Map();
  style = { setProperty: (key, value) => this.properties.set(key, value) };
}

function rig(t) {
  const textarea = new ElementStub();
  const controls = { smaller: new ElementStub(), larger: new ElementStub(), hint: new ElementStub() };
  const zoom = createEditorZoom(textarea, controls);
  t.after(() => zoom.dispose());
  return { textarea, controls, zoom };
}

function send(target, type, properties = {}) {
  const event = Object.assign(new Event(type, { cancelable: true }), properties);
  target.dispatchEvent(event);
  return event;
}

function touches(distance) {
  return [{ clientX: 20, clientY: 30 }, { clientX: 20 + distance, clientY: 30 }];
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
}

test('editor zoom starts at the smaller stylesheet default and leaves ordinary scrolling alone', (t) => {
  const { textarea, controls, zoom } = rig(t);
  assert.equal(zoom.scale, 1);
  assert.equal(textarea.properties.get('--editor-scale'), '1');
  assert.match(controls.hint.textContent, /100%/);
  assert.equal(send(textarea, 'wheel', { ctrlKey: false, deltaY: 150, deltaMode: 0 }).defaultPrevented, false);
  assert.equal(zoom.scale, 1);
  assert.equal(send(textarea, 'touchstart', { targetTouches: touches(50).slice(0, 1) }).defaultPrevented, false);
  assert.equal(send(textarea, 'touchmove', { targetTouches: touches(60).slice(0, 1) }).defaultPrevented, false);
});

test('trackpad pinch resizes locally in both directions, with normalized wheel units', (t) => {
  const { textarea, zoom } = rig(t);
  assert.equal(send(textarea, 'wheel', { ctrlKey: true, deltaY: -40, deltaMode: 0 }).defaultPrevented, true);
  close(zoom.scale, Math.exp(0.2));
  send(textarea, 'wheel', { ctrlKey: true, deltaY: 40, deltaMode: 0 });
  close(zoom.scale, 1);
  send(textarea, 'wheel', { ctrlKey: true, deltaY: -1, deltaMode: 1 });
  close(zoom.scale, Math.exp(0.08));
  send(textarea, 'wheel', { ctrlKey: true, deltaY: 1, deltaMode: 2 });
  close(zoom.scale, MIN_EDITOR_ZOOM);
});

test('two-finger pinch follows finger distance without a jump at gesture start', (t) => {
  const { textarea, zoom } = rig(t);
  send(textarea, 'touchstart', { targetTouches: touches(100) });
  assert.equal(zoom.scale, 1);
  assert.equal(send(textarea, 'touchmove', { targetTouches: touches(150) }).defaultPrevented, true);
  close(zoom.scale, 1.5);
  send(textarea, 'touchmove', { targetTouches: touches(90) });
  close(zoom.scale, 0.9);
  send(textarea, 'touchend', { targetTouches: [] });
  send(textarea, 'touchstart', { targetTouches: touches(20) });
  close(zoom.scale, 0.9);
  send(textarea, 'touchmove', { targetTouches: touches(30) });
  close(zoom.scale, 1.35);
});

test('pinch limits stay finite, reverse immediately, and reset after cancellation or extra fingers', (t) => {
  const { textarea, controls, zoom } = rig(t);
  send(textarea, 'touchstart', { targetTouches: touches(100) });
  send(textarea, 'touchmove', { targetTouches: touches(400) });
  assert.equal(zoom.scale, MAX_EDITOR_ZOOM);
  assert.equal(controls.larger.disabled, true);
  send(textarea, 'touchmove', { targetTouches: touches(360) });
  close(zoom.scale, 1.8);
  send(textarea, 'touchmove', { targetTouches: touches(0) });
  send(textarea, 'touchmove', { targetTouches: touches(90) });
  close(zoom.scale, 1.8);
  send(textarea, 'touchstart', { targetTouches: [...touches(90), { clientX: 0, clientY: 0 }] });
  send(textarea, 'touchend', { targetTouches: touches(120) });
  send(textarea, 'touchmove', { targetTouches: touches(60) });
  close(zoom.scale, 0.9);
  send(textarea, 'touchcancel', { targetTouches: [] });
  assert.equal(send(textarea, 'touchmove', { targetTouches: touches(150) }).defaultPrevented, false);
  close(zoom.scale, 0.9);
});

test('Safari gestures scale incrementally without duplicate touch or wheel zoom', (t) => {
  const { textarea, zoom } = rig(t);
  send(textarea, 'gesturestart', { scale: 1 });
  send(textarea, 'gesturechange', { scale: 1.2 });
  close(zoom.scale, 1.2);
  send(textarea, 'gesturechange', { scale: 1.5 });
  close(zoom.scale, 1.5);
  send(textarea, 'wheel', { ctrlKey: true, deltaY: -50, deltaMode: 0 });
  close(zoom.scale, 1.5);
  send(textarea, 'gestureend', { scale: 1.5 });
  send(textarea, 'touchstart', { targetTouches: touches(100) });
  send(textarea, 'gesturestart', { scale: 1 });
  send(textarea, 'gesturechange', { scale: 0.8 });
  close(zoom.scale, 1.5);
  send(textarea, 'touchmove', { targetTouches: touches(80) });
  close(zoom.scale, 1.2);
});

test('keyboard-accessible size buttons share the pinch limits and all listeners are removed on disposal', (t) => {
  const { textarea, controls, zoom } = rig(t);
  for (let i = 0; i < 10; i++) send(controls.smaller, 'click');
  assert.equal(zoom.scale, MIN_EDITOR_ZOOM);
  assert.equal(controls.smaller.disabled, true);
  send(controls.larger, 'click');
  close(zoom.scale, MIN_EDITOR_ZOOM + 0.1);
  assert.equal(controls.smaller.disabled, false);
  zoom.dispose();
  const size = zoom.scale;
  send(controls.larger, 'click');
  assert.equal(send(textarea, 'wheel', { ctrlKey: true, deltaY: -100, deltaMode: 0 }).defaultPrevented, false);
  send(textarea, 'touchstart', { targetTouches: touches(100) });
  send(textarea, 'touchmove', { targetTouches: touches(200) });
  send(textarea, 'gesturestart', { scale: 1 });
  send(textarea, 'gesturechange', { scale: 2 });
  assert.equal(zoom.scale, size);
});
