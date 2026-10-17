'use strict';

// Needs You, from the owner's report (Windows, Careful reader, a chapter
// about Pio and the Academy): "Someone says Pio is female" for a line of
// narration, It's true adding a sourceless fact on every press and never
// leaving, and the same value again under What others say. The quotation
// marks that made narration dialogue, the narration's own she and her,
// and an entry that heals from twelve copies of one fact.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const Canon = require('../canon.js');

// sentences modelled on the owner's chapter
const FLEETS = 'In the Academy, you were born into "Fleets." These were the people you grew up with.';
const ARMS = '“Lift your arms," she instructed, and Pio promptly obeyed, rehearsedly lifting her arms parallel to the ground. The tailor measured her twice.';
const BED = 'That night Pio thanked the lady, and Pio laid down in her bed.';
const LADY = 'the lady, and Pio laid down in her bed';

// a shelf in memory: one book's chapters
function shelf(chapters) {
  let meta = {};
  let cache = null;
  const files = {};
  const io = {
    sources: () => chapters.map((paras, i) => ({ bookId: 'acad', chId: 'c' + (i + 1), book: 'The Academy', label: 'Ch ' + (i + 1), html: paras.map((p) => `<p>${p}</p>`).join('') })),
    meta: () => structuredClone(meta), saveMeta: (m) => { meta = structuredClone(m); },
    entries: () => Object.entries(files).map(([id, text]) => ({ id, text })), saveEntry: (id, t) => { files[id] = t; },
    notSlips: () => [], cache: () => cache && structuredClone(cache), saveCache: (c) => { cache = structuredClone(c); },
    knownWords: async (ws) => Object.fromEntries(ws.map((w) => [w, true]))
  };
  return { io, files, entry: (id) => files[id] && Canon.parseEntry(files[id]) };
}
const said = (text, quote) => {
  const at = text.indexOf(quote);
  return Canon.speechSpans(text).some(([a, b]) => at >= a && at + quote.length <= b);
};

test('speech: straight, curly and mixed marks pair up; a stray mark or a quoted term is no dialogue', () => {
  // mixed curly and straight, opening the paragraph: only the words in the marks are speech
  assert.deepEqual(Canon.speechSpans(ARMS).map(([a, b]) => ARMS.slice(a, b)), ['“Lift your arms,"']);
  assert.equal(said(ARMS, 'rehearsedly lifting her arms'), false);
  const straight = ARMS.replace('“', '"');
  assert.deepEqual(Canon.speechSpans(straight).map(([a, b]) => straight.slice(a, b)), ['"Lift your arms,"']);
  // a term in quotation marks ("Fleets.") is a word, not a speech
  assert.deepEqual(Canon.speechSpans(FLEETS), []);
  // the owner's paragraph: before the fix the lady's line read as dialogue
  const para = `${FLEETS} ${BED}`;
  assert.equal(said(para, LADY), false);
  assert.deepEqual(Canon.speechSpans(para), []);
  // an unclosed mark mid-paragraph makes nothing after it speech…
  const stray = `Pio looked up. "Lift your arms, and ${BED}`;
  assert.equal(said(stray, LADY), false);
  // …but a paragraph that opens with one is a speech going on into the next
  const speech = `"Lift your arms, and ${BED}`;
  assert.equal(said(speech, LADY), true);
  // what is said stays said: a one-word reply, a short shout, a quote after a saying verb
  assert.equal(said('She looked up. "No."', '"No."'), true);
  assert.equal(said('"No!" she cried.', '"No!"'), true);
  assert.equal(said('He said, "Go."', '"Go."'), true);
  assert.equal(said('‘I don’t know,’ she said, and the dogs’ bowls were empty.', 'I don’t know'), true);
  assert.equal(said('‘I don’t know,’ she said, and the dogs’ bowls were empty.', 'bowls'), false);
  assert.equal(said('„Hallo“, sagte er.', 'Hallo'), true);
  assert.equal(said('« Bonjour », dit-il.', 'Bonjour'), true);
  // where a quote sits, as the gates read it
  assert.equal(Canon.quoteIn(LADY, para).said, false);
  assert.equal(Canon.quoteIn('lifting her arms', ARMS).said, false);
});

