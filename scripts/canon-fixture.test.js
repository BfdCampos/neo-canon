'use strict';

// Canon on the Ashfall Road fixture (scripts/fixtures/canon): the Continuity
// Pass and Read the Shelf, with the fake reader and the real en-US dictionary.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const Canon = require('../canon.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'canon');
const ANSWERS = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'reader-answers.json'), 'utf8'));
const EXPECTED = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'expected.json'), 'utf8'));
const CANON = 'canon-the-ashfall-road-shelf-ash';
const SALT = 'book-the-salt-crown-salt2';

// the spelling dictionary NEO ships, straight from Hunspell's WebAssembly
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

// what main.js reads for a shelf, from a library folder: chapters in shelf
// order, a book's Notes after its chapters, a notebook's pages by their titles
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

// expected.json's entries, every fact the writer's own
function handKept() {
  return EXPECTED.entries.map((x) => {
    const e = Canon.newEntry(x.name, x.kind, x.id);
    for (const f of x.facts) if (!f.said && !f.plan) e.facts.push({ attr: f.attr, value: f.value, as: f.as || '', state: 'yours', sources: [{ written: true }] });
    return e;
  });
}

const notSlips = () => JSON.parse(fs.readFileSync(path.join(FIXTURE, 'library', CANON, 'not-slips.json'), 'utf8'));
const pick = (s) => ({ chapter: s.chId, sentence: s.sentence, span: s.span, to: s.to, entry: s.entry, attr: s.attr, strength: s.strength });

test('Continuity Pass, kept by hand with no reader: the three strong slips in The Salt Crown', async () => {
  const sources = shelfSources(path.join(FIXTURE, 'library')).filter((s) => s.bookId === SALT && !s.notes);
  const { slips } = await Canon.checkSources({ sources, entries: handKept(), notSlips: notSlips(), knownWords });
  assert.deepEqual(slips.map(pick), EXPECTED.slips.filter((s) => s.strength === 'strong'));
});

test('Continuity Pass with the reader: exactly the five seeded slips, no decoy', async () => {
  const sources = shelfSources(path.join(FIXTURE, 'library')).filter((s) => s.bookId === SALT && !s.notes);
  const seen = [];
  const { slips, facts } = await Canon.checkSources({ sources, entries: handKept(), notSlips: notSlips(), knownWords,
    reader: Canon.fakeReader(ANSWERS), onSource: (src, found, n, of) => seen.push([src.chId, found.length, n, of]) });
  assert.deepEqual(slips.map(pick), EXPECTED.slips);
  assert.deepEqual(seen, [['c1', 2, 1, 3], ['c2', 2, 2, 3], ['c3', 1, 3, 3]]);
  assert.equal(facts, 10); // the ones that can raise slips: no titles, owners or states
  for (const decoy of EXPECTED.decoys) assert.ok(!slips.some((s) => s.sentence === decoy), decoy);
  // each mark sits on its word in the writer's own text
  for (const s of slips) {
    const p = Canon.sourceParas(sources.find((x) => x.chId === s.chId).html).find((x) => x.hash === s.para);
    assert.equal(p.text.slice(s.at, s.at + s.span.length), s.span);
  }
});

test('the whole shelf: Book 1, the notebook and the decoys stay clean', async () => {
  const sources = shelfSources(path.join(FIXTURE, 'library')).filter((s) => !s.notes && !(s.bookId === 'book-field-notes-notes3' && s.chId === 'p3'));
  const { slips } = await Canon.checkSources({ sources, entries: handKept(), notSlips: notSlips(), knownWords, reader: Canon.fakeReader(ANSWERS) });
  assert.deepEqual(slips.map((s) => s.bookId), Array(5).fill(SALT));
});

test('the dismissed firelight line comes back once its sentence is edited', async () => {
  const sources = shelfSources(path.join(FIXTURE, 'library')).filter((s) => s.bookId === SALT && s.chId === 'c3');
  sources[0].html = sources[0].html.replace('almost brown in the firelight', 'almost brown in the lamplight');
  const { slips } = await Canon.checkSources({ sources, entries: handKept(), notSlips: notSlips(), knownWords });
  assert.deepEqual(slips.map((s) => [s.span, s.to, s.fact]), [['brown', 'grey', 'ilsa-varr/eyes']]);
});
