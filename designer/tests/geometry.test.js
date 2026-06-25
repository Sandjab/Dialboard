import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offsetFor, nearestAnchor, snapPlacement, placeAt, anchorGuide, snapToStep } from '../js/geometry.js';

const W = 120, H = 34;

test('widget centré → CENTER offset (0,0)', () => {
  // centre du widget (x+w/2, y+h/2) au centre écran (180,180) : x=120, y=163
  assert.deepEqual(offsetFor('CENTER', 120, 163, W, H), [0, 0]);
});

test('widget collé haut-centre → TOP_MID offset (0,0)', () => {
  assert.deepEqual(offsetFor('TOP_MID', 120, 0, W, H), [0, 0]);
});

test('nearestAnchor près du haut → TOP_MID', () => {
  assert.equal(nearestAnchor(120, 5, W, H), 'TOP_MID');
});

test("snap quand proche d'un ancrage → dx=dy=0", () => {
  const r = snapPlacement(120, 3, W, H, 16);
  assert.equal(r.anchor, 'TOP_MID');
  assert.equal(r.dx, 0); assert.equal(r.dy, 0); assert.equal(r.snapped, true);
});

test('pas de snap quand loin → ancrage et offset exacts', () => {
  const r = snapPlacement(120, 60, W, H, 16);
  assert.equal(r.snapped, false);
  assert.equal(r.anchor, 'TOP_MID');
  assert.deepEqual([r.dx, r.dy], offsetFor('TOP_MID', 120, 60, W, H));
});

test("placeAt est l'inverse de offsetFor (round-trip)", () => {
  const [dx, dy] = offsetFor('TOP_MID', 100, 50, W, H);
  const { x, y } = placeAt('TOP_MID', dx, dy, W, H);
  assert.equal(Math.round(x), 100);
  assert.equal(Math.round(y), 50);
});

test('offsetFor/placeAt round-trip sur un coin (BOTTOM_RIGHT)', () => {
  const [dx, dy] = offsetFor('BOTTOM_RIGHT', 300, 300, 80, 40); // offset non nul attendu
  const { x, y } = placeAt('BOTTOM_RIGHT', dx, dy, 80, 40);
  assert.equal(x, 300); assert.equal(y, 300);
});

test('nearestAnchor près du coin bas-droit → BOTTOM_RIGHT', () => {
  // coin bas-droit du widget proche de (360,360)
  assert.equal(nearestAnchor(275, 315, 80, 40), 'BOTTOM_RIGHT');
});

test('anchorGuide : widget sur l’ancre → segment nul (from == to)', () => {
  const g = anchorGuide('CENTER', 120, 163, W, H);   // widget centré → point d'ancrage au centre écran
  assert.deepEqual(g.from, [180, 180]);
  assert.deepEqual(g.to, [180, 180]);
});

test('anchorGuide : widget décalé → from = point d’ancrage du widget, to = ancre parent', () => {
  const g = anchorGuide('TOP_MID', 100, 50, W, H);
  assert.deepEqual(g.from, [160, 50]);   // (x+w/2, y) pour TOP_MID
  assert.deepEqual(g.to, [180, 0]);      // parentPoint(TOP_MID)
});

test('anchorGuide : coin BOTTOM_RIGHT → from = coin bas-droit du widget', () => {
  const g = anchorGuide('BOTTOM_RIGHT', 300, 300, 80, 40);
  assert.deepEqual(g.from, [380, 340]);  // (x+w, y+h)
  assert.deepEqual(g.to, [360, 360]);    // parentPoint(BOTTOM_RIGHT)
});

import {
  resizeBox, ringRadiusAt, ringThicknessAt, gapDegAt, cornersOutsideCircle
} from '../js/geometry.js';

test('resizeBox agrandit selon le delta pointeur', () => {
  assert.deepEqual(resizeBox(200, 16, 40, 10), { width: 240, height: 26 });
});

test('resizeBox clampe au minimum', () => {
  assert.deepEqual(resizeBox(200, 16, -1000, -1000, 8), { width: 8, height: 8 });
});

test('ringRadiusAt = distance centre→pointeur', () => {
  assert.equal(ringRadiusAt(180, 0), 180); // centre (180,180), pointeur en haut → 180
});

test('ringThicknessAt = rayon − distance centre→pointeur', () => {
  assert.equal(ringThicknessAt(180, 30, 176), 26); // dist=150, 176-150=26
});

test('gapDegAt = 0 quand le pointeur est droit en bas', () => {
  assert.equal(gapDegAt(180, 300), 0);
});

test('gapDegAt = 2× écart à la verticale basse', () => {
  assert.equal(gapDegAt(130, 230), 90); // angle 135°, |135−90|=45, ×2=90
});

test('gapDegAt = 180 quand le pointeur est droit en haut', () => {
  assert.equal(gapDegAt(180, 60), 180); // dist=120, atan2(-120,0)=-90°, |−90−90|=180
});

test('cornersOutsideCircle : boîte centrée → dedans', () => {
  assert.equal(cornersOutsideCircle(160, 170, 40, 20), false);
});

test('cornersOutsideCircle : coin TOP_LEFT → dehors (écran rond)', () => {
  assert.equal(cornersOutsideCircle(0, 0, 40, 20), true);
});

test('snapToStep désactivé → identité', () => {
  assert.equal(snapToStep(13, 8, false), 13);
});

test('snapToStep step<=0 → identité (garde-fou)', () => {
  assert.equal(snapToStep(13, 0, true), 13);
  assert.equal(snapToStep(13, -8, true), 13);
});

test('snapToStep arrondit au pas le plus proche', () => {
  assert.equal(snapToStep(11, 8, true), 8);    // 1.375 → 1 → 8
  assert.equal(snapToStep(12, 8, true), 16);   // 1.5 → 2 → 16
  assert.equal(snapToStep(13, 8, true), 16);   // 1.625 → 2 → 16
});

test('snapToStep gère les négatifs', () => {
  assert.equal(snapToStep(-5, 4, true), -4);   // round(-1.25) = -1 → -4
});
