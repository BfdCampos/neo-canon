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

const BRAMBLE = `---
id: bramble
name: Bramble
kind: creature
aliases: [the grey mare, the grey]
colour: dun
---
# Bramble

## Facts
- Species: horse · verified
  - Ember and Thorn, Ch 2: "Bramble, the grey mare, would not cross the ford." {book:book-ember-and-thorn-k3, ch:c7}
- Sex: female (mare) · yours
  - Field Notes, Horses: "Bramble — mare, eleven, bad-tempered with strangers." {book:book-field-notes-n9, ch:p1}
  - Written in Canon
- Sibling: Oren Hale (younger) · verified
  - Ember and Thorn, Ch 1: "Oren's younger sister" {book:book-ember-and-thorn-k3, ch:c1}
- Owner: Tamsin Hale · unverified
  - Ember and Thorn, Ch 4: "Tamsin led her own horse, Bramble, up the bank." {book:book-ember-and-thorn-k3, ch:c9, changed}
- Smell: hay and rain · yours
  - Written in Canon

## Set aside
- Sex: male (gelding) · not right
  - The Salt Crown, Ch 2: "That's no mare, that's a gelding, I'd swear it" {book:book-the-salt-crown-s2, ch:c2, said:the horse-trader}
- State: in foal · set aside
  - The Salt Crown, Notes: "Bramble is in foal by the end of book 2?" {book:book-the-salt-crown-s2, ch:notes, said, plan}

## In my words
Bad-tempered with strangers. Bites.

## Not a heading Canon reads
- Sex: whatever · verified
`;

test('an entry file round-trips byte for byte', () => {
  const e = Canon.parseEntry(BRAMBLE);
  assert.equal(e.error, undefined);
  assert.equal(Canon.serialiseEntry(e), BRAMBLE);
  assert.deepEqual(Canon.parseEntry(Canon.serialiseEntry(e)), e);
  assert.deepEqual(e.aliases, ['the grey mare', 'the grey']);
  assert.deepEqual(e.extra, [['colour', 'dun']]);
  assert.deepEqual(e.facts.map((f) => [f.attr, f.value, f.as, f.state]), [
    ['species', 'horse', '', 'verified'], ['sex', 'female', 'mare', 'yours'], ['sibling', 'Oren Hale', 'younger', 'verified'],
    ['owner', 'Tamsin Hale', '', 'unverified'], ['other', 'hay and rain', '', 'yours']
  ]);
  assert.equal(e.facts[4].label, 'Smell');
  assert.deepEqual(e.facts[1].sources[1], { written: true });
  assert.equal(e.facts[3].sources[0].changed, true);
  assert.equal(e.setAside[0].sources[0].said, 'the horse-trader');
  assert.equal(e.setAside[1].sources[0].said, true);
  assert.equal(e.setAside[1].sources[0].plan, true);
  assert.ok(e.words.startsWith('Bad-tempered') && e.words.endsWith('- Sex: whatever · verified\n'));
  // a new entry is written whole too
  const fresh = Canon.newEntry('Ilsa Varr', 'person');
  assert.equal(fresh.id, 'ilsa-varr');
  assert.deepEqual(Canon.parseEntry(Canon.serialiseEntry(fresh)), fresh);
});

test('an entry Canon can\'t read is reported, never guessed at', () => {
  for (const bad of ['', 'no front matter', '---\nname: X\n---\n', BRAMBLE.replace('- Species: horse · verified', '- Species horse'),
    BRAMBLE.replace('  - Written in Canon\n- Sibling', '  - written somewhere\n- Sibling'), '---\nid: x\nname: X\n---\n- Sex: female · yours\n']) {
    assert.equal(Canon.parseEntry(bad).error, 'unreadable', JSON.stringify(bad.slice(0, 40)));
  }
});

