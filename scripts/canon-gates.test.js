'use strict';

// The gates that keep a reader's mistakes from becoming checked facts
// (docs/semantics/ACCURACY.md). The fake reader here proposes the six wrong
// facts the real quick reader made on the Ashfall Road fixture (QA-FINAL F1)
// and answers yes to every question, as a small model nearly does.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Canon = require('../canon.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'canon');
const ANSWERS = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'reader-answers.json'), 'utf8'));
const EXPECTED = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'expected.json'), 'utf8'));
const CANON = 'canon-the-ashfall-road-shelf-ash';

function shelfSources(lib) {
  const library = JSON.parse(fs.readFileSync(path.join(lib, 'library.json'), 'utf8'));
  const out = [];
  for (const bookId of library.shelves[0].bookIds) {
    const meta = JSON.parse(fs.readFileSync(path.join(lib, bookId, 'book.json'), 'utf8'));
    const notebook = meta.format === 'notebook';
    meta.chapterOrder.forEach((chId, i) => out.push({ bookId, chId, book: meta.title,
      label: notebook ? meta.chapterTitles[chId] : 'Ch ' + (i + 1), html: fs.readFileSync(path.join(lib, bookId, 'chapters', chId + '.html'), 'utf8') }));
    if (!notebook) out.push({ bookId, chId: 'notes', book: meta.title, label: 'Notes', notes: true, html: fs.readFileSync(path.join(lib, bookId, 'notes.html'), 'utf8') });
  }
  return out;
}
let hunspell = null;
async function knownWords(words) {
  if (!hunspell) {
    const { loadModule } = require('@farscrl/hunspell-wasm');
    const factory = await loadModule();
    const dir = path.join(__dirname, '..', 'node_modules', 'dictionary-en-gb');
    hunspell = factory.create(factory.mountBuffer(fs.readFileSync(path.join(dir, 'index.aff')), 'gb.aff'), factory.mountBuffer(fs.readFileSync(path.join(dir, 'index.dic')), 'gb.dic'));
  }
  return Object.fromEntries(words.map((w) => [w, hunspell.spell(w)]));
}
function library(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-canon-gates-'));
  const lib = path.join(root, 'library');
  fs.cpSync(path.join(FIXTURE, 'library'), lib, { recursive: true });
  const dir = path.join(lib, CANON);
  for (const [id, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'entries', id + '.md'), text);
  const json = (f, fallback) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : fallback;
  const io = {
    sources: () => shelfSources(lib),
    meta: () => json(path.join(dir, 'canon.json'), {}),
    saveMeta: (m) => fs.writeFileSync(path.join(dir, 'canon.json'), JSON.stringify(m, null, 2)),
    entries: () => fs.readdirSync(path.join(dir, 'entries')).filter((f) => f.endsWith('.md')).map((f) => ({ id: f.slice(0, -3), text: fs.readFileSync(path.join(dir, 'entries', f), 'utf8') })),
    saveEntry: (id, text) => fs.writeFileSync(path.join(dir, 'entries', id + '.md'), text),
    notSlips: () => json(path.join(dir, 'not-slips.json'), []),
    cache: () => null, saveCache: () => {}, knownWords
  };
  const entries = () => io.entries().map((x) => Canon.parseEntry(x.text));
  return { root, lib, dir, io, entries, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}
// a fake reader that proposes more for some paragraphs and says yes to every question
function yesReader(extra) {
  const answers = structuredClone(ANSWERS);
  for (const [para, facts] of extra) {
    const hit = answers.propose.find((x) => x.para === para);
    if (hit) hit.facts.push(...facts); else answers.propose.unshift({ para, facts });
  }
  const r = Canon.fakeReader(answers);
  return { ...r, judgeRelations: true, judge: async () => 'yes', refers: r.refers, propose: r.propose.bind(r) };
}
const factLines = (entries) => entries.flatMap((e) => e.facts.map((f) => `${e.name} · ${f.attr}: ${f.value} · ${f.state}`));

const F = (entity, kind, attr, value, quote) => ({ entity, kind, attr, value, quote });
const SIX = [
  ['Captain Varr knelt beside him', [F('Ilsa Varr', 'person', 'owner', 'Ilsa Varr', 'Captain Varr knelt beside him in the water'),
    F('Tamsin', 'person', 'sibling', 'Ilsa Varr', 'Captain Varr knelt beside him in the water')]],
  ['Oren met the convoy at Saltmere', []],
  ['The letter was for Tamsin', []],
  ['Tamsin, the elder of the two Hales', [F('Oren Hale', 'person', 'parent', 'Tamsin', 'Tamsin, the elder of the two Hales')]],
  ['Bramble — mare, eleven', [F('Rook', 'creature', 'parent', 'Oren Hale', 'Rook — stallion, Oren’s')]],
  ['In the morning the convoy turned north', [F('Ilsa Varr', 'person', 'home', 'Corwyck', 'Then she took the road back to Corwyck, alone, as she had come.'),
    F('Corwyck', 'place', null, null, 'the road back to Corwyck')]],
  ['Ilsa rode back along the line', [F('Ilsa Varr', 'person', 'eyes', 'brown', 'Ilsa’s brown eyes narrowed')]],
  ['There was a horse-trader on the near side', [F('Ponies', 'group', null, null, 'a string of ponies')]],
  ['By midwinter Oren could saddle Rook', [F('Oren Hale', 'person', 'owner', 'Rook', 'By midwinter Oren could saddle Rook one-handed')]]
];

test('QA F1: the six wrong facts the quick reader checked stay unchecked, even when the reader says yes to everything', async () => {
  const L = library();
  try {
    await Canon.createEngine({ io: L.io, reader: yesReader(SIX) }).readShelf();
    const got = L.entries();
    const lines = factLines(got);
    const state = (name, attr, value) => (got.find((e) => e.name === name) || { facts: [] }).facts.filter((f) => f.attr === attr && f.value === value).map((f) => f.state);
    // 1. nobody is their own owner: dropped outright
    assert.deepEqual(state('Ilsa Varr', 'owner', 'Ilsa Varr'), []);
    // 2. "Tamsin, the elder of the two Hales" says nothing of a parent
    assert.ok(!lines.some((l) => /parent: Tamsin.* · verified/.test(l)), lines.join('\n'));
    // 3. "Rook — stallion, Oren's" is Oren's horse, not his father
    assert.deepEqual(state('Rook', 'parent', 'Oren Hale'), ['unverified']);
    assert.deepEqual(state('Rook', 'owner', 'Oren Hale'), ['verified']);
    // 4. "Captain Varr knelt beside him" makes no one Ilsa's sister
    assert.ok(!lines.some((l) => /sibling: Ilsa Varr · verified/.test(l)), lines.join('\n'));
    // 5. Corwyck is Corwick misspelt: no place to live in, and no second town
    assert.deepEqual(state('Ilsa Varr', 'home', 'Corwyck'), ['unverified']);
    assert.ok(!got.some((e) => e.name === 'Corwyck'));
    // 6. the seeded slip doesn't become her eye colour: Book 1 and the notes say grey
    assert.deepEqual(state('Ilsa Varr', 'eyes', 'brown'), ['disagree']);
    assert.deepEqual(state('Ilsa Varr', 'eyes', 'grey'), ['verified']);
    // and the rest of the junk: no "Ponies", no owner from "saddle Rook"
    assert.ok(!got.some((e) => e.name === 'Ponies'));
    assert.ok(!lines.some((l) => /owner: Rook · verified/.test(l)));
    // every checked fact is one expected.json holds as true
    const truths = new Set(EXPECTED.entries.flatMap((x) => x.facts.filter((f) => !f.said && !f.plan).map((f) => `${x.name} · ${f.attr}: ${f.value}`)));
    for (const l of lines.filter((x) => x.endsWith('· verified'))) assert.ok(truths.has(l.replace(/ · verified$/, '')), l);
    // and the pass still finds the five slips, and flags nothing in Book 1
    const { slips } = await Canon.createEngine({ io: L.io, reader: yesReader(SIX) }).check({ scope: 'shelf' });
    assert.deepEqual(slips.map((s) => s.span).sort(), EXPECTED.slips.map((s) => s.span).sort());
  } finally { L.done(); }
});

test('two values the shelf can\'t settle: both wait as disagreeing, nothing checked, no slip', async () => {
  // Book 1's "grey" sentence goes, so the shelf has grey once (the notes) and brown once
  const L = library();
  try {
    const c1 = path.join(L.lib, 'book-ember-and-thorn-ember1', 'chapters', 'c1.html');
    fs.writeFileSync(c1, fs.readFileSync(c1, 'utf8').replace('Captain Varr’s eyes were the grey of wet slate, and they missed very little. ', ''));
    await Canon.createEngine({ io: L.io, reader: yesReader(SIX) }).readShelf();
    const ilsa = L.entries().find((e) => e.id === 'ilsa-varr');
    assert.deepEqual(ilsa.facts.filter((f) => f.attr === 'eyes').map((f) => `${f.value} ${f.state}`).sort(), ['brown disagree', 'grey disagree']);
    const { slips } = await Canon.createEngine({ io: L.io, reader: yesReader(SIX) }).check({ scope: 'shelf' });
    assert.ok(!slips.some((s) => s.attr === 'eyes'));
  } finally { L.done(); }
});

test('the shelf\'s own evidence: one value said twice before a value said once establishes it, and a slip sentence that comes first does not', () => {
  const where = (chapter, order) => ({ chapter, order });
  assert.equal(Canon.established(new Map([['grey', [where('a', 0), where('c', 2)]], ['brown', [where('b', 1)]]])), 'grey');
  assert.equal(Canon.established(new Map([['grey', [where('a', 0)]], ['brown', [where('b', 1)]]])), null);
  // the slip first: grey at 0, brown twice after: brown is established only because grey was said once, before it
  assert.equal(Canon.established(new Map([['grey', [where('a', 0)]], ['brown', [where('b', 1), where('c', 2)]]])), null);
  assert.equal(Canon.established(new Map([['grey', [where('a', 0), where('a', 0)]], ['brown', [where('b', 1)]]])), null); // twice in one chapter is once
  assert.equal(Canon.established(new Map([['grey', [where('a', 0)]]])), 'grey');
  assert.equal(Canon.established(undefined), undefined);
  // note lines count: "Ilsa: grey eyes", "Bramble — mare"
  const e = Canon.newEntry('Ilsa Varr', 'person', 'ilsa-varr');
  const b = Canon.newEntry('Bramble', 'creature', 'bramble');
  const ev = Canon.shelfEvidence([{ bookId: 'n', chId: 'p', book: 'N', label: 'P', html: '<p>Ilsa: grey eyes, born in Saltmere.</p><p>Bramble — mare, eleven.</p><p>What if Ilsa had green eyes?</p><p>“Ilsa’s eyes are blue,” he said.</p>' }], [e, b]);
  assert.deepEqual([...ev.get('ilsa-varr/eyes').keys()], ['grey']); // not the question, not the speech
  assert.deepEqual([...ev.get('bramble/sex').keys()], ['female']);
  assert.deepEqual([...ev.get('bramble/species').keys()], ['horse']);
});

test('relations need both names and a word for the relation in the quote\'s sentence; the words say which way round', () => {
  const es = ['Tamsin Hale', 'Oren Hale', 'Ilsa Varr', 'Teodor Brisk', 'Ansel Brisk', 'Mara Quell', 'Jory Quell'].map((n) => Canon.newEntry(n, 'person'));
  es.push(Canon.newEntry('Rook', 'creature'), Canon.newEntry('Hector', 'creature'), Canon.newEntry('Clover', 'creature'), Canon.newEntry('Saltmere', 'place'), Canon.newEntry('Kellsharrow', 'place'));
  const by = (n) => es.find((e) => e.name === n);
  const rel = (name, attr, value, para, quote = para) => Canon.relation(by(name), { attr, value }, quote, para, es);
  assert.equal(rel('Tamsin Hale', 'sibling', 'Oren Hale', 'The girl was Tamsin Hale, Oren’s younger sister, and she looked tired.', 'Tamsin Hale, Oren’s younger sister'), 'rule');
  assert.equal(rel('Teodor Brisk', 'parent', 'Ansel Brisk', 'Teodor Brisk, Ansel’s father, kept the farm.'), 'rule');
  assert.equal(rel('Ansel Brisk', 'child', 'Teodor Brisk', 'Teodor Brisk, Ansel’s father, kept the farm.'), 'rule');
  assert.equal(rel('Ansel Brisk', 'parent', 'Teodor Brisk', 'Teodor Brisk, Ansel’s father, kept the farm.'), 'linked'); // the wrong way round: never by rule
  assert.equal(rel('Mara Quell', 'sibling', 'Jory Quell', 'Mara: green eyes, born in Dunmore, Jory’s younger sister.'), 'rule');
  assert.equal(rel('Rook', 'owner', 'Oren Hale', 'Rook — stallion, Oren’s.'), 'rule');
  assert.equal(rel('Hector', 'owner', 'Teodor Brisk', 'Hector, Teodor’s black bull, grazed the cliff field.'), 'rule');
  assert.equal(rel('Clover', 'owner', 'Mara Quell', 'Clover, the red cow, belonged to Mara and to nobody else.'), 'rule');
  assert.equal(rel('Mara Quell', 'home', 'Kellsharrow', 'Mara lived in Kellsharrow, in the keeper’s cottage.'), 'rule');
  assert.equal(rel('Ilsa Varr', 'birthplace', 'Saltmere', 'Ilsa: grey eyes, born in Saltmere.', 'born in Saltmere'), 'rule');
  // the six-fact mistakes
  assert.equal(rel('Rook', 'parent', 'Oren Hale', 'Rook — stallion, Oren’s.'), null);
  assert.equal(rel('Oren Hale', 'parent', 'Tamsin Hale', 'Tamsin, the elder of the two Hales, had always been the one who could read.'), null);
  assert.equal(rel('Tamsin Hale', 'sibling', 'Ilsa Varr', 'Captain Varr knelt beside him in the water.'), null);
  assert.equal(rel('Oren Hale', 'owner', 'Rook', 'By midwinter Oren could saddle Rook one-handed.'), null);
  assert.equal(rel('Jory Quell', 'parent', 'Teodor Brisk', 'Jory stood beside Teodor Brisk at the rail of the harbour that evening.'), null);
  // someone's sister is not their horse
  assert.equal(rel('Tamsin Hale', 'owner', 'Oren Hale', 'Tamsin Hale, Oren’s younger sister'), 'linked');
});

test('a slip of the pen is no name: misspelt values and entries', () => {
  const es = [Canon.newEntry('Corwick', 'place'), Canon.newEntry('Kellsharrow', 'place'), Canon.newEntry('Bramble', 'creature')];
  assert.equal(Canon.misspelt('Corwyck', es), true);
  assert.equal(Canon.misspelt('Kelsharrow', es), true);
  assert.equal(Canon.misspelt('Corwick', es), false);
  assert.equal(Canon.misspelt('Saltmere', es), false);
  assert.equal(Canon.misspelt('Ashby', es), false);
});

test('QA #4: "The Salt Law" kept by hand is the reader\'s "Salt Law": no second entry', async () => {
  const hand = Canon.newEntry('The Salt Law', 'rule', 'the-salt-law');
  hand.facts.push(Canon.handFact('Other: no salt leaves Corwick unweighed'));
  const L = library({ 'the-salt-law': Canon.serialiseEntry(hand) });
  try {
    const c1 = path.join(L.lib, 'book-the-salt-crown-salt2', 'chapters', 'c1.html');
    fs.writeFileSync(c1, fs.readFileSync(c1, 'utf8').replace('<p>Spring came late', '<p>The Salt Law kept the convoy honest. Spring came late'));
    const reader = yesReader([['The Salt Law kept', [F('Salt Law', 'rule', null, null, 'The Salt Law kept the convoy honest'), F('The Salt Law', 'rule', null, null, 'The Salt Law kept the convoy honest')]]]);
    await Canon.createEngine({ io: L.io, reader }).readShelf();
    assert.deepEqual(L.entries().filter((e) => /salt law/i.test(e.name)).map((e) => e.id), ['the-salt-law']);
  } finally { L.done(); }
});

test('speech and plans never join a fact of the story, nor become its source (QA F7, UX #5/#6)', () => {
  const said = { label: 'Ember, Ch 2', quote: 'That’s no mare, that’s a gelding', book: 'b', ch: 'c2', said: 'the horse-trader' };
  // Change across the series: the writer's stallion cites the writer, not the trader
  const e = Canon.newEntry('Bramble', 'creature');
  e.facts.push({ attr: 'sex', value: 'female', as: 'mare', state: 'verified', sources: [{ label: 'Ember, Ch 2', quote: 'Bramble, the grey mare', book: 'b', ch: 'c2' }] },
    { attr: 'sex', value: 'male', as: 'gelding', state: 'unverified', sources: [said] });
  Canon.replaceFact(e, Canon.handFact('Sex: stallion'), null);
  const mine = e.facts.find((f) => f.state === 'yours');
  assert.deepEqual(mine.sources, [{ written: true }]);
  assert.equal(mine.as, 'stallion');
  assert.deepEqual(e.facts.find((f) => f !== mine && f.attr === 'sex').sources, [said]); // the trader's line stays his
  // a fact from an older Canon with the line joined to it: the line is split off
  const old = Canon.newEntry('Bramble', 'creature');
  old.facts.push({ attr: 'sex', value: 'male', as: '', state: 'unverified', sources: [said, { label: 'x', quote: 'Bramble the stallion', book: 'b', ch: 'c9' }] });
  Canon.replaceFact(old, Canon.handFact('Sex: male'), null);
  assert.deepEqual(old.facts.map((f) => [f.state, f.sources.map((s) => !!s.said)]), [['yours', [false, false]], ['unverified', [true]]]);
  // That's right on what a character says: a fact of the writer's, the line untouched
  const c = Canon.newEntry('Bramble', 'creature');
  c.facts.push({ attr: 'sex', value: 'male', as: 'gelding', state: 'unverified', sources: [said] });
  Canon.confirmFact(c, 0);
  assert.deepEqual(c.facts.map((f) => [f.state, f.sources]), [['unverified', [said]], ['yours', [{ written: true }]]]);
  // Merge Into keeps them apart too
  const into = Canon.newEntry('Bramble', 'creature');
  into.facts.push({ attr: 'sex', value: 'male', as: '', state: 'verified', sources: [{ label: 'x', quote: 'the stallion Bramble', book: 'b', ch: 'c9' }] });
  const from = Canon.newEntry('The Grey', 'creature');
  from.facts.push({ attr: 'sex', value: 'male', as: 'gelding', state: 'unverified', sources: [said] });
  Canon.mergeEntry(into, from);
  assert.equal(into.facts.length, 2);
  assert.equal(into.facts[0].sources.length, 1);
});

test('a read never joins the trader\'s line to the story\'s own fact of the same value', async () => {
  const L = library();
  try {
    // a reader that also reads "the old stallion" as Bramble's (true here, for the test)
    const c3 = path.join(L.lib, 'book-ember-and-thorn-ember1', 'chapters', 'c3.html');
    fs.writeFileSync(c3, fs.readFileSync(c3, 'utf8').replace('<p>By midwinter', '<p>Bramble, the old stallion, slept. By midwinter'));
    await Canon.createEngine({ io: L.io, reader: yesReader([['Bramble, the old stallion', [F('Bramble', 'creature', 'sex', 'stallion', 'Bramble, the old stallion')]]]) }).readShelf();
    const b = L.entries().find((e) => e.id === 'bramble');
    for (const f of b.facts.filter((x) => x.attr === 'sex' && x.value === 'male')) {
      assert.ok(f.sources.every((s) => s.said) || f.sources.every((s) => !s.said), JSON.stringify(f.sources));
    }
    // the shelf now says mare twice before a stallion once: the mare stands, the stallion waits
    assert.deepEqual(b.facts.filter((x) => x.attr === 'sex' && !x.sources.every((s) => s.said)).map((f) => `${f.value} ${f.state}`).sort(), ['female verified', 'male disagree']);
  } finally { L.done(); }
});

test('the local reader: verified only on yes to the claim and no to its opposite; a pronoun is a choice among names', async () => {
  const asked = [];
  const reader = (answer) => Canon.localReader({ id: 'q', tier: 'careful', ask: async (m) => { asked.push(m.user); return answer(m.user); } });
  const claim = { entity: 'Ilsa Varr', attr: 'title', value: 'Captain' };
  assert.equal(await reader(() => ({ a: 'yes' })).judge({ claim, quote: 'Captain Ilsa Varr', paragraph: 'Captain Ilsa Varr was on the wall.' }), 'unclear'); // yes to anything
  assert.equal(await reader((u) => ({ a: /does not have/.test(u) ? 'no' : 'yes' })).judge({ claim, quote: 'Captain Ilsa Varr', paragraph: 'Captain Ilsa Varr was on the wall.' }), 'yes');
  assert.equal(await reader(() => ({ a: 'unsure' })).judge({ claim, quote: 'x', paragraph: 'x' }), 'unclear');
  // refers: "He spat into the shallows" — Bramble is one choice among others, and someone else is one
  asked.length = 0;
  const pick = (name) => reader(() => ({ a: name }));
  const q = { sentence: 'He spat into the shallows.', span: 'He', entity: 'Bramble', paragraph: 'There was a horse-trader watching Bramble. He spat into the shallows.', others: ['Tamsin Hale'] };
  assert.equal(await pick('someone or something else').refers(q), 'unclear');
  assert.equal(await pick('Bramble').refers(q), 'yes');
  assert.match(asked[0], /Options: Bramble; Tamsin Hale; someone or something else; cannot tell/);
  // the quick reader is never asked about relations
  assert.equal(Canon.localReader({ id: 'q', tier: 'quick', ask: async () => ({}) }).judgeRelations, false);
  assert.equal(Canon.localReader({ id: 'c', tier: 'careful', ask: async () => ({}) }).judgeRelations, true);
});

test('the held-out shelf (canon-heldout), kept by hand: its five slips, the one before the fact included, and no decoy', async () => {
  const FX = path.join(__dirname, 'fixtures', 'canon-heldout');
  const expected = JSON.parse(fs.readFileSync(path.join(FX, 'expected.json'), 'utf8'));
  const sources = shelfSources(path.join(FX, 'library')).filter((s) => !s.notes);
  const entries = expected.entries.map((x) => {
    const e = Canon.newEntry(x.name, x.kind, x.id);
    for (const f of x.facts) if (!f.said && !f.plan) e.facts.push({ attr: f.attr, value: f.value, as: f.as || '', state: 'yours', sources: [{ written: true }] });
    return e;
  });
  // the reader says the weak ones mean who they seem to, and "He was young" (the board's man) does not
  const reader = Canon.fakeReader({ refers: [
    { sentence: 'Mara, the elder of the two Quells', span: 'elder', entity: 'Mara Quell', answer: 'yes' },
    { sentence: 'She slid the halter off the bull', span: 'bull', entity: 'Clover', answer: 'yes' }] });
  const { slips } = await Canon.checkSources({ sources, entries, knownWords, reader });
  assert.deepEqual(slips.map((s) => ({ chapter: s.chId, sentence: s.sentence, span: s.span, to: s.to, entry: s.entry, attr: s.attr, strength: s.strength })), expected.slips);
  for (const d of expected.decoys) assert.ok(!slips.some((s) => s.sentence === d), d);
  // with no reader, the three strong ones
  assert.equal((await Canon.checkSources({ sources, entries, knownWords })).slips.length, 3);
});

test('names: one person under one name, no entry for a pronoun or a common word, a place entry only for a name written twice', async () => {
  const names = Canon.shelfNames(['Captain Ilsa Varr rode. Then Ilsa slept. Tamsin Hale and Oren Hale came.', 'Captain Varr knelt, and then she took the road to Corwyck. Ponies grazed by the ponies.']);
  assert.deepEqual([...names.get('varr')], ['Ilsa Varr']);
  assert.deepEqual([...names.get('hale')].sort(), ['Oren Hale', 'Tamsin Hale']);
  assert.ok(!names.has('then'));
  const L = library();
  try {
    const reader = yesReader([
      ['Captain Varr’s eyes were', [F('Varr', 'person', 'eyes', 'grey', 'Captain Varr’s eyes were the grey of wet slate')]],
      ['Rain had come to Corwick', [F('Ilsa', 'person', 'home', 'Corwick', 'Rain had come to Corwick three days early')]],
      ['In the morning the convoy turned north', [F('She', 'person', 'home', 'Corwyck', 'Then she took the road back to Corwyck')]],
      ['Oren met the convoy at Saltmere', [F('Hale', 'person', 'owner', 'Rook', 'Oren met the convoy at Saltmere')]]
    ]);
    reader.propose = Canon.fakeReader({ propose: [
      { para: 'Rain had come to Corwick', facts: [F('Ilsa', 'person', 'home', 'Corwick', 'Rain had come to Corwick three days early')] },
      { para: 'Captain Varr’s eyes were', facts: [F('Varr', 'person', 'eyes', 'grey', 'Captain Varr’s eyes were the grey of wet slate')] },
      { para: 'In the morning the convoy turned north', facts: [F('She', 'person', 'home', 'Corwyck', 'Then she took the road back to Corwyck')] },
      { para: 'Oren met the convoy at Saltmere', facts: [F('Hale', 'person', 'owner', 'Rook', 'Oren met the convoy at Saltmere')] }
    ] }).propose;
    await Canon.createEngine({ io: L.io, reader }).readShelf();
    const got = L.entries();
    assert.deepEqual(got.map((e) => e.name).sort(), ['Corwick', 'Ilsa Varr']); // no Varr, Ilsa, She, Hale
    const ilsa = got.find((e) => e.name === 'Ilsa Varr');
    assert.deepEqual(ilsa.facts.map((f) => `${f.attr} ${f.value} ${f.state}`).sort(), ['eyes grey verified', 'home Corwick unverified']);
    // and with Corwick an entry, the pass sees Corwyck for the slip it is
    const { slips } = await Canon.createEngine({ io: L.io, reader }).check({ scope: 'shelf' });
    assert.deepEqual(slips.map((s) => s.span).sort(), ['Corwyck', 'brown']);
  } finally { L.done(); }
});

test('a value the text doesn\'t tie is no rival: "Tamsin rode her" doesn\'t unsettle an owner the words give', async () => {
  const L = library();
  try {
    await Canon.createEngine({ io: L.io, reader: yesReader([['Tamsin rode her most days', [F('Bramble', 'creature', 'owner', 'Oren Hale', 'Tamsin rode her most days.')]],
      ['Bramble — mare, eleven', [F('Bramble', 'creature', 'owner', 'Tamsin Hale', 'Bramble — mare, eleven')]]]) }).readShelf();
    const owners = L.entries().find((e) => e.id === 'bramble').facts.filter((f) => f.attr === 'owner').map((f) => `${f.value} ${f.state}`).sort();
    assert.ok(!owners.some((x) => / (?:disagree|verified)$/.test(x)), owners.join());
  } finally { L.done(); }
});

test('the quick reader is never asked who "he" or "she" means', async () => {
  let asked = 0;
  const quick = Canon.localReader({ id: 'q', tier: 'quick', ask: async () => { asked++; return { a: 'Bramble' }; } });
  assert.equal(await quick.refers({ sentence: 'He spat.', span: 'He', entity: 'Bramble', paragraph: 'He spat.' }), 'unclear');
  assert.equal(asked, 0);
  assert.equal(await quick.refers({ sentence: 'She led the stallion.', span: 'stallion', entity: 'Bramble', paragraph: 'x' }), 'yes');
});

test('a relation to someone with no entry yet: a part of the name the entry doesn\'t share', () => {
  const t = Canon.newEntry('Teodor Brisk', 'person');
  assert.equal(Canon.relation(t, { attr: 'parent', value: 'Ansel Brisk' }, 'Teodor Brisk, Ansel’s father', 'Teodor Brisk, Ansel’s father, kept the farm.', [t]), 'rule');
  assert.equal(Canon.relation(t, { attr: 'parent', value: 'Mara Brisk' }, 'Teodor Brisk, Ansel’s father', 'Teodor Brisk, Ansel’s father, kept the farm.', [t]), null); // "Brisk" is his own
});

test('entry file names: never one Windows keeps for itself (QA F14)', () => {
  for (const n of ['CON', 'prn', 'Aux', 'NUL', 'com1', 'LPT9']) assert.equal(Canon.slug(n), n.toLowerCase() + '-entry');
  assert.equal(Canon.slug('Conrad'), 'conrad');
  assert.equal(Canon.slug('Com 1'), 'com-1');
  assert.equal(Canon.newEntry('Con', 'person').id, 'con-entry');
});

test('places the shelf names plainly become entries, so their misspellings can be seen', () => {
  const texts = ['Rain had come to Corwick. The ford below Corwick ran high.', 'The surgeon in Corwick worked. Then she rode back to Corwyck.', 'They came from Ashby. Captain Varr came to Saltmere. Tamsin Hale rode to Tamsin Hale.'];
  assert.deepEqual(Canon.shelfPlaces(texts, Canon.shelfNames(texts)), ['Corwick']);
});
