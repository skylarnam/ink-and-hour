import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutText, parseStrokePath, nibWidth, WritingEngine, MAX_CHARACTERS } from '../src/writing/index.ts';
import { smoothStroke } from '../src/writing/paths.ts';
import fonts from '../src/writing/fonts.json' with { type: 'json' };
import { handwritingFontData } from '../src/writing/font-data.ts';

const options = { width: 780, height: 1040, style: 'correspondence' };
const tool = { pen: 'fountain', nib: 'flex', speed: 1 };
const point = (sample) => ({ x: sample.x, y: sample.y });
const near = (actual, expected, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
const fixture = (strokes) => ({ ok: true, error: null, strokes, lineCount: 1, characterCount: 1 });
const line = (length = 200) => fixture([[{ x: 40, y: 60 }, { x: 40 + length, y: 60 }]]);
const moves = (style, text) => [...text].reduce((sum, character) =>
  sum + (handwritingFontData(style).chars[character.charCodeAt(0) - 33]?.d.match(/M/g)?.length ?? 0), 0);

test('M starts true strokes; repeated coordinate pairs are retained', () => {
  assert.deepEqual(parseStrokePath('M1,2 L3,4 5,6 M7,8 L9,10'), [
    [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }],
    [{ x: 7, y: 8 }, { x: 9, y: 10 }],
  ]);
});

test('every printable English glyph is defined in selected script and print hands and stays on paper', () => {
  for (const style of ['correspondence', 'pangolin']) {
    for (let code = 33; code <= 126; code++) {
      const result = layoutText(String.fromCharCode(code), { ...options, style });
      assert.equal(result.ok, true, `${style}: ${code}`);
      assert.ok(result.strokes.length > 0);
      assert.equal(result.strokes.length, moves(style, String.fromCharCode(code)));
      for (const point of result.strokes.flat()) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
        assert.ok(point.x >= 70 && point.x < 706 && point.y >= 80 && point.y < 967);
      }
    }
  }
});

test('input validation is visible rather than silently dropping characters', () => {
  for (const input of ['', '   ', '안녕', 'café', 'hello\tworld', 'hello 🌱', 'a'.repeat(MAX_CHARACTERS + 1)]) {
    const result = layoutText(input, options);
    assert.equal(result.ok, false);
    assert.ok(result.error);
    assert.deepEqual(result.strokes, []);
  }
  assert.equal(layoutText('Hello\r\nworld!', options).ok, true);
});

test('word wrapping, long words and explicit page capacity are bounded', () => {
  for (const style of ['correspondence', 'pangolin']) {
    const result = layoutText('A quiet moment is sometimes all we need. '.repeat(3), { ...options, style });
    assert.equal(result.ok, true);
    assert.ok(result.lineCount > 1);
    for (const point of result.strokes.flat()) assert.ok(point.x < 706 && point.y < 967);
    assert.equal(layoutText('W'.repeat(65), { ...options, style }).ok, true);
    assert.equal(layoutText('one\n'.repeat(22), { ...options, style }).ok, false);
    assert.equal(layoutText('W'.repeat(420), { ...options, style }).ok, false);
  }
});

test('pen follows emitted ink, lifts between strokes and is silent when paused or finished', () => {
  const engine = new WritingEngine(layoutText('Hi.', options), tool);
  assert.equal(engine.peek().contact, false);
  engine.start();
  let seenContact = false;
  let seenLift = false;
  let previousProgress = 0;
  for (let i = 0; i < 4000 && engine.status !== 'complete'; i++) {
    const frame = engine.tick(1 / 60);
    assert.ok(frame.pen.progress >= previousProgress);
    previousProgress = frame.pen.progress;
    if (frame.pen.contact && frame.segments.length) {
      seenContact = true;
      assert.deepEqual(frame.segments.at(-1).to, { x: frame.pen.x, y: frame.pen.y });
      assert.ok(frame.pen.speed > 0);
    }
    if (!frame.pen.contact) {
      seenLift = true;
      assert.equal(frame.pen.speed, 0);
    }
    if (i === 35) {
      engine.pause();
      const before = engine.peek();
      const paused = engine.tick(3);
      assert.equal(paused.pen.contact, false);
      assert.equal(paused.pen.speed, 0);
      assert.equal(paused.pen.progress, before.progress);
      assert.deepEqual(paused.segments, []);
      engine.resume();
    }
  }
  assert.ok(seenContact && seenLift);
  assert.equal(engine.status, 'complete');
  assert.equal(engine.peek().speed, 0);
  assert.equal(engine.peek().contact, false);
  assert.equal(engine.progress, 1);
  engine.reset();
  assert.equal(engine.status, 'idle');
  assert.equal(engine.progress, 0);
});

