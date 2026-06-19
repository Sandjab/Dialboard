import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  uniqueId, addComponent, addPlacement, removePlacement,
  setComponentProp, setPlacementProp, setThresholds,
  addPage, removePage, renamePage, reorderPages, uniquePageName, pageNameTaken,
  setPageBackground, effectivePageBg,
  setPageBackgroundImage, effectivePageBgImage
} from '../js/mutations.js';

const fresh = () => ({ components: {}, pages: [{ name: 'P1', place: [] }] });

test('uniqueId incrémente par type', () => {
  const s = fresh();
  assert.equal(uniqueId(s, 'label'), 'label1');
  s.components.label1 = { type: 'label' };
  assert.equal(uniqueId(s, 'label'), 'label2');
});

test('uniquePageName : aucune collision « Page N » → Page 1', () => {
  assert.equal(uniquePageName({ pages: [{ name: 'Accueil' }] }), 'Page 1');
});

test('uniquePageName : incrémente au-delà des « Page N » existants', () => {
  assert.equal(uniquePageName({ pages: [{ name: 'Page 1' }, { name: 'Page 2' }] }), 'Page 3');
});

test('uniquePageName : réutilise un trou (Page 2 libre)', () => {
  assert.equal(uniquePageName({ pages: [{ name: 'Page 1' }, { name: 'Page 3' }] }), 'Page 2');
});

test('uniquePageName : évite un nom auto saisi à la main au renommage', () => {
  // renommage manuel libre, mais la création suivante ne doit pas entrer en collision
  assert.equal(uniquePageName({ pages: [{ name: 'Page 1' }, { name: 'Page 1' }] }), 'Page 2');
});

test('uniquePageName : state sans pages → Page 1', () => {
  assert.equal(uniquePageName({}), 'Page 1');
});

test('pageNameTaken : nom porté par une autre page → true', () => {
  assert.equal(pageNameTaken({ pages: [{ name: 'A' }, { name: 'B' }] }, 'B', 0), true);
});

test('pageNameTaken : la page elle-même (exceptIndex) ne compte pas → false', () => {
  assert.equal(pageNameTaken({ pages: [{ name: 'A' }, { name: 'B' }] }, 'B', 1), false);
});

test('pageNameTaken : nom libre → false', () => {
  assert.equal(pageNameTaken({ pages: [{ name: 'A' }, { name: 'B' }] }, 'C', 0), false);
});

test('pageNameTaken : comparaison exacte (casse, comme le strcmp firmware)', () => {
  assert.equal(pageNameTaken({ pages: [{ name: 'Vue CPU' }, { name: 'X' }] }, 'vue cpu', 1), false);
});

test('setPageBackground : définit l’override de la page', () => {
  const s = fresh();
  setPageBackground(s, 0, '#102030');
  assert.equal(s.pages[0].background, '#102030');
});

test('setPageBackground : vide/null supprime l’override (héritage)', () => {
  const s = fresh(); s.pages[0].background = '#102030';
  setPageBackground(s, 0, null);
  assert.equal('background' in s.pages[0], false);
});

test('setPageBackground : index invalide → no-op (pas de throw)', () => {
  const s = fresh();
  assert.doesNotThrow(() => setPageBackground(s, 9, '#FFFFFF'));
});

test('effectivePageBg : override de la page prioritaire', () => {
  const s = { background: '#0B0B0F', pages: [{ name: 'P1', place: [], background: '#102030' }] };
  assert.equal(effectivePageBg(s, 0), '#102030');
});

test('effectivePageBg : sans override → fond global', () => {
  const s = { background: '#0B0B0F', pages: [{ name: 'P1', place: [] }] };
  assert.equal(effectivePageBg(s, 0), '#0B0B0F');
});

test('effectivePageBg : sans override ni global → #000000', () => {
  assert.equal(effectivePageBg({ pages: [{ name: 'P1', place: [] }] }, 0), '#000000');
});

test('setPageBackgroundImage : pose la clé', () => {
  const s = fresh();
  setPageBackgroundImage(s, 0, 'abc123');
  assert.equal(s.pages[0].background_image, 'abc123');
});

test('setPageBackgroundImage : vide/null supprime la clé', () => {
  const s = fresh(); s.pages[0].background_image = 'abc123';
  setPageBackgroundImage(s, 0, null);
  assert.equal('background_image' in s.pages[0], false);
});

test('setPageBackgroundImage : index invalide → no-op (pas de throw)', () => {
  const s = fresh();
  assert.doesNotThrow(() => setPageBackgroundImage(s, 9, 'abc123'));
});

test('effectivePageBgImage : clé de la page', () => {
  const s = { pages: [{ name: 'P1', place: [], background_image: 'abc123' }] };
  assert.equal(effectivePageBgImage(s, 0), 'abc123');
});

test('effectivePageBgImage : sans clé → null (pas de fond image global)', () => {
  const s = { pages: [{ name: 'P1', place: [] }] };
  assert.equal(effectivePageBgImage(s, 0), null);
});

test('addComponent ajoute à la map components', () => {
  const s = fresh();
  addComponent(s, 'x', { type: 'label', text: 'Hi' });
  assert.deepEqual(s.components.x, { type: 'label', text: 'Hi' });
});

test('addPlacement pousse sur la page', () => {
  const s = fresh();
  addPlacement(s, 0, { ref: 'x', anchor: 'CENTER' });
  assert.equal(s.pages[0].place.length, 1);
  assert.equal(s.pages[0].place[0].ref, 'x');
});

