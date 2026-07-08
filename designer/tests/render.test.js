import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickFontPx, font, barFill, barGeometry, pickThresholdColor, formatValue, formatRemaining,
  ringSweepDeg, arcIndicatorAngles, pointOnArc, arcPath, ringPaths, sparklinePoints, meterAngle, capArcPath, ledLit,
  resolveIcon, resolveState
} from '../js/render.js';
import * as render from '../js/render.js';

test('pickFontPx renvoie la taille exacte, clampée à [8,120] (Tiny TTF rend toute taille)', () => {
  assert.equal(pickFontPx(24), 24);
  assert.equal(pickFontPx(72), 72);
  assert.equal(pickFontPx(20), 20);
  assert.equal(pickFontPx(5), 8);     // sous le plancher → 8
  assert.equal(pickFontPx(200), 120); // au-dessus du plafond → 120
  assert.equal(pickFontPx(undefined), 20); // valeur absente → défaut 20
});

test('font() compose style/graisse/taille/famille CSS', () => {
  assert.equal(font('montserrat', false, false, 20), '20px Montserrat, system-ui, sans-serif');
  assert.equal(font('lora', true, false, 28), "700 28px Lora, system-ui, serif");
  assert.equal(font('jetbrains_mono', false, true, 14), "italic 14px 'JetBrains Mono', ui-monospace, monospace");
  assert.equal(font('inter', true, true, 36), "italic 700 36px Inter, system-ui, sans-serif");
  assert.equal(font('comic', false, false, 20), '20px Montserrat, system-ui, sans-serif'); // famille inconnue → montserrat
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

test('ringPaths : start_angle décale l’angle de départ (parité firmware 90 + start_angle + gap/2)', () => {
  assert.equal(ringPaths(80, 16, 70, 72, 0, 100).start, 125);              // défaut start_angle=0 : 90 + 70/2
  assert.equal(ringPaths(80, 16, 70, 72, 0, 100, 'normal', 30).start, 155); // 90 + 30 + 70/2
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

test('capArcPath : start_angle fait tourner l’ouverture (chemin différent, rayon médian inchangé)', () => {
  const d0 = capArcPath(80, 16, 70);
  const d  = capArcPath(80, 16, 70, 45);
  assert.notEqual(d, d0, 'un start_angle non nul décale l’arc du cap');
  assert.match(d, /A 72 72 /, 'rayon médian (r − th/2) inchangé');
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

test('resolveIcon : sans states -> base (symbol+color)', () => {
  const r = resolveIcon({ symbol: 'wifi', color: '#112233' }, 5);
  assert.deepEqual(r, { symbol: 'wifi', color: '#112233' });
});

test('resolveIcon : défauts bell/#FFFFFF quand base absente', () => {
  assert.deepEqual(resolveIcon({}, 0), { symbol: 'bell', color: '#FFFFFF' });
});

test('resolveIcon : 1re bande où value < at gagne (glyphe + couleur)', () => {
  const comp = { symbol: 'battery_full', color: '#00FF00',
    states: [{ at: 15, symbol: 'battery_empty', color: '#FF0000' },
             { at: 50, symbol: 'battery_2', color: '#FFAA00' }] };
  assert.deepEqual(resolveIcon(comp, 10), { symbol: 'battery_empty', color: '#FF0000' });
  assert.deepEqual(resolveIcon(comp, 30), { symbol: 'battery_2',     color: '#FFAA00' });
  assert.deepEqual(resolveIcon(comp, 90), { symbol: 'battery_full',  color: '#00FF00' });
  // exactement à la borne du dernier seuil : value < at est STRICT → la bande ne se déclenche pas (retombe sur la base)
  assert.deepEqual(resolveIcon(comp, 50), { symbol: 'battery_full',  color: '#00FF00' });
});

test('resolveIcon : champ omis dans une bande retombe sur la base', () => {
  const comp = { symbol: 'wifi', color: '#FFFFFF', states: [{ at: 1, color: '#888888' }] };
  assert.deepEqual(resolveIcon(comp, 0), { symbol: 'wifi', color: '#888888' });
  const comp2 = { symbol: 'wifi', color: '#FFFFFF', states: [{ at: 1, symbol: 'close' }] };
  assert.deepEqual(resolveIcon(comp2, 0), { symbol: 'close', color: '#FFFFFF' });
});

test('resolveState : exact string -> index du cas a cle string egale, sinon -1', () => {
  const comp = { match: 'exact', cases: [
    { key: 'Clear', symbol: 'weather-sunny' },
    { key: 'Rain', symbol: 'weather-pouring' },
    { key: 3, src: 'abc' }] };
  assert.equal(resolveState(comp, 'Clear'), 0);
  assert.equal(resolveState(comp, 'Rain'), 1);
  assert.equal(resolveState(comp, 'Snow'), -1);
});

test('resolveState : exact number -> index du cas a cle numerique egale', () => {
  const comp = { match: 'exact', cases: [
    { key: 'Clear', symbol: 'weather-sunny' },
    { key: 3, src: 'abc' }] };
  assert.equal(resolveState(comp, 3), 1);
  assert.equal(resolveState(comp, 9), -1);
});

test('resolveState : range -> 1er cas ou value < at (numerique seul)', () => {
  const comp = { match: 'range', cases: [{ at: 10 }, { at: 20 }] };
  assert.equal(resolveState(comp, 5), 0);
  assert.equal(resolveState(comp, 15), 1);
  assert.equal(resolveState(comp, 25), -1);
  assert.equal(resolveState(comp, 'x'), -1);
});

test('resolveState : doublon -> l ordre departage (1er gagne)', () => {
  const comp = { match: 'exact', cases: [{ key: 'A', symbol: 'x' }, { key: 'A', symbol: 'y' }] };
  assert.equal(resolveState(comp, 'A'), 0);
});

test('resolveState : match par defaut = exact ; cases absent -> -1', () => {
  assert.equal(resolveState({}, 'anything'), -1);
});

test('resolveState : le type de la valeur decide (cle string "3" != valeur nombre 3)', () => {
  const comp = { match: 'exact', cases: [{ key: '3', symbol: 'a' }, { key: 3, symbol: 'b' }] };
  assert.equal(resolveState(comp, 3), 1);     // nombre 3 -> cle numerique 3 (index 1), PAS la cle string "3"
  assert.equal(resolveState(comp, '3'), 0);   // string "3" -> cle string "3" (index 0), PAS la cle numerique
});

test('resolveState : range borne stricte (value === at ne matche pas)', () => {
  const comp = { match: 'range', cases: [{ at: 10 }, { at: 20 }] };
  assert.equal(resolveState(comp, 10), 1);    // 10 < 10 faux -> bande suivante (10 < 20) -> index 1
  assert.equal(resolveState(comp, 20), -1);   // 20 < 20 faux, aucune -> defaut
});

test('resolveState : cle absente traitee comme "" (parite firmware key_str="")', () => {
  const comp = { match: 'exact', cases: [{ symbol: 'bell' }, { key: 'x', symbol: 'y' }] };
  assert.equal(resolveState(comp, ''), 0);            // valeur "" -> cas sans cle (index 0), comme le firmware
  assert.equal(resolveState(comp, 'undefined'), -1);  // ne matche PLUS le litteral "undefined" (bug parite corrige)
  assert.equal(resolveState(comp, 'x'), 1);
});

test('render : buildSlider/buildArc/buildRoller/buildClock exportés', () => {
  assert.equal(typeof render.buildSlider, 'function');
  assert.equal(typeof render.buildArc, 'function');
  assert.equal(typeof render.buildRoller, 'function');
  assert.equal(typeof render.buildClock, 'function');
});

test('render : MOCKS a slider/arc/roller', () => {
  assert.ok('slider' in render.MOCKS);
  assert.ok('arc' in render.MOCKS);
  assert.ok('roller' in render.MOCKS);
});

// buildClock (assemblage DOM/SVG) suit la convention du fichier : non exécuté ici (pas de `document` dans
// l'environnement de test Node — aucun autre buildX du fichier n'est invoqué par les tests, cf. en-tête
// "les builders DOM sont vérifiés au navigateur"). Seule la partie pure (texte digital) est unitaire ici ;
// le rendu analog (aiguilles SVG) se vérifie au navigateur comme les autres widgets.
test('clockDigitalText : HH:MM, +secondes si show_seconds', () => {
  assert.equal(render.clockDigitalText({ show_seconds: false }), '10:10');
  assert.equal(render.clockDigitalText({ show_seconds: true }), '10:10:36');
});