test('values come into the vocabulary', () => {
  const n = (attr, value, as) => Canon.normaliseFact(attr, value, as);
  assert.deepEqual(n('sex', 'mare'), { value: 'female', as: 'mare' });
  assert.deepEqual(n('sex', 'female', 'mare'), { value: 'female', as: 'mare' });
  assert.deepEqual(n('sex', 'Male'), { value: 'male', as: '' });
  assert.equal(n('sex', 'grumpy'), null);
  assert.deepEqual(n('eyes', 'the grey of wet slate'), { value: 'grey', as: '' });
  assert.deepEqual(n('hair', 'Gray'), { value: 'grey', as: 'gray' });
  assert.deepEqual(n('species', 'grey mare'), { value: 'horse', as: '' });
  assert.deepEqual(n('species', 'a black stallion'), { value: 'horse', as: '' });
  assert.deepEqual(n('sibling', 'Oren Hale', 'older'), { value: 'Oren Hale', as: 'elder' });
  const hand = Canon.handFact('Sex: mare');
  assert.deepEqual(hand, { attr: 'sex', label: undefined, value: 'female', as: 'mare', state: 'yours', sources: [{ written: true }] });
  assert.equal(Canon.handFact('Eye colour: hazel').attr, 'eyes');
  assert.equal(Canon.handFact('Favourite food: plums').label, 'Favourite food');
  assert.equal(Canon.handFact('no colon'), null);
  assert.equal(Canon.factKey({ id: 'bramble' }, hand), 'bramble/sex');
  assert.equal(Canon.factKey({ id: 'tamsin-hale' }, { attr: 'sibling', value: 'Oren Hale' }), 'tamsin-hale/sibling/oren-hale');
});

test('the writer\'s moves: that\'s right, set aside, restore', () => {
  const e = Canon.parseEntry(BRAMBLE);
  e.facts.push({ attr: 'species', value: 'mule', as: '', state: 'disagree', sources: [] });
  e.facts[0].state = 'disagree';
  Canon.confirmFact(e, 0);
  assert.equal(e.facts[0].state, 'yours');
  assert.deepEqual(e.setAside.map((f) => [f.value, f.state]).at(-1), ['mule', 'set aside']);
  Canon.setAsideFact(e, 3, true);
  assert.deepEqual(e.setAside.at(-1).state, 'not right');
  Canon.restoreFact(e, e.setAside.length - 1);
  assert.equal(e.facts.at(-1).state, 'yours');
  assert.equal(e.facts.at(-1).attr, 'owner');
});

// a small world for the checkers: every fact the writer's own
function world() {
  const e = (name, kind, ...facts) => {
    const x = Canon.newEntry(name, kind);
    for (const f of facts) x.facts.push(Canon.handFact(f));
    return x;
  };
  return [
    e('Bramble', 'creature', 'Sex: mare', 'Species: horse'),
    e('Rook', 'creature', 'Sex: stallion', 'Species: horse'),
    e('Ilsa Varr', 'person', 'Sex: woman', 'Eyes: grey', 'Born in: Saltmere'),
    e('Oren Hale', 'person', 'Sex: man', 'Hair: black'),
    e('Tamsin Hale', 'person', 'Sex: woman', 'Sibling: Oren Hale (younger)'),
    e('Saltmere', 'place'), e('Corwick', 'place')
  ];
}
const yes = { refers: async () => 'yes' };
async function slipsIn(text, { reader = null, entries = world(), known = {} } = {}) {
  const { slips } = await Canon.checkSources({ sources: [{ bookId: 'b', chId: 'c', html: '<p>' + text + '</p>' }], entries, reader,
    knownWords: async (ws) => Object.fromEntries(ws.map((w) => [w, !!known[w]])) });
  return slips.map((s) => `${s.span}→${s.to} ${s.entry}/${s.attr} ${s.strength}`);
}

test('pronouns: the owner\'s own word in its clause is strong; one opening a sentence is weak', async () => {
  assert.deepEqual(await slipsIn('Bramble tossed his head.'), ['his→her bramble/sex strong']);
  assert.deepEqual(await slipsIn('Oren lost her left hand and himself.'), ['her→his oren-hale/sex strong']);
  assert.deepEqual(await slipsIn('Ilsa wrapped himself in a cloak.'), ['himself→herself ilsa-varr/sex strong']);
  for (const fine of ['Rook shook his mane.', 'Tamsin let her go.', 'Ilsa watched him ride off.', 'Bramble, beside Rook, tossed his head.',
    'Ilsa nodded, and his face fell.', '“Bramble hurt his leg,” said the boy.', 'Tamsin took the reins and his hand.']) {
    assert.deepEqual(await slipsIn(fine, { reader: yes }), [], fine);
  }
  assert.deepEqual(await slipsIn('Ilsa came in. He said nothing.'), []); // weak, and no reader
  assert.deepEqual(await slipsIn('Ilsa came in. He said nothing.', { reader: yes }), ['He→She ilsa-varr/sex weak']);
  assert.deepEqual(await slipsIn('Ilsa and Oren came in. He said nothing.', { reader: yes }), []);
});

