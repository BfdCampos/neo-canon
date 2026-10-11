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

test('an entry Canon can\'t read is reported with its line, never guessed at', () => {
  for (const [bad, line] of [['', 1], ['no front matter', 1], ['---\nid: x\n---\n', 2], ['---\nid: x\nname: X\nnot a key\n---\n', 4]]) {
    const r = Canon.parseEntry(bad);
    assert.equal(r.error, 'unreadable', JSON.stringify(bad.slice(0, 40)));
    assert.equal(r.line, line, JSON.stringify(bad.slice(0, 40)));
  }
  assert.deepEqual(Canon.parseEntry('---\nid: x\nname: Bramble\nkind: creature\nnot a key\n---\n'), { error: 'unreadable', line: 5, name: 'Bramble', kind: 'creature' });
});

test('a hand-edited entry reads: BOM, CRLF, trailing spaces, * bullets, tabs, capitals; odd lines are kept', () => {
  const messy = '\uFEFF' + BRAMBLE.replace('· verified\n', '· Verified  \n').replace('- Sex: female (mare) · yours', '* Sex: female (mare) · yours')
    .replace('  - Written in Canon\n- Sibling', '\t- Written in Canon\n- Sibling').replace('- Owner:', 'She bites. (my note)\n- Owner:').replace(/\n/g, '\r\n');
  const e = Canon.parseEntry(messy);
  assert.equal(e.error, undefined);
  const clean = Canon.parseEntry(BRAMBLE);
  assert.deepEqual(e.facts.map((f) => [f.attr, f.value, f.state, f.sources.length]), clean.facts.map((f) => [f.attr, f.value, f.state, f.sources.length]));
  assert.deepEqual(e.facts[2].notes, ['She bites. (my note)']);
  assert.match(Canon.serialiseEntry(e), /\(younger\) · verified\n {2}- Ember and Thorn, Ch 1: "Oren's younger sister" \{book:book-ember-and-thorn-k3, ch:c1\}\nShe bites\. \(my note\)\n- Owner:/);
  // a line before any fact is kept too, and the file still round-trips
  const top = BRAMBLE.replace('## Facts\n', '## Facts\nWritten from memory.\n');
  assert.equal(Canon.serialiseEntry(Canon.parseEntry(top)), top);
  // a name with a line break in it, or an alias with a comma, stays one line
  const x = Canon.newEntry('Bram\nble', 'creature');
  x.aliases = ['Hale, Jr.', 'the grey'];
  x.facts.push(Canon.handFact('Sex: mare'));
  x.facts[0].sources.push({ label: 'B, Ch 1', quote: 'one\ntwo', book: 'b', ch: 'c' });
  const text = Canon.serialiseEntry(x);
  assert.match(text, /^name: Bram ble$/m);
  assert.match(text, /^aliases: \["Hale, Jr\.", the grey\]$/m);
  const back = Canon.parseEntry(text);
  assert.equal(back.error, undefined);
  assert.deepEqual(back.aliases, ['Hale, Jr.', 'the grey']);
  assert.equal(back.facts[0].sources[1].quote, 'one two');
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
  assert.deepEqual(await slipsIn('Oren pushed his fair hair out of his eyes.'), ['fair→black oren-hale/hair strong']);
  assert.deepEqual(await slipsIn('Her eyes were green as glass, and Ilsa knew it.'), []); // the name comes after
  assert.deepEqual(await slipsIn('Ilsa blinked, her brown eyes wet.'), ['brown→grey ilsa-varr/eyes strong']);
  for (const fine of ['Ilsa’s grey eyes narrowed.', 'Ilsa saw the child’s brown eyes.', 'Ilsa saw brown eyes in the dark.', 'Oren pushed the fair hair out of his eyes.', 'Ilsa looked into their brown eyes.', 'Ilsa turned her eyes to the green hills.', 'Ilsa looked into Oren’s brown eyes.', 'The brown eyes of the dog followed Ilsa.']) {
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

// QA (docs/semantics/QA-M0-M4.md): what must never be flagged, and what must
test('decoys the strong checkers leave alone (a wrong flag is worse than a missed one)', async () => {
  for (const fine of ['Bramble’s rider lost his hat.', 'Bramble, a stallion’s rival, bolted.', 'Bramble, the man who sold bread, waved.',
    'Ilsa fed Bramble, the dog and the hens.', 'Oren said, \'Bramble tossed his head\' and left.', 'A bramble tossed his hat into the hedge.',
    'Ilsa, the mare’s rider, waved.', 'Rook, the woman’s horse, waited.']) {
    assert.deepEqual(await slipsIn(fine), [], fine);
  }
  assert.deepEqual(await slipsIn('Bramble raised His head.'), ['His→Her bramble/sex strong']);
  assert.deepEqual(await slipsIn('BRAMBLE tossed his head.'), ['his→her bramble/sex strong']);
  assert.deepEqual(await slipsIn('Bramble — stallion, eleven.'), ['stallion→mare bramble/sex strong']);
  assert.deepEqual(await slipsIn('Ilsa was the only man on the wall.'), ['man→woman ilsa-varr/sex strong']);
  // the stallion's mane: the word, not its 's
  assert.deepEqual(await slipsIn('Tamsin did not argue with Bramble. She stroked the stallion’s neck.', { reader: yes }), ['stallion→mare bramble/sex weak']);
  // a name typed in another Unicode form still counts
  const zoe = [Canon.newEntry('Zoë', 'person')];
  zoe[0].facts.push(Canon.handFact('Sex: woman'));
  assert.deepEqual(await slipsIn('Zoë lost his way.', { entries: zoe }), ['his→her zoe/sex strong']);
  assert.equal(Canon.gateQuote('mare', 'the grey mares ran'), null);
  assert.equal(Canon.gateQuote('the', 'other'), null);
  assert.equal(Canon.gateQuote('mare', 'the mares and the mare'), 'mare');
});

test('values outside the lexicon are kept as written and check nothing; two of the writer\'s own that clash check nothing', async () => {
  assert.deepEqual(['Eyes: violet', 'Sex: nonbinary', 'Gender: they/them', 'Pronouns: she/her', 'Eyes: grey (storm grey)'].map((x) => {
    const f = Canon.handFact(x);
    return [f.attr, f.value, f.as];
  }), [['eyes', 'violet', ''], ['sex', 'nonbinary', ''], ['sex', 'they/them', ''], ['sex', 'female', ''], ['eyes', 'grey', 'storm grey']]);
  const ash = Canon.newEntry('Ash', 'person');
  ash.facts.push(Canon.handFact('Pronouns: they/them'), Canon.handFact('Eyes: violet'));
  assert.deepEqual(await slipsIn('Ash tossed his head. Ash’s brown eyes narrowed. Ash lost her hat.', { entries: [ash] }), []);
  const both = world();
  both[0].facts.push(Canon.handFact('Sex: stallion'));
  assert.deepEqual(await slipsIn('Bramble tossed his head. Bramble flattened her ears.', { entries: both }), []);
  assert.equal(Canon.slug('李雷'), '李雷');
  assert.equal(Canon.slug('Æthelflæd'), 'æthelflæd');
});

// one paragraph read with the fake reader, into an empty Canon
async function readWith(text, facts, { files = {}, judge = {} } = {}) {
  const io = {
    sources: () => [{ bookId: 'b', chId: 'c', book: 'B', label: 'Ch 1', html: `<p>${text}</p>` }],
    meta: () => ({}), saveMeta() {}, notSlips: () => [], cache: () => null, saveCache() {},
    entries: () => Object.entries(files).map(([id, t]) => ({ id, text: t })),
    saveEntry: (id, t) => { files[id] = t; }
  };
  await Canon.createEngine({ io, reader: Canon.fakeReader({ propose: [{ para: text.slice(0, 12), facts }], judge }) }).readShelf();
  return files;
}
const factsOf = (files, id) => files[id] ? Canon.parseEntry(files[id]).facts.map((f) => `${f.attr} ${f.value} ${f.state}`) : [];

test('checking by rule needs the word to be about the entry; a pronoun alone checks nothing, and what fails is left out, never asked', async () => {
  const p = (entity, attr, value, quote, kind = 'creature') => ({ entity, kind, attr, value, quote });
  let f = await readWith('Bramble stood beside the stallion.', [p('Bramble', 'sex', 'stallion', 'Bramble stood beside the stallion')]);
  assert.deepEqual(factsOf(f, 'bramble'), []);
  f = await readWith('Tamsin led her own horse, Bramble, up the bank.', [p('Bramble', 'sex', 'female', 'Tamsin led her own horse, Bramble'), p('Tamsin', 'sex', 'female', 'Tamsin led her own horse', 'person')]);
  assert.deepEqual(factsOf(f, 'bramble'), []);
  assert.deepEqual(factsOf(f, 'tamsin'), []); // her own horse: hers, but a pronoun alone checks nothing
  f = await readWith('Oren sold Rook to Tamsin Hale.', [p('Tamsin Hale', 'sibling', 'Oren', 'Oren sold Rook to Tamsin Hale', 'person'), p('Rook', 'species', 'horse', 'Oren sold Rook')]);
  assert.deepEqual(factsOf(f, 'tamsin-hale'), []); // no kin word: the reader isn't even asked
  assert.deepEqual(factsOf(f, 'rook'), []);
  f = await readWith('Bramble, the grey mare, would not cross.', [p('Bramble', 'sex', 'mare', 'Bramble, the grey mare'), p('Bramble', 'species', 'horse', 'Bramble, the grey mare')]);
  assert.deepEqual(factsOf(f, 'bramble'), ['sex female verified', 'species horse verified']);
});

test('an entry Canon can\'t read keeps its name: Read the Shelf makes no second one', async () => {
  const files = { bramble: '﻿---\nid: bramble\nname: Bramble\nkind: creature\n(a note in the wrong place)\n---\n# Bramble\n' };
  const was = files.bramble;
  await readWith('Bramble, the grey mare, would not cross.', [{ entity: 'Bramble', kind: 'creature', attr: 'sex', value: 'mare', quote: 'Bramble, the grey mare' }], { files });
  assert.deepEqual(Object.keys(files), ['bramble']);
  assert.equal(files.bramble, was);
});

test('Merge Into: names become aliases, the same fact gains sources, a different value waits, words follow', () => {
  const into = Canon.parseEntry(BRAMBLE);
  const from = Canon.newEntry('The Grey', 'creature');
  from.aliases = ['the grey mare', 'Grey'];
  from.facts.push(
    { attr: 'species', value: 'horse', as: '', state: 'unverified', sources: [{ label: 'B, Ch 9', quote: 'the Grey, a horse', book: 'b', ch: 'c9' }] },
    { attr: 'eyes', value: 'brown', as: '', state: 'unverified', sources: [{ label: 'B, Ch 9', quote: 'the Grey’s brown eyes', book: 'b', ch: 'c9' }] },
    { attr: 'sex', value: 'male', as: '', state: 'verified', sources: [{ label: 'B, Ch 9', quote: 'x', book: 'b', ch: 'c9' }] });
  from.words = 'Seen at the ford.\n';
  Canon.mergeEntry(into, from);
  assert.deepEqual(into.aliases, ['the grey mare', 'the grey', 'Grey']);
  assert.equal(into.facts.find((f) => f.attr === 'species').sources.length, 2);
  assert.equal(into.facts.find((f) => f.attr === 'eyes').state, 'unverified');
  assert.equal(into.facts.find((f) => f.attr === 'sex' && f.value === 'male').state, 'disagree');
  assert.match(into.words, /^Bad-tempered[\s\S]*verified\n\nSeen at the ford\.\n$/);
  assert.equal(Canon.parseEntry(Canon.serialiseEntry(into)).error, undefined);
});

// QA-VERIFY 7: the article goes by the value's sound, and only the article
test('a or an: a unicorn, an hour, and a name ending in "a" is left alone', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const at = app.indexOf('function anOrA(');
  const end = app.indexOf('\n', app.indexOf('const tA = ', at));
  const context = vm.createContext({ t: (k, v) => (v ? k.replace(/\{(\w+)\}/g, (_m, n) => v[n]) : k) });
  vm.runInContext(app.slice(at, end) + '\nthis.tA = tA;', context);
  const said = (word) => context.tA('{name} is a {word}.', { name: 'Ida', word });
  assert.equal(said('unicorn'), 'Ida is a unicorn.');
  assert.equal(said('European'), 'Ida is a European.');
  assert.equal(said('one-eyed mare'), 'Ida is a one-eyed mare.');
  assert.equal(said('hour'), 'Ida is an hour.');
  assert.equal(said('honest man'), 'Ida is an honest man.');
  assert.equal(said('owl'), 'Ida is an owl.');
  assert.equal(said('mare'), 'Ida is a mare.');
  assert.equal(context.tA('{name} is a {value}.', { name: 'Ada', value: 'elf' }), 'Ada is an elf.');
});
