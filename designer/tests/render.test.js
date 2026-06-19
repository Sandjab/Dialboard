import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickFontPx, barFill, pickThresholdColor, formatValue, formatRemaining,
  ringSweepDeg, pointOnArc, arcPath, ringPaths, sparklinePoints, meterAngle
} from '../js/render.js';

test('pickFontPx retombe sur les 5 tailles LVGL', () => {
  assert.equal(pickFontPx(48), 48);
  assert.equal(pickFontPx(36), 36);
  assert.equal(pickFontPx(28), 28);
  assert.equal(pickFontPx(20), 20);
  assert.equal(pickFontPx(14), 14);
  assert.equal(pickFontPx(40), 36); // entre 36 et 48 → 36
  assert.equal(pickFontPx(27), 20); // entre 20 et 28 → 20
  assert.equal(pickFontPx(11), 14); // toute autre valeur → 14
});

test('barFill = fraction clampée', () => {
  assert.equal(barFill(60, 0, 100), 0.6);
  assert.equal(barFill(150, 0, 100), 1);
  assert.equal(barFill(-5, 0, 100), 0);
  assert.equal(barFill(5, 0, 0), 0); // garde anti division par zéro
});

test('pickThresholdColor : 1er seuil dont value < limite, sinon base', () => {
  const th = [[20, '#FF0000'], [50, '#FFAA00']];
  assert.equal(pickThresholdColor(th, 10, '#00FF00'), '#FF0000');
  assert.equal(pickThresholdColor(th, 30, '#00FF00'), '#FFAA00');
  assert.equal(pickThresholdColor(th, 80, '#00FF00'), '#00FF00');
  assert.equal(pickThresholdColor(undefined, 80, '#00FF00'), '#00FF00');
});

test('formatValue : entier brut, sinon 1 décimale, + unité', () => {
  assert.equal(formatValue(42, '%'), '42 %');
  assert.equal(formatValue(3.14, ''), '3.1');
  assert.equal(formatValue(10, ''), '10');
});

test('formatRemaining miroir du firmware', () => {
  assert.equal(formatRemaining(0), '0s');
  assert.equal(formatRemaining(45), '45s');
  assert.equal(formatRemaining(90), '1m');
  assert.equal(formatRemaining(3661), '1h01');
  assert.equal(formatRemaining(90000), '1j1h');
});

test('ringSweepDeg = fraction × (360 − gap)', () => {
  assert.equal(ringSweepDeg(50, 0, 100, 70), 145);
});

test('pointOnArc : 90° = bas (y vers le bas)', () => {
  const [x, y] = pointOnArc(180, 180, 100, 90);
  assert.ok(Math.abs(x - 180) < 1e-9);
  assert.ok(Math.abs(y - 280) < 1e-9);
});

test('arcPath : quart de cercle déterministe', () => {
  assert.equal(arcPath(0, 0, 100, 0, 90), 'M 100.00 0.00 A 100 100 0 0 1 0.00 100.00');
});

test('ringPaths expose rayon de tracé et angle de départ', () => {
  const p = ringPaths(80, 16, 70, 72, 0, 100);
  assert.equal(p.rr, 72);     // 80 − 16/2
  assert.equal(p.start, 125); // 90 + 70/2
  assert.ok(p.track.startsWith('M'));
  assert.ok(p.indicator.startsWith('M'));
});

test('sparklinePoints : points SVG normalises (x reparti, y inverse)', () => {
  assert.equal(sparklinePoints([0, 50, 100], 0, 100, 100, 100),
    '0.00,100.00 50.00,50.00 100.00,0.00');
  assert.equal(sparklinePoints([], 0, 100, 100, 100), '');
  assert.equal(sparklinePoints([42], 0, 100, 100, 100), '0.00,58.00'); // 1 point : x=0, y=100-0.42*100
});

test('meterAngle : 270° de 135° (min) a 405° (max), convention pointOnArc', () => {
  assert.equal(meterAngle(0, 0, 100), 135);
  assert.equal(meterAngle(50, 0, 100), 270);
  assert.equal(meterAngle(100, 0, 100), 405);
});
