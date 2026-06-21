import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickFontPx, barFill, barGeometry, pickThresholdColor, formatValue, formatRemaining,
  ringSweepDeg, arcIndicatorAngles, pointOnArc, arcPath, ringPaths, sparklinePoints, meterAngle, capArcPath, ledLit
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

test('ledLit : allumé si value >= off_below (limite incluse)', () => {
  assert.equal(ledLit(0, 1), false);
  assert.equal(ledLit(1, 1), true);   // limite incluse
  assert.equal(ledLit(5, 1), true);
  assert.equal(ledLit(0, 0), true);   // off_below 0 → toujours allumé
});

test('capArcPath : arc inférieur symétrique, rayon r−th/2 (milieu de bande)', () => {
  const d = capArcPath(80, 16, 70);            // r=80, th=16 → arc médian rayon 72
  const m = d.match(/^M ([\d.]+) ([\d.]+) A 72 72 0 0 0 ([\d.]+) ([\d.]+)$/);
  assert.ok(m, `path inattendu : ${d}`);
  const [x1, y1, x2, y2] = [m[1], m[2], m[3], m[4]].map(Number);
  assert.ok(Math.abs((x1 + x2) / 2 - 80) < 1e-6, 'extrémités symétriques autour du centre (x=r)');
  assert.ok(Math.abs(y1 - y2) < 1e-6, 'extrémités à même hauteur');
  assert.ok(y1 > 80, 'baseline dans la moitié basse (y > r)');
});

test('barGeometry normal : du bord (0) à la fraction', () => {
  assert.deepEqual(barGeometry(60, 0, 100, 'normal'), { start: 0, len: 0.6 });
  assert.deepEqual(barGeometry(150, 0, 100, 'normal'), { start: 0, len: 1 });
});

test('barGeometry symmetrical : entre la position du 0 et la valeur (min négatif)', () => {
  assert.deepEqual(barGeometry(0, -100, 100, 'symmetrical'),  { start: 0.5,  len: 0 });    // pile sur le 0
  assert.deepEqual(barGeometry(50, -100, 100, 'symmetrical'), { start: 0.5,  len: 0.25 }); // 0.5 → 0.75
  assert.deepEqual(barGeometry(-50, -100, 100, 'symmetrical'),{ start: 0.25, len: 0.25 }); // 0.25 → 0.5 (à gauche du 0)
});

test('arcIndicatorAngles normal : depuis start, sweep horaire', () => {
  assert.deepEqual(arcIndicatorAngles('normal', 125, 290, 0.5), { startDeg: 125, sweepDeg: 145 });
});

test('arcIndicatorAngles reverse : ancré sur le max, même longueur', () => {
  assert.deepEqual(arcIndicatorAngles('reverse', 125, 290, 0.25),
    { startDeg: 125 + 0.75 * 290, sweepDeg: 0.25 * 290 });
});

test('arcIndicatorAngles symmetrical : grandit depuis le milieu de l’arc', () => {
  const mid = 125 + 290 / 2;
  assert.deepEqual(arcIndicatorAngles('symmetrical', 125, 290, 0.5),  { startDeg: mid, sweepDeg: 0 });
  assert.deepEqual(arcIndicatorAngles('symmetrical', 125, 290, 0.75), { startDeg: mid, sweepDeg: 0.25 * 290 });
  assert.deepEqual(arcIndicatorAngles('symmetrical', 125, 290, 0.25),
    { startDeg: 125 + 0.25 * 290, sweepDeg: 0.25 * 290 });   // à gauche du milieu
});

test('ringPaths : reverse garde le même fond mais inverse l’indicateur', () => {
  const norm = ringPaths(80, 16, 70, 50, 0, 100, 'normal');
  const rev  = ringPaths(80, 16, 70, 50, 0, 100, 'reverse');
  assert.equal(norm.track, rev.track);             // fond identique
  assert.notEqual(norm.indicator, rev.indicator);  // remplissage à l’opposé
});