test('removePlacement retire par index', () => {
  const s = fresh();
  s.pages[0].place = [{ ref: 'a' }, { ref: 'b' }];
  removePlacement(s, 0, 0);
  assert.deepEqual(s.pages[0].place.map(p => p.ref), ['b']);
});

test('setComponentProp pose une valeur, vide la supprime', () => {
  const s = fresh();
  s.components.x = { type: 'label' };
  setComponentProp(s, 'x', 'text', 'Hi');
  assert.equal(s.components.x.text, 'Hi');
  setComponentProp(s, 'x', 'text', '');
  assert.equal('text' in s.components.x, false);
});

test('setPlacementProp pose une valeur, vide la supprime', () => {
  const s = fresh();
  s.pages[0].place = [{ ref: 'x', dx: 5 }];
  setPlacementProp(s, 0, 0, 'dy', 12);
  assert.equal(s.pages[0].place[0].dy, 12);
  setPlacementProp(s, 0, 0, 'dx', '');
  assert.equal('dx' in s.pages[0].place[0], false);
});

test('setThresholds pose un tableau non vide, vide le supprime', () => {
  const s = fresh();
  s.components.x = { type: 'ring' };
  setThresholds(s, 'x', [[20, '#FF0000']]);
  assert.deepEqual(s.components.x.thresholds, [[20, '#FF0000']]);
  setThresholds(s, 'x', []);
  assert.equal('thresholds' in s.components.x, false);
});

test('setComponentProp ignore un id inconnu', () => {
  const s = fresh();
  setComponentProp(s, 'missing', 'text', 'Hi'); // ne doit pas throw
  assert.deepEqual(s.components, {});
});

test('setPlacementProp ignore un index hors borne', () => {
  const s = fresh();
  setPlacementProp(s, 0, 99, 'dy', 10); // place index hors borne : ne doit pas throw
  setPlacementProp(s, 99, 0, 'dy', 10); // page index hors borne : ne doit pas throw (parité add/removePlacement)
  assert.equal(s.pages[0].place.length, 0);
});

test('addPage ajoute une page vide nommée en fin de liste', () => {
  const s = fresh();
  addPage(s, 'P2');
  assert.equal(s.pages.length, 2);
  assert.deepEqual(s.pages[1], { name: 'P2', place: [] });
});

test('removePage retire la page par index', () => {
  const s = fresh();
  addPage(s, 'P2');
  removePage(s, 0);
  assert.deepEqual(s.pages.map(p => p.name), ['P2']);
});

test('renamePage change le nom de la page', () => {
  const s = fresh();
  renamePage(s, 0, 'Accueil');
  assert.equal(s.pages[0].name, 'Accueil');
});

test('reorderPages déplace from → to', () => {
  const s = fresh();
  addPage(s, 'P2'); addPage(s, 'P3');          // [P1, P2, P3]
  reorderPages(s, 0, 2);                        // [P2, P3, P1]
  assert.deepEqual(s.pages.map(p => p.name), ['P2', 'P3', 'P1']);
});

test('reorderPages ignore les index hors bornes (no-op)', () => {
  const s = fresh();
  addPage(s, 'P2');                             // [P1, P2]
  reorderPages(s, 0, 5);
  assert.deepEqual(s.pages.map(p => p.name), ['P1', 'P2']);
});

import {
  uniqueSourceName, addSource, removeSource,
  setSourceProp, setSourceHeaders, setSourceVars
} from '../js/mutations.js';

test('addSource ajoute une source nommee avec interval par defaut', () => {
  const s = { components: {}, pages: [] };
  addSource(s, 'weather');
  assert.deepEqual(s.sources, [{ name: 'weather', interval_s: 60 }]);
});

test('uniqueSourceName evite les collisions', () => {
  const s = { sources: [{ name: 'source1' }, { name: 'source2' }] };
  assert.equal(uniqueSourceName(s), 'source3');
  assert.equal(uniqueSourceName({}), 'source1');
});

test('setSourceProp pose une valeur, vide => supprime la cle', () => {
  const s = { sources: [{ name: 'a', interval_s: 60 }] };
  setSourceProp(s, 0, 'url', 'http://x');
  assert.equal(s.sources[0].url, 'http://x');
  setSourceProp(s, 0, 'url', '');
  assert.equal('url' in s.sources[0], false);
});

test('setSourceHeaders/setSourceVars remplacent ou suppriment', () => {
  const s = { sources: [{ name: 'a' }] };
  setSourceHeaders(s, 0, { 'X-Key': '$k' });
  assert.deepEqual(s.sources[0].headers, { 'X-Key': '$k' });
  setSourceHeaders(s, 0, {});
  assert.equal('headers' in s.sources[0], false);
  setSourceVars(s, 0, { temp: '/t' });
  assert.deepEqual(s.sources[0].vars, { temp: '/t' });
  setSourceVars(s, 0, {});
  assert.equal('vars' in s.sources[0], false);
});

test('removeSource retire par index', () => {
  const s = { sources: [{ name: 'a' }, { name: 'b' }] };
  removeSource(s, 0);
  assert.deepEqual(s.sources, [{ name: 'b' }]);
});

test('setSourceProp / setSourceHeaders no-op sur index invalide', () => {
  const s = { sources: [] };
  setSourceProp(s, 3, 'url', 'http://x');   // ne doit pas throw
  setSourceHeaders(s, 3, { a: 'b' });
  assert.deepEqual(s.sources, []);
});