test('broad edge depends on angle while pointed flex depends on pressure', () => {
  const broad = { ...tool, nib: 'broad' };
  assert.equal(nibWidth(broad, 0.5, 0.1), nibWidth(broad, 0.5, 0.9));
  assert.notEqual(nibWidth(broad, 0.3, 0.5), nibWidth(broad, 1.3, 0.5));
  assert.ok(nibWidth(tool, 1, 0.9) > nibWidth(tool, 1, 0.1) * 2);
  assert.ok(nibWidth({ ...tool, pen: 'dip' }, 1, 0.9) > nibWidth(tool, 1, 0.9));
});

test('speed changes apply live and pause does not consume writing time', () => {
  const layout = layoutText('A gentle afternoon', options);
  const slow = new WritingEngine(layout, { ...tool, speed: 0.5 });
  const fast = new WritingEngine(layout, { ...tool, speed: 2 });
  slow.start();
  fast.start();
  slow.tick(2);
  fast.tick(2);
  assert.ok(fast.progress > slow.progress);
  slow.updateOptions({ ...tool, nib: 'broad', pen: 'dip', speed: 2 });
  slow.pause();
  const progress = slow.progress;
  slow.tick(2);
  assert.equal(slow.progress, progress);
  slow.resume();
  assert.equal(slow.tick(0.08).pen.contact, false);
});

test('legacy Hershey source data stays limited to the original two 94-glyph datasets', () => {
  assert.deepEqual(Object.keys(fonts), ['correspondence', 'print']);
  assert.equal(fonts.correspondence.name, 'Script 1-stroke');
  assert.equal(fonts.print.name, 'Sans 1-stroke');
  for (const font of Object.values(fonts)) {
    assert.equal(font.chars.length, 94);
    for (const glyph of font.chars) {
      assert.ok(Number.isFinite(glyph.o) && glyph.o > 0);
      assert.ok(parseStrokePath(glyph.d).every((stroke) => stroke.length >= 2));
    }
  }
  assert.equal(fonts.print.chars['A'.charCodeAt(0) - 33].d,
    'M9,1 L1,22 M9,1 L17,22 M4,15 L14,15');
});

test('path parsing preserves implicit line pairs, same-point moves and original order', () => {
  assert.deepEqual(parseStrokePath('M-1.5,2 3,4 5,6 M5,6 L7,8 M7,8 L9e0,10'), [
    [{ x: -1.5, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }],
    [{ x: 5, y: 6 }, { x: 7, y: 8 }],
    [{ x: 7, y: 8 }, { x: 9, y: 10 }],
  ]);
  assert.deepEqual(parseStrokePath('M1,2'), [[{ x: 1, y: 2 }]]);
  for (const path of ['M1,2 Q3,4 5,6', 'M1,2 Z', 'm1,2', 'L1,2', '1,2', 'M1', 'M1,2 L', 'M M1,2', 'M1e999,2']) {
    assert.throws(() => parseStrokePath(path), undefined, path);
  }
});

test('gentle smoothing preserves endpoints, sharp print corners and source bounds', () => {
  const corner = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  assert.deepEqual(smoothStroke(corner, false), corner);
  const curve = [{ x: 0, y: 0 }, { x: 6, y: 2 }, { x: 10, y: 8 }];
  for (const script of [false, true]) {
    const smoothed = smoothStroke(curve, script);
    assert.ok(smoothed.length > curve.length);
    assert.deepEqual(smoothed[0], curve[0]);
    assert.deepEqual(smoothed.at(-1), curve.at(-1));
    for (const p of smoothed) assert.ok(p.x >= 0 && p.x <= 10 && p.y >= 0 && p.y <= 8);
  }
});

