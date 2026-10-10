'use strict';

// Canon's deterministic core (canon.js): text, quotes, entries, checkers.
// The engine on the fixture library is scripts/canon-fixture.test.js.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const Canon = require('../canon.js');

test('textHash is the same fingerprint as app.js\'s', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const at = app.indexOf('function textHash(');
  const context = vm.createContext({});
  vm.runInContext(app.slice(at, app.indexOf('\n}\n', at) + 3) + 'this.h = textHash;', context);
  for (const s of ['', 'Bramble, the grey mare', 'é — “x”'.repeat(40)]) assert.equal(Canon.textHash(s), context.h(s));
});

test('norm folds quotes, dashes, spaces and case, and maps back', () => {
  assert.equal(Canon.norm('  “Bramble’s”  — the\n GREY…  '), '"bramble\'s" - the grey...');
  const { text, map } = Canon.normMap('A  “b”');
  assert.equal(text, 'a "b"');
  assert.deepEqual(map, [0, 1, 3, 4, 5]);
});

test('sourceParas: paragraphs as the page shows them', () => {
  const html = '<p>Bramble &amp; Rook<span class="ph-mark" data-x="1">TODO</span> ran.</p>' +
    '<p class="scene-break">***</p><p class="ghost">An outline note</p><p><b>Two</b>&nbsp;words&#8217;</p><p>  </p>';
  assert.deepEqual(Canon.sourceParas(html).map((p) => p.text), ['Bramble & Rook ran.', 'Two words’']);
  assert.equal(Canon.sourceParas(html)[0].hash, Canon.textHash('bramble & rook ran.'));
  // notes typed without paragraphs: one per line
  assert.deepEqual(Canon.sourceParas('Horses<br>Bramble — mare<div>Rook</div>').map((p) => p.text), ['Horses', 'Bramble — mare', 'Rook']);
});

test('sentences: stops, titles and speech', () => {
  const text = '“Two,” said Ilsa. “One of them is walking.” Capt. Varr nodded! Was it J. Hale? Yes';
  assert.deepEqual(Canon.sentences(text).map((s) => s.text), ['“Two,” said Ilsa.', '“One of them is walking.”', 'Capt. Varr nodded!', 'Was it J. Hale?', 'Yes']);
  const s = Canon.sentences(text)[2];
  assert.equal(text.slice(s.start, s.end), s.text);
  const said = '“That’s no mare,” he said. ‘Quite,’ she said. It’s Bramble’s.';
  assert.deepEqual(Canon.speechSpans(said).map(([a, b]) => said.slice(a, b)), ['“That’s no mare,”', '‘Quite,’']);
  assert.deepEqual(Canon.speechSpans('— Is it a mare? — he asked.').map(([a, b]) => b - a), [16]);
});

test('mentions: names, aliases and unshared parts of a person\'s name', () => {
  const entries = [
    { id: 'tamsin-hale', name: 'Tamsin Hale', kind: 'person' },
    { id: 'oren-hale', name: 'Oren Hale', kind: 'person' },
    { id: 'ilsa-varr', name: 'Ilsa Varr', kind: 'person' },
    { id: 'bramble', name: 'Bramble', kind: 'creature', aliases: ['the grey mare'] }
  ];
  const idx = Canon.mentionIndex(entries);
  const text = 'Captain Varr and Ilsa Varr saw The Grey Mare; the Hales and Tamsin’s brother. Brambles, Bramble’s.';
  const found = Canon.mentions(text, idx).map((m) => [m.id, text.slice(m.start, m.end), m.via]);
  assert.deepEqual(found, [
    ['ilsa-varr', 'Varr', 'part'], ['ilsa-varr', 'Ilsa Varr', 'name'], ['bramble', 'The Grey Mare', 'alias'],
    ['tamsin-hale', 'Tamsin', 'part'], ['bramble', 'Bramble', 'name']
  ]);
});

test('the quote gate keeps only quotes found in the source', () => {
  const src = 'Captain Varr’s eyes were the grey of wet slate, and they missed  very little.';
  assert.equal(Canon.gateQuote('"Captain Varr\'s eyes were the grey of wet slate"', src), 'Captain Varr’s eyes were the grey of wet slate');
  assert.equal(Canon.gateQuote('they missed very little', src), 'they missed  very little');
  assert.equal(Canon.gateQuote('Ilsa\'s eyes were grey as slate', src), null);
  assert.equal(Canon.gateQuote('a', src), null);
  const long = Array.from({ length: 31 }, (_, i) => 'w' + i).join(' ');
  assert.equal(Canon.gateQuote(long, long), null);
  assert.equal(Canon.gateQuote(long.split(' ').slice(0, 30).join(' '), long), long.split(' ').slice(0, 30).join(' '));
  assert.equal(Canon.gateQuote('Bramble - mare', 'Bramble — mare, eleven'), 'Bramble — mare');
});