test('the narration\'s she and her give Pio\'s sex, first said, first kept, citing the sentences; never from dialogue', async () => {
  const S = shelf([[FLEETS, ARMS, BED]]);
  const reader = Canon.fakeReader({ propose: [{ para: 'That night Pio', facts: [{ entity: 'Pio', kind: 'person', attr: 'sex', value: 'female', quote: LADY }] }] });
  const r = await Canon.createEngine({ io: S.io, reader }).readShelf();
  const pio = S.entry('pio');
  const sex = pio.facts.filter((f) => f.attr === 'sex');
  assert.equal(sex.length, 1);
  assert.equal(sex[0].value, 'female');
  assert.equal(sex[0].state, 'verified');
  assert.ok(sex[0].sources.every((s) => !s.said && !s.written));
  assert.ok(sex[0].sources.some((s) => s.quote === 'The tailor measured her twice.'));
  assert.equal(r.needs, 0); // nothing to ask
  // and the pass finds nothing against it
  const { slips, asks } = await Canon.createEngine({ io: S.io, reader }).check({ bookId: 'acad' });
  assert.deepEqual(slips, []);
  assert.deepEqual(asks, []);

  // one sentence is not enough; one against is too many; dialogue never counts
  const one = Canon.pronounEvidence([{ bookId: 'b', chId: 'c', book: 'B', label: 'Ch 1', html: `<p>${BED}</p>` }], [Canon.newEntry('Pio', 'person')]);
  assert.equal(Canon.pronounSex(one.get('pio')), null);
  const against = Canon.pronounEvidence([{ bookId: 'b', chId: 'c', book: 'B', label: 'Ch 1', html: `<p>${ARMS}</p><p>${BED}</p><p>Pio laid down in his bed.</p>` }], [Canon.newEntry('Pio', 'person')]);
  assert.equal(Canon.pronounSex(against.get('pio')), null);
  const talk = Canon.pronounEvidence([{ bookId: 'b', chId: 'c', book: 'B', label: 'Ch 1', html: '<p>“Pio packed her bag. Pio took her coat,” the lady said.</p>' }], [Canon.newEntry('Pio', 'person')]);
  assert.equal(Canon.pronounSex(talk.get('pio')), null);
  // a place is never she
  const place = Canon.pronounEvidence([{ bookId: 'b', chId: 'c', book: 'B', label: 'Ch 1', html: '<p>The Academy stood on the hill. She was old.</p><p>The Academy kept her gates shut. Her walls were high.</p>' }], [Canon.newEntry('Academy', 'place')]);
  assert.equal(place.get('academy'), undefined);
});

test('It\'s true resolves once: the line becomes the writer\'s fact with its passage, merged into one of the same value, and stays decided on a read', async () => {
  const LINE = '“Pio is a fine girl,” the lady said.';
  const S = shelf([[LINE, BED]]);
  const reader = Canon.fakeReader({ propose: [{ para: '“Pio is a fine girl', facts: [{ entity: 'Pio', kind: 'person', attr: 'sex', value: 'female', quote: 'Pio is a fine girl' }] }] });
  await Canon.createEngine({ io: S.io, reader }).readShelf();
  let pio = S.entry('pio');
  const i = pio.facts.findIndex((f) => f.attr === 'sex' && f.sources.every((s) => s.said));
  assert.ok(i >= 0, 'the lady\'s line waits as what someone says');
  // pressed twice (a double click): one fact, the writer's, citing the line
  Canon.confirmFact(pio, i);
  Canon.confirmFact(pio, i);
  const sex = pio.facts.filter((f) => f.attr === 'sex');
  assert.equal(sex.length, 1);
  assert.equal(sex[0].state, 'yours');
  assert.deepEqual(sex[0].sources.map((s) => [s.quote, !!s.said]), [['Pio is a fine girl', true]]);
  S.files.pio = Canon.serialiseEntry(pio);
  assert.doesNotMatch(S.files.pio, /Written in Canon/);
  // read again from the start: the line doesn't come back as a question
  await Canon.createEngine({ io: S.io, reader }).readShelf({ again: true });
  pio = S.entry('pio');
  assert.deepEqual(pio.facts.filter((f) => f.attr === 'sex').map((f) => [f.value, f.state]), [['female', 'yours']]);

  // a fact of the same value already there takes the line instead
  const e = Canon.newEntry('Pio', 'person');
  const story = { label: 'The Academy, Ch 1', quote: 'Pio laid down in her bed', book: 'acad', ch: 'c1' };
  const line = { label: 'The Academy, Ch 1', quote: 'Pio is a fine girl', book: 'acad', ch: 'c1', said: true };
  e.facts.push({ attr: 'sex', value: 'female', as: '', state: 'verified', sources: [story] }, { attr: 'sex', value: 'female', as: '', state: 'unverified', sources: [line] });
  Canon.confirmFact(e, 1);
  assert.deepEqual(e.facts.map((f) => [f.state, f.sources.length]), [['yours', 2]]);

  // Only what's said: set aside with its passage, and a read leaves it there
  const T = shelf([[LINE]]);
  await Canon.createEngine({ io: T.io, reader }).readShelf();
  const p = T.entry('pio');
  Canon.setAsideFact(p, p.facts.findIndex((f) => f.attr === 'sex'), false);
  T.files.pio = Canon.serialiseEntry(p);
  await Canon.createEngine({ io: T.io, reader }).readShelf({ again: true });
  assert.deepEqual(T.entry('pio').facts.filter((f) => f.attr === 'sex'), []);
});