test('all printable ASCII can coexist without lost letters or merged moves', () => {
  const text = Array.from({ length: 94 }, (_, index) => String.fromCharCode(index + 33)).join('');
  for (const style of ['correspondence', 'pangolin']) {
    const layout = layoutText(text, { ...options, style });
    assert.equal(layout.ok, true, layout.error);
    assert.equal(layout.characterCount, 94);
    assert.equal(layout.strokes.length, moves(style, text));
    assert.ok(layout.lineCount > 1);
  }
});

test('newlines normalize consistently and explicit blank lines consume capacity', () => {
  const normal = layoutText('Hello\n\nthere!\n', options);
  assert.deepEqual(layoutText('Hello\r\n\r\nthere!\r', options), normal);
  assert.equal(normal.characterCount, 'Hello\n\nthere!\n'.length);
  assert.equal(normal.lineCount, 4);
  assert.equal(layoutText('Hi\n'.repeat(13), options).ok, false);
});

test('length limit and physical capacity are separate atomic validations', () => {
  assert.equal(MAX_CHARACTERS, 20_000);
  for (const style of ['correspondence', 'pangolin']) {
    const narrow = layoutText('i'.repeat(420), { ...options, style });
    assert.equal(narrow.ok, true, narrow.error);
    assert.equal(narrow.characterCount, 420);
    assert.equal(narrow.strokes.length, moves(style, 'i'.repeat(420)));
    const crowded = layoutText('W'.repeat(420), { ...options, style });
    assert.equal(crowded.ok, false);
    assert.match(crowded.error, /end of the sheet/);
    assert.equal(crowded.characterCount, 420);
    assert.deepEqual(crowded.strokes, []);
    const beyondOldCap = layoutText('i'.repeat(421), { ...options, style });
    assert.equal(beyondOldCap.ok, true, beyondOldCap.error);
    const excessive = layoutText('i'.repeat(MAX_CHARACTERS + 1), { ...options, style });
    assert.match(excessive.error, /20000/);
    assert.deepEqual(excessive.strokes, []);
  }
});

test('non-ASCII and control characters give explicit errors, including invisible input', () => {
  for (const input of ['“Hello”', 'naïve', '\u00a0', '\0', '\u007f', 'a\tb', '你好', '🌱']) {
    const result = layoutText(input, options);
    assert.equal(result.ok, false);
    assert.match(result.error, /English ASCII/);
    assert.match(result.error, /U\+/);
    assert.deepEqual(result.strokes, []);
  }
});

test('invalid and undersized pages fail without emitting partial geometry', () => {
  for (const size of [
    { width: NaN }, { width: Infinity }, { height: Infinity }, { width: 0 },
    { height: -10 }, { width: 2 }, { height: 10 },
  ]) {
    const result = layoutText('Hello', { ...options, ...size });
    assert.equal(result.ok, false);
    assert.ok(result.error);
    assert.deepEqual(result.strokes, []);
  }
  assert.equal(layoutText('Hello', { ...options, style: 'unknown' }).ok, false);
});

test('word wrap keeps a fitting word whole and splits every glyph of a long word', () => {
  const page = { ...options, style: 'pangolin', width: 160 };
  const wrapped = layoutText('AAAA BBBB', page);
  const standalone = layoutText('BBBB', page);
  assert.equal(wrapped.ok, true);
  assert.equal(wrapped.lineCount, 2);
  const secondWord = wrapped.strokes.slice(moves(page.style, 'AAAA'));
  assert.equal(secondWord.length, standalone.strokes.length);
  for (let index = 0; index < secondWord.length; index++) {
    for (let vertex = 0; vertex < secondWord[index].length; vertex++) {
      near(secondWord[index][vertex].x, standalone.strokes[index][vertex].x);
      near(secondWord[index][vertex].y, standalone.strokes[index][vertex].y + handwritingFontData(page.style).lineHeight);
    }
  }
  const long = layoutText('W'.repeat(65), options);
  assert.equal(long.ok, true);
  assert.ok(long.lineCount > 1);
  assert.equal(long.strokes.length, moves('correspondence', 'W'.repeat(65)));
});

test('scaled page dimensions and overhanging descenders remain inside finite margins', () => {
  for (const style of ['correspondence', 'pangolin']) {
    for (const width of [160, 320, 780]) {
      const layout = layoutText('jf Q _ ~ jp', { ...options, width, style });
      assert.equal(layout.ok, true, layout.error);
      for (const p of layout.strokes.flat()) {
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
        assert.ok(p.x >= 3.5 && p.x <= width - 3.5);
        assert.ok(p.y >= 3.5 && p.y <= options.height - 3.5);
      }
    }
  }
});

