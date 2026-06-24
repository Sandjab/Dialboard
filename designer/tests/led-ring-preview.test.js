import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledFrame, ledFrameAt, LED_RING_COUNT } from '../js/led-ring-preview.js';

const lit = f => f.on.filter(Boolean).length;

test('ledFrame : off → 0 LED', () => {
  assert.equal(lit(ledFrame({ mode: 'off' })), 0);
});
test('ledFrame : solid → 13 LEDs', () => {
  assert.equal(lit(ledFrame({ mode: 'solid' })), LED_RING_COUNT);
});
test('ledFrame : progress 62% → 8/13 (round)', () => {
  assert.equal(lit(ledFrame({ mode: 'progress' }, { value: 62 })), 8);
});
test('ledFrame : progress borné 0..100', () => {
  assert.equal(lit(ledFrame({ mode: 'progress' }, { value: 999 })), LED_RING_COUNT);
  assert.equal(lit(ledFrame({ mode: 'progress' }, { value: -5 })), 0);
});
test('ledFrame : spinner → 1 tête', () => {
  assert.equal(lit(ledFrame({ mode: 'spinner' })), 1);
});
test('ledFrame : brightness → alpha (0..1)', () => {
  assert.equal(ledFrame({ mode: 'solid', brightness: 255 }).alpha, 1);
  assert.equal(ledFrame({ mode: 'solid', brightness: 0 }).alpha, 0);
});
test('ledFrame : couleur par défaut blanche', () => {
  assert.equal(ledFrame({ mode: 'solid' }).color, '#FFFFFF');
});
test('ledFrameAt : spinner avance dans le temps (miroir firmware)', () => {
  const c = { mode: 'spinner', period_ms: 1300 };
  const f0 = ledFrameAt(c, {}, 0);
  const fMid = ledFrameAt(c, {}, 650);
  assert.equal(lit(f0), 1);
  assert.equal(lit(fMid), 1);
  assert.notDeepEqual(f0.on, fMid.on);
});
test('ledFrameAt : blink éteint à la moitié de la période', () => {
  const c = { mode: 'blink', period_ms: 1000 };
  assert.equal(lit(ledFrameAt(c, {}, 100)), LED_RING_COUNT);  // 1re moitié = on
  assert.equal(lit(ledFrameAt(c, {}, 600)), 0);               // 2e moitié = off
});
test('ledFrameAt : breathe à mi-période ~ pleine intensité', () => {
  const c = { mode: 'breathe', period_ms: 1000, brightness: 255 };
  const a = ledFrameAt(c, {}, 500).alpha;   // 0.5*(1-cos(pi)) = 1
  assert.ok(a > 0.99, `alpha ${a}`);
});
