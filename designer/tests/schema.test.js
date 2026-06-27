import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createValidator } from '../js/validate.js';

const schema = JSON.parse(
  readFileSync(new URL('../../schema/layout.schema.json', import.meta.url))
);
const validate = createValidator(schema);

// Layout minimal valide réutilisé par les cas (un composant + une page).
function base() {
  return {
    components: { t: { type: 'readout', unit: 'C' } },
    pages: [{ name: 'P1', place: [{ ref: 't', anchor: 'CENTER' }] }]
  };
}

test('schema : sources top-level valides (url/interval/headers/vars)', () => {
  const l = base();
  l.sources = [{
    name: 'weather',
    url: 'https://api.example/w?city=Paris',
    interval_s: 600,
    headers: { 'X-API-Key': '$weather_key' },
    vars: { temp: '/main/temp' }
  }];
  const r = validate(l);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('schema : une source sans url est rejetée', () => {
  const l = base();
  l.sources = [{ name: 'bad', interval_s: 600 }];
  assert.equal(validate(l).valid, false);
});

test('schema : interval_s sous le plancher 5 est rejeté', () => {
  const l = base();
  l.sources = [{ url: 'http://x', interval_s: 2 }];
  assert.equal(validate(l).valid, false);
});

test('schema : champ bind accepté sur un composant data', () => {
  const l = base();
  l.components.t.bind = 'temp';
  const r = validate(l);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('schema : secrets top-level reste interdit (write-only, hors layout)', () => {
  const l = base();
  l.secrets = { weather_key: 'xxx' };
  assert.equal(validate(l).valid, false);
});

test('schema : composant chart valide (points + bind)', () => {
  const l = base();
  l.components.g = { type: 'chart', color: '#38BDF8', min: 0, max: 100, points: 30, bind: 'cpu' };
  l.pages[0].place.push({ ref: 'g', anchor: 'CENTER', width: 200, height: 100 });
  const r = validate(l);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('schema : composant meter valide (thresholds + bind)', () => {
  const l = base();
  l.components.m = {
    type: 'meter', color: '#38BDF8', min: 0, max: 100,
    thresholds: [[50, '#22C55E'], [80, '#F59E0B']], bind: 'temp'
  };
  l.pages[0].place.push({ ref: 'm', anchor: 'CENTER', width: 160, height: 160 });
  const r = validate(l);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('schema : propriete inconnue sur un chart est rejetee', () => {
  const l = base();
  l.components.g = { type: 'chart', wat: 1 };
  l.pages[0].place.push({ ref: 'g' });
  assert.equal(validate(l).valid, false);
});

test('schema : bar avec style de label (couleur/police/alignement) valide', () => {
  const l = base();
  l.components.b = { type: 'bar', label: 'RAM', label_color: '#FF0000', label_font: 20, label_align: 'BOTTOM_MID' };
  l.pages[0].place.push({ ref: 'b', anchor: 'CENTER', width: 200, height: 16 });
  const r = validate(l);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('schema : bar label_align = CENTER rejeté (8 positions extérieures seulement)', () => {
  const l = base();
  l.components.b = { type: 'bar', label_align: 'CENTER' };
  l.pages[0].place.push({ ref: 'b' });
  assert.equal(validate(l).valid, false);
});

test('schema : bar label_font hors domaine 8-120 rejeté', () => {
  const l = base();
  l.components.b = { type: 'bar', label_font: 200 };
  l.pages[0].place.push({ ref: 'b' });
  assert.equal(validate(l).valid, false);
});

test('schema : bar avec seuils + mode + orientation + anim_ms valide', () => {
  const l = base();
  l.components.b = { type: 'bar', min: -100, max: 100, mode: 'symmetrical', orientation: 'vertical',
    anim_ms: 300, thresholds: [[20, '#EF4444'], [80, '#22C55E']] };
  l.pages[0].place.push({ ref: 'b', anchor: 'CENTER', width: 16, height: 200 });
  const r = validate(l);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('schema : bar mode hors enum rejeté (range non supporté)', () => {
  const l = base();
  l.components.b = { type: 'bar', mode: 'range' };   // range exigerait start_value -> hors scope
  l.pages[0].place.push({ ref: 'b' });
  assert.equal(validate(l).valid, false);
});

test('schema : ring avec mode + rounded valide', () => {
  const l = base();
  l.components.g = { type: 'ring', mode: 'reverse', rounded: false };
  l.pages[0].place.push({ ref: 'g', radius: 140 });
  const r = validate(l);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('schema : ring mode hors enum rejeté', () => {
  const l = base();
  l.components.g = { type: 'ring', mode: 'wat' };
  l.pages[0].place.push({ ref: 'g', radius: 140 });
  assert.equal(validate(l).valid, false);
});

test('schema : composant image valide (src/w/h)', () => {
  const l = base();
  l.components.logo = { type: 'image', src: 'deadbeef', w: 120, h: 80 };
  l.pages[0].place.push({ ref: 'logo', anchor: 'TOP_LEFT' });
  const r = validate(l);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('schema : composant image — propriété inconnue rejetée', () => {
  const l = base();
  l.components.logo = { type: 'image', src: 'deadbeef', zoom: 2 };
  l.pages[0].place.push({ ref: 'logo', anchor: 'CENTER' });
  assert.equal(validate(l).valid, false);
});

test('schema : image_anim valide (src/w/h/frames/period/loop/autoplay)', () => {
  const l = base();
  l.components.sp = { type: 'image_anim', src: 'abcd1234', w: 64, h: 64, frames: 6, period: 80, rest_frame: 2, loop: 3, autoplay: true };
  l.pages[0].place.push({ ref: 'sp', anchor: 'CENTER' });
  const r = validate(l);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('schema : image_anim rejette frames > 32', () => {
  const l = base();
  l.components.sp = { type: 'image_anim', src: 'abcd1234', w: 64, h: 64, frames: 99 };
  l.pages[0].place.push({ ref: 'sp', anchor: 'CENTER' });
  assert.equal(validate(l).valid, false);
});

test('validate : image_anim au-dela du plafond memoire -> erreur', () => {
  const l = base();
  // 360*360*3*8 = 3 110 400 octets > 1 572 864
  l.components.sp = { type: 'image_anim', src: 'abcd1234', w: 360, h: 360, frames: 8 };
  l.pages[0].place.push({ ref: 'sp', anchor: 'CENTER' });
  const r = validate(l);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => /pack trop gros|trop de frames/.test(e)));
});

test('schema : comp_ring accepte cap_prefix ASCII', () => {
  const l = base();
  l.components = { g: { type: 'ring', cap_prefix: 'RST ' } };
  l.pages = [{ name: 'P1', place: [{ ref: 'g', radius: 140 }] }];
  const r = validate(l);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('schema : comp_ring cap_prefix non-ASCII rejeté', () => {
  const l = base();
  l.components = { g: { type: 'ring', cap_prefix: 'café' } };
  l.pages = [{ name: 'P1', place: [{ ref: 'g', radius: 140 }] }];
  assert.equal(validate(l).valid, false);
});

test('schema : ring accepte pill ET center_pct ensemble (plus d’exclusivité)', () => {
  const l = base();
  l.components.g = { type: 'ring', pill: true, center_pct: true };
  l.pages[0].place.push({ ref: 'g', radius: 140 });
  const r = validate(l);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('schema : composant led valide (off_below + thresholds + bind)', () => {
  const l = { components: { l1: { type: 'led', color: '#22C55E', off_below: 1,
             thresholds: [[1, '#EF4444']], bind: 'online' } },
             pages: [{ name: 'P', place: [{ ref: 'l1', anchor: 'CENTER', size: 24 }] }] };
  const r = validate(l);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('schema : led avec booléens de look valide', () => {
  const l = { components: { l1: { type: 'led', glow: true, bezel: false, specular: true, off_glass: false } },
             pages: [{ name: 'P', place: [{ ref: 'l1' }] }] };
  const r = validate(l);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('schema : booléen de look inconnu sur un led rejeté', () => {
  const l = { components: { l1: { type: 'led', sparkle: true } },
             pages: [{ name: 'P', place: [{ ref: 'l1' }] }] };
  assert.equal(validate(l).valid, false);
});

test('schema : visible:false accepté sur un composant visuel (bar)', () => {
  const l = base();
  l.components.b = { type: 'bar', visible: false };
  l.pages[0].place.push({ ref: 'b', anchor: 'CENTER', width: 200, height: 16 });
  const r = validate(l);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('schema : visible non booléen rejeté', () => {
  const l = base();
  l.components.b = { type: 'bar', visible: 'oui' };
  l.pages[0].place.push({ ref: 'b' });
  assert.equal(validate(l).valid, false);
});

test('schema : visible interdit sur sound (non visuel)', () => {
  const l = base();
  l.components.s = { type: 'sound' };                  // contrôle : sound seul est valide
  assert.equal(validate(l).valid, true, JSON.stringify(validate(l).errors));
  l.components.s.visible = false;                      // avec visible : rejeté (additionalProperties:false)
  assert.equal(validate(l).valid, false);
});

test('schema : visible interdit sur led_ring (non visuel)', () => {
  const l = base();
  l.components.lr = { type: 'led_ring' };
  assert.equal(validate(l).valid, true, JSON.stringify(validate(l).errors));
  l.components.lr.visible = false;
  assert.equal(validate(l).valid, false);
});

test('schema : led_ring accepte mode + period_ms', () => {
  const l = base();
  l.components.r = { type: 'led_ring', color: '#FF9F40', brightness: 120, mode: 'breathe', period_ms: 2500 };
  const r = validate(l);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('schema : led_ring rejette un mode inconnu', () => {
  const l = base();
  l.components.r = { type: 'led_ring', mode: 'rainbow' };
  assert.equal(validate(l).valid, false);
});

test('schema : led_ring rejette value (mock, hors layout)', () => {
  const l = base();
  l.components.r = { type: 'led_ring', value: 50 };
  assert.equal(validate(l).valid, false);
});

test('schema : led_ring rejette period_ms hors bornes', () => {
  const l = base();
  l.components.r = { type: 'led_ring', period_ms: 50 };
  assert.equal(validate(l).valid, false);
});

test('schema : font accepte une taille hors anciens paliers (Tiny TTF)', () => {
  const l = base();
  l.components.t = { type: 'readout', unit: 'C', font: 24 };
  assert.equal(validate(l).valid, true, JSON.stringify(validate(l).errors));
});

test('schema : font hors domaine 8-120 rejeté', () => {
  const lo = base(); lo.components.t = { type: 'readout', font: 5 };
  assert.equal(validate(lo).valid, false);
  const hi = base(); hi.components.t = { type: 'readout', font: 200 };
  assert.equal(validate(hi).valid, false);
});