test('idle, initial lowering and exact stroke-start boundaries cannot report contact', () => {
  const layout = line();
  const engine = new WritingEngine(layout, tool);
  const idle = engine.peek();
  assert.deepEqual(point(idle), layout.strokes[0][0]);
  assert.equal(idle.status, 'idle');
  assert.equal(idle.contact, false);
  assert.equal(idle.speed, 0);
  assert.ok(idle.lift > 0);
  engine.pause();
  engine.resume();
  assert.deepEqual(engine.peek(), idle);
  engine.start();
  engine.start();
  for (const delta of [0, 0.08, 0.08]) {
    const frame = engine.tick(delta);
    assert.deepEqual(frame.segments, []);
    assert.equal(frame.pen.contact, false);
    assert.equal(frame.pen.speed, 0);
    assert.ok(frame.pen.lift > 0);
    assert.deepEqual(point(frame.pen), layout.strokes[0][0]);
  }
  assert.equal(engine.tick(0.01).pen.contact, true);
});

test('even coincident M boundaries include a real pen-up dwell without a bridge', () => {
  const layout = fixture([
    [{ x: 10, y: 10 }, { x: 11, y: 10 }],
    [{ x: 11, y: 10 }, { x: 12, y: 10 }],
  ]);
  const engine = new WritingEngine(layout, tool);
  engine.start();
  engine.tick(0.16);
  for (let count = 0; engine.progress < 0.5 && count < 100; count++) engine.tick(0.001);
  near(engine.progress, 0.5);
  const lifted = engine.tick(0.03);
  assert.deepEqual(lifted.segments, []);
  assert.deepEqual(point(lifted.pen), { x: 11, y: 10 });
  assert.equal(lifted.pen.contact, false);
  assert.equal(lifted.pen.speed, 0);
  assert.equal(lifted.pen.pressure, 0);
  assert.ok(lifted.pen.lift > 0);
  const finish = engine.tick(1);
  assert.deepEqual(finish.segments[0].from, { x: 11, y: 10 });
  assert.equal(engine.status, 'complete');
});

test('pen-up travel actually moves across spaces while ink progress stays fixed', () => {
  const layout = fixture([
    [{ x: 10, y: 10 }, { x: 11, y: 10 }],
    [{ x: 81, y: 10 }, { x: 82, y: 10 }],
  ]);
  const engine = new WritingEngine(layout, tool);
  engine.start();
  engine.tick(0.16);
  for (let count = 0; engine.progress < 0.5 && count < 100; count++) engine.tick(0.001);
  const frame = engine.tick(0.11);
  near(frame.pen.progress, 0.5);
  assert.ok(frame.pen.x > 11 && frame.pen.x < 81);
  assert.deepEqual(frame.segments, []);
  assert.equal(frame.pen.contact, false);
  assert.equal(frame.pen.speed, 0);
  assert.ok(frame.pen.lift > 0);
  engine.pause();
  const paused = engine.peek();
  assert.deepEqual(engine.tick(50).pen, paused);
  engine.resume();
  assert.deepEqual(point(engine.tick(0.08).pen), point(paused));
  engine.tick(0.08);
  assert.deepEqual(point(engine.peek()), point(paused));
  const rest = engine.tick(2);
  assert.deepEqual(rest.segments[0].from, { x: 81, y: 10 });
  assert.ok(rest.segments.every((segment) => segment.from.x >= 81 && segment.to.x <= 82));
});

test('pause and resume preserve the exact pen position and continuous width', () => {
  const engine = new WritingEngine(line(), tool);
  engine.start();
  const writing = engine.tick(0.48);
  assert.equal(writing.pen.contact, true);
  const width = writing.segments.at(-1).toWidth;
  engine.pause();
  const paused = engine.peek();
  assert.equal(paused.contact, false);
  assert.equal(paused.pressure, 0);
  assert.equal(paused.speed, 0);
  assert.ok(paused.lift > 0);
  assert.deepEqual(point(paused), point(writing.pen));
  assert.deepEqual(engine.tick(100).segments, []);
  near(engine.progress, writing.pen.progress);
  engine.resume();
  assert.equal(engine.peek().contact, false);
  assert.deepEqual(point(engine.tick(0.08).pen), point(paused));
  const resumed = engine.tick(0.18);
  assert.deepEqual(resumed.segments[0].from, point(paused));
  near(resumed.segments[0].fromWidth, width);
  assert.ok(resumed.pen.progress > paused.progress);
});