test('the same fact twice is one: an entry with twelve "Sex: female · yours" heals on load, keeping every source', () => {
  const copy = '- Sex: female · yours\n  - Written in Canon\n';
  const text = '---\nid: pio\nname: Pio\nkind: person\naliases: []\n---\n# Pio\n\n## Facts\n'
    + '- Sex: female · unverified\n  - The Academy, Ch 1: "the lady, and Pio laid down in her bed" {book:acad, ch:c1, said}\n'
    + copy.repeat(12)
    + '- Home: Academy · verified\n  - The Academy, Ch 1: "Pio lived at the Academy" {book:acad, ch:c1}\n'
    + '- Home: Academy · verified\n  - The Academy, Ch 2: "back at the Academy, Pio" {book:acad, ch:c2}\n'
    + '- Eyes: grey (storm grey) · yours\n  - Written in Canon\n'
    + '- Eyes: grey (slate) · yours\n  - Written in Canon\n'
    + '\n## In my words\nPio is mine.\n';
  const e = Canon.parseEntry(text);
  assert.ok(e.merged > 0);
  const sex = e.facts.filter((f) => f.attr === 'sex');
  // one fact, the writer's, citing the line it confirmed: no question waits
  assert.equal(sex.length, 1);
  assert.equal(sex[0].state, 'yours');
  assert.deepEqual(sex[0].sources.map((s) => s.written ? 'written' : s.quote), ['written', 'the lady, and Pio laid down in her bed']);
  // two passages for one value: one fact, both passages
  assert.deepEqual(e.facts.filter((f) => f.attr === 'home').map((f) => f.sources.map((s) => s.ch)), [['c1', 'c2']]);
  // two descriptions the writer typed are kept apart
  assert.deepEqual(e.facts.filter((f) => f.attr === 'eyes').map((f) => f.as), ['storm grey', 'slate']);
  const out = Canon.serialiseEntry(e);
  assert.equal(out.match(/- Sex: female/g).length, 1);
  assert.match(out, /## In my words\nPio is mine\.\n$/);
  // healed once, the file reads the same and merges nothing more
  assert.equal(Canon.parseEntry(out).merged, 0);
  assert.equal(Canon.serialiseEntry(Canon.parseEntry(out)), out);
  // and written, the same fact is never written twice
  const twice = Canon.newEntry('Pio', 'person');
  twice.facts.push(Canon.handFact('Sex: female'), Canon.handFact('Sex: female'));
  assert.equal(Canon.serialiseEntry(twice).match(/- Sex: female/g).length, 1);
});

test('the owner\'s entry, read again: the line the old reading took for dialogue is narration, one fact, nothing waits', async () => {
  const S = shelf([[`${FLEETS} ${BED}`, ARMS]]);
  S.files.pio = '---\nid: pio\nname: Pio\nkind: person\naliases: []\n---\n# Pio\n\n## Facts\n'
    + '- Sex: female · unverified\n  - The Academy, Ch 1: "the lady, and Pio laid down in her bed" {book:acad, ch:c1, said}\n\n## In my words\n';
  const r = await Canon.createEngine({ io: S.io, reader: Canon.fakeReader({}) }).readShelf();
  const sex = S.entry('pio').facts.filter((f) => f.attr === 'sex');
  assert.deepEqual(sex.map((f) => [f.value, f.state, f.sources.some((s) => s.said)]), [['female', 'verified', false]]);
  assert.equal(r.needs, 0);
});