test('sex and species words: appositives are strong, "the stallion" in a mare\'s scene is weak', async () => {
  assert.deepEqual(await slipsIn('Bramble, the grey stallion, stood still.'), ['stallion→mare bramble/sex strong']);
  assert.deepEqual(await slipsIn('Rook, a black mule, stood still.'), ['mule→horse rook/species strong']);
  assert.deepEqual(await slipsIn('Bramble, the grey mare, stood still. Rook, a black stallion, did not.'), []);
  const scene = 'Tamsin did not argue with Bramble. She swung down from the stallion.';
  assert.deepEqual(await slipsIn(scene), []);
  assert.deepEqual(await slipsIn(scene, { reader: yes }), ['stallion→mare bramble/sex weak']);
  assert.deepEqual(await slipsIn('Bramble stood by Rook. She swung down from the stallion.', { reader: yes }), []);
  assert.deepEqual(await slipsIn('The sky went the grey of a mare’s flank above Rook.', { reader: yes }), []);
});

test('eyes, hair, birthplace and kin', async () => {
  assert.deepEqual(await slipsIn('Ilsa’s brown eyes narrowed.'), ['brown→grey ilsa-varr/eyes strong']);
  assert.deepEqual(await slipsIn('Ilsa’s eyes were green as glass.'), ['green→grey ilsa-varr/eyes strong']);
  assert.deepEqual(await slipsIn('Oren pushed the fair hair out of his eyes.'), ['fair→black oren-hale/hair strong']);
  for (const fine of ['Ilsa’s grey eyes narrowed.', 'Ilsa turned her eyes to the green hills.', 'Ilsa looked into Oren’s brown eyes.', 'The brown eyes of the dog followed Ilsa.']) {
    assert.deepEqual(await slipsIn(fine), [], fine);
  }
  assert.deepEqual(await slipsIn('Ilsa was born in Corwick.'), ['Corwick→Saltmere ilsa-varr/birthplace strong']);
  assert.deepEqual(await slipsIn('Ilsa was born in Saltmere, not Corwick.'), []);
  assert.deepEqual(await slipsIn('Tamsin, the elder of the two, read.', { reader: yes }), ['elder→younger tamsin-hale/sibling weak']);
  assert.deepEqual(await slipsIn('Tamsin, the younger of the two, read.', { reader: yes }), []);
});

test('names a letter off are slips only when the dictionary doesn\'t know the word', async () => {
  assert.deepEqual(await slipsIn('The road ran back to Corwyck.'), ['Corwyck→Corwick corwick/name strong']);
  assert.deepEqual(await slipsIn('Corwyck’s walls were high.'), ['Corwyck→Corwick corwick/name strong']);
  assert.deepEqual(await slipsIn('Brambles grew by Corwick.', { known: { Brambles: true } }), []);
  assert.deepEqual(await slipsIn('Tamzin waved.'), ['Tamzin→Tamsin tamsin-hale/name strong']);
  assert.deepEqual(await slipsIn('Ilsu waved.'), []); // short names are too close to too many words
});

test('the slip carries what the popover shows', async () => {
  const { slips } = await Canon.checkSources({ sources: [{ bookId: 'b', chId: 'c', label: 'Ch 1', html: '<p>Rain fell. Bramble tossed his head.</p>' }], entries: world() });
  const [s] = slips;
  assert.equal(s.sentence, 'Bramble tossed his head.');
  assert.equal(s.at, 26);
  assert.equal(s.sentenceHash, Canon.textHash(Canon.norm(s.sentence)));
  assert.equal(s.fact, 'bramble/sex');
  assert.equal(s.as, 'mare');
  assert.equal(s.written, true);
  assert.equal(s.para, Canon.textHash(Canon.norm('Rain fell. Bramble tossed his head.')));
  const { slips: none } = await Canon.checkSources({ sources: [{ bookId: 'b', chId: 'c', html: '<p>Rain fell. Bramble tossed his head.</p>' }], entries: world(),
    notSlips: [{ fact: 'bramble/sex', sentence: s.sentenceHash }] });
  assert.deepEqual(none, []);
});