test('large ticks consume all their time and agree with small ticks', () => {
  for (const layout of [line(1000), layoutText('Hi, little afternoon!', options)]) {
    const coarse = new WritingEngine(layout, tool);
    const fine = new WritingEngine(layout, tool);
    coarse.start();
    fine.start();
    const whole = coarse.tick(6.25);
    let last;
    for (let index = 0; index < 250; index++) last = fine.tick(0.025);
    near(coarse.progress, fine.progress);
    near(whole.pen.x, last.pen.x);
    near(whole.pen.y, last.pen.y);
    near(whole.pen.pressure, last.pen.pressure);
    assert.equal(coarse.status, fine.status);
    assert.equal(whole.pen.contact, last.pen.contact);
    if (whole.pen.contact) near(whole.segments.at(-1).toWidth, last.segments.at(-1).toWidth);
  }
});

test('contact speed is actual canvas distance per second and angle is its tangent', () => {
  const engine = new WritingEngine(line(), tool);
  engine.start();
  engine.tick(0.4);
  const before = engine.peek();
  const delta = 0.000001;
  const frame = engine.tick(delta);
  assert.equal(frame.segments.length, 1);
  const dx = frame.pen.x - before.x;
  const dy = frame.pen.y - before.y;
  near(Math.hypot(dx, dy) / delta, frame.pen.speed, 1e-5);
  near(frame.segments[0].speed, frame.pen.speed);
  near(Math.atan2(dy, dx), frame.pen.angle);
  assert.deepEqual(frame.segments[0].to, point(frame.pen));
});

test('movement has a gentle deterministic pace and subpixel-safe ink geometry', () => {
  const engine = new WritingEngine(line(180), tool);
  const speeds = [];
  const ink = [];
  engine.start();
  for (let tick = 0; engine.status !== 'complete' && tick < 1000; tick++) {
    const frame = engine.tick(1 / 120);
    if (frame.pen.contact) speeds.push(frame.pen.speed);
    ink.push(...frame.segments);
    for (const value of Object.values(frame.pen).filter((value) => typeof value === 'number')) {
      assert.ok(Number.isFinite(value));
    }
  }
  assert.equal(engine.status, 'complete');
  assert.ok(Math.max(...speeds) - Math.min(...speeds) > 5);
  assert.ok(Math.max(...speeds) < Math.min(...speeds) * 1.8);
  for (let index = 0; index < ink.length; index++) {
    const segment = ink[index];
    assert.ok(Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y) <= 1.400001);
    assert.ok(segment.fromWidth > 0 && segment.toWidth > 0);
    assert.ok(segment.pressure >= 0 && segment.pressure <= 1);
    if (index) {
      assert.deepEqual(segment.from, ink[index - 1].to);
      near(segment.fromWidth, ink[index - 1].toWidth);
    }
  }
});

test('nib models distinguish fixed chisel angle, restrained fine and pressure flex', () => {
  const broad = { ...tool, nib: 'broad' };
  const fine = { ...tool, nib: 'fine' };
  near(nibWidth(broad, 0.23, 0), nibWidth(broad, 0.23 + Math.PI, 1));
  assert.ok(nibWidth(broad, Math.PI * 0.75, 0.1) > nibWidth(broad, Math.PI * 0.25, 0.9) * 3);
  assert.ok(nibWidth(fine, 1, 1) / nibWidth(fine, 1, 0) < 1.3);
  assert.ok(nibWidth(tool, 1, 0.9) > nibWidth(tool, 1, 0.1) * 3);
  for (const nib of ['fine', 'broad', 'flex']) assert.ok(Number.isFinite(nibWidth({ ...tool, nib }, NaN, NaN)));
});

test('flex downstrokes are wider while the same broad edge remains direction symmetric', () => {
  const layout = fixture([[{ x: 80, y: 100 }, { x: 80, y: 210 }, { x: 80, y: 100 }]]);
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  for (const nib of ['fine', 'broad', 'flex']) {
    const engine = new WritingEngine(layout, { ...tool, nib });
    engine.start();
    const ink = engine.tick(20).segments;
    const center = ink.filter((segment) => segment.to.y > 130 && segment.to.y < 180);
    const down = mean(center.filter((segment) => segment.to.y > segment.from.y).map((segment) => segment.toWidth));
    const up = mean(center.filter((segment) => segment.to.y < segment.from.y).map((segment) => segment.toWidth));
    if (nib === 'flex') assert.ok(down > up * 2);
    if (nib === 'broad') near(down, up);
    if (nib === 'fine') assert.ok(Math.abs(down - up) < 0.2);
  }
});

test('live nib, holder and speed changes are continuous and do not reset progress', () => {
  const engine = new WritingEngine(line(400), { ...tool, nib: 'fine' });
  engine.start();
  const before = engine.tick(0.4);
  const previousWidth = before.segments.at(-1).toWidth;
  engine.updateOptions({ nib: 'broad', pen: 'dip', speed: 2 });
  assert.deepEqual(point(engine.peek()), point(before.pen));
  near(engine.progress, before.pen.progress);
  assert.equal(engine.status, 'writing');
  const changed = engine.tick(0.000001);
  near(changed.segments[0].fromWidth, previousWidth);
  assert.ok(changed.pen.speed > before.pen.speed * 1.9);
  const later = engine.tick(0.2);
  assert.ok(later.segments.at(-1).toWidth > previousWidth * 2);
});

test('completion emits the exact final endpoint once and then stays lifted and silent', () => {
  for (const layout of [line(0.001), layoutText('A final dot.', options)]) {
    const engine = new WritingEngine(layout, tool);
    engine.start();
    const frame = engine.tick(1000);
    const endpoint = layout.strokes.at(-1).at(-1);
    assert.equal(frame.pen.status, 'complete');
    assert.equal(frame.pen.contact, false);
    assert.equal(frame.pen.speed, 0);
    assert.equal(frame.pen.pressure, 0);
    assert.ok(frame.pen.lift > 0);
    assert.equal(engine.progress, 1);
    assert.deepEqual(point(frame.pen), endpoint);
    assert.deepEqual(frame.segments.at(-1).to, endpoint);
    engine.start();
    engine.pause();
    engine.resume();
    assert.deepEqual(engine.tick(100), { pen: frame.pen, segments: [] });
  }
});

test('reset reproduces a fresh traversal, including initial angle and retained settings', () => {
  const layout = layoutText('Reset, slowly.', options);
  const engine = new WritingEngine(layout, tool);
  engine.start();
  const firstRun = engine.tick(1.2);
  engine.tick(1000);
  engine.reset();
  assert.equal(engine.status, 'idle');
  assert.equal(engine.progress, 0);
  assert.equal(engine.peek().contact, false);
  assert.equal(engine.peek().speed, 0);
  assert.ok(engine.peek().lift > 0);
  assert.deepEqual(point(engine.peek()), layout.strokes[0][0]);
  engine.start();
  assert.deepEqual(engine.tick(1.2), firstRun);
  const updated = { nib: 'broad', pen: 'dip', speed: 2 };
  engine.updateOptions(updated);
  engine.reset();
  const fresh = new WritingEngine(layout, updated);
  engine.start();
  fresh.start();
  assert.deepEqual(engine.tick(0.8), fresh.tick(0.8));
});

test('invalid time cannot advance the engine and external mutation cannot corrupt it', () => {
  const layout = line();
  const engine = new WritingEngine(layout, tool);
  const initial = engine.peek();
  initial.x = Infinity;
  layout.strokes[0][0].x = Infinity;
  assert.equal(engine.peek().x, 40);
  engine.start();
  const before = engine.peek();
  for (const delta of [0, -1, NaN, Infinity, -Infinity]) {
    assert.deepEqual(engine.tick(delta), { pen: before, segments: [] });
  }
  engine.updateOptions({ ...tool, speed: NaN });
  assert.ok(engine.tick(0.5).pen.progress > 0);
  for (const invalid of [
    fixture([]), fixture([[{ x: NaN, y: 0 }, { x: 1, y: 1 }]]),
    fixture([[{ x: 0, y: 0 }, { x: 0, y: 0 }]]), layoutText('', options),
  ]) assert.throws(() => new WritingEngine(invalid, tool));
});
