'use strict';

// Every text-level function of Canon over many generated sentences: none
// may throw, whatever the writer types (a contraction, a stray quotation
// mark, a name that is also a month, an empty paragraph). The held-out
// evaluation found a crash in swapPronoun ("He's" was in no table); this
// holds the whole reading to the same standard. A seeded generator, so a
// failure prints the seed and the text that broke it.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const Canon = require('../canon.js');

const E = Canon.Editor;

// a small seeded generator (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pickOf = (r) => (xs) => xs[Math.floor(r() * xs.length)];

const NAMES = ['Mara', 'John Hale', 'Hale', 'Tamsin', 'Ilsa Varr', 'Varr', 'the warden', 'Corwick', 'Corwyck', 'April', 'Monday', 'Easter', 'French', 'Someone', 'Nine', 'Unit Nine', 'the Long Room', 'Brennock', 'the Sare', 'Bramble', 'Dr Okafor', 'Mrs. Pell', 'O’Brien', 'Jean-Luc', 'Æsa', 'Zoë'];
const PRONOUNS = ['he', 'she', 'He', 'She', 'his', 'her', 'His', 'Her', 'him', 'hers', 'himself', 'herself', "He's", "She's", 'He’s', 'She’s', "he'd", 'she’ll', "Her's", 'HIS', 'they', 'their', 'I', 'my', 'me', 'we', 'it', 'its'];
const WORDS = ['eyes', 'hair', 'grey', 'blue', 'green', 'fair', 'black', 'red', 'brown', 'mare', 'stallion', 'girl', 'man', 'woman', 'sister', 'brother', 'elder', 'younger', 'mother’s', "father's", 'born', 'in', 'at', 'the', 'a', 'gave', 'took', 'crust', 'window', 'windows', 'not', 'no', 'never', 'every', 'morning', 'always', 'called', 'named', 'known as', 'was', 'is', 'had', 'has', 'said', 'told', 'thought', 'remembered', 'forty', '41', 'twelve', 'thin', 'stout', 'tall', 'short', 'cold', 'warm', 'room', 'gate', 'town', 'river', 'car', 'Rover', 'P6', 'of', 'and', 'but', 'then', 'who', 'which', '—', '–', '…', ',', ';', ':', '(', ')'];
const MARKS = ['"', '“', '”', '‘', '’', "'", '«', '»', '„', ''];
const ENDS = ['.', '!', '?', '…', '."', '.”', '?”', '', '...', '!’'];

function sentence(r) {
  const pick = pickOf(r);
  const n = 2 + Math.floor(r() * 14);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const x = r();
    parts.push(x < 0.25 ? pick(NAMES) + (r() < 0.2 ? (r() < 0.5 ? "'s" : '’s') : '') : x < 0.45 ? pick(PRONOUNS) : x < 0.55 ? pick(MARKS) + pick(WORDS) : pick(WORDS));
  }
  let s = parts.join(r() < 0.1 ? '' : ' ');
  if (r() < 0.3) s = pick(MARKS) + s + pick(MARKS);
  return s.charAt(0).toUpperCase() + s.slice(1) + pick(ENDS);
}
function paragraph(r) {
  const n = Math.floor(r() * 5);
  const ss = [];
  for (let i = 0; i < n; i++) ss.push(sentence(r));
  if (r() < 0.05) return '';
  return ss.join(r() < 0.1 ? '' : ' ');
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function html(r, paras) {
  const out = [];
  for (let i = 0; i < paras; i++) {
    const p = paragraph(r);
    out.push(r() < 0.05 ? `<p class="scene-break">***</p>` : `<p>${r() < 0.1 ? '<em>' + esc(p) + '</em>' : esc(p)}${r() < 0.05 ? '<br>' : ''}</p>`);
  }
  return out.join('\n');
}

// a reader that answers anything at all, in the right shape: names that
// are and aren't in the text, sentence ids out of range, every verdict
function chaosReader(r) {
  const pick = pickOf(r);
  const wordsIn = (text) => (String(text).match(/[\p{L}\p{N}'’-]+/gu) || ['x']);
  const some = (text, n) => Array.from({ length: n }, () => pick(wordsIn(text))).join(' ');
  return {
    id: 'chaos', calls: 0, judgeRelations: true, editor: true, parallel: 1 + Math.floor(r() * 2), tier: 'careful',
    async propose({ text }) { return Array.from({ length: Math.floor(r() * 4) }, () => ({ entity: pick([...NAMES, some(text, 1)]), kind: pick(['person', 'creature', 'place', 'thing', 'group']), attr: pick(['sex', 'species', 'eyes', 'hair', 'birthplace', 'sibling', 'parent', 'child', 'spouse', 'owner', 'home']), value: some(text, 1 + Math.floor(r() * 2)), quote: some(text, 3) })); },
    async judge() { return pick(['yes', 'no', 'unclear']); },
    async refers() { return pick(['yes', 'no', 'unclear', 'unasked']); },
    async events({ text }) { return Array.from({ length: Math.floor(r() * 3) }, () => ({ who: [pick(NAMES), some(text, 1)], did: pick(NAMES) + ' ' + some(text, 4), where: r() < 0.5 ? '' : some(text, 2), quote: r() < 0.7 ? String(text).slice(0, Math.floor(r() * 120)) : some(text, 5) })); },
    async contradicts() { return pick(['yes', 'no', 'unclear', 'unasked']); },
    async cast({ text, names = [] }) {
      const caps = String(text).match(/\p{Lu}[\p{Ll}’'-]+(?:\s\p{Lu}[\p{Ll}’'-]+)?/gu) || [];
      return { cast: Array.from({ length: Math.floor(r() * 8) }, () => ({ name: pick([...caps, ...NAMES, ...names, 'She', 'the children', '']), kind: pick(['person', 'creature', 'place', 'group', 'thing', 'rule', 'bogus']), aliases: Array.from({ length: Math.floor(r() * 3) }, () => pick([...caps, ...NAMES, 'he'])) })), setting: r() < 0.5 ? pick([...caps, ...NAMES, '']) : '' };
    },
    async dossier({ text, n }) {
      return Array.from({ length: Math.floor(r() * 8) }, () => ({
        g: pick([...E.GROUPS, 'bogus', undefined]), a: pick(['hair', 'eyes', 'age', 'sex', 'role', 'habit', 'kin', 'mother', 'home', 'car', '', 'a very long label of many words']),
        v: r() < 0.1 ? '' : some(text, 1 + Math.floor(r() * 6)), s: Array.from({ length: Math.floor(r() * 4) }, () => Math.floor(r() * ((n || 3) + 3)) - 1), x: r() < 0.2 ? 1 : 0
      }));
    },
    async verify() { return pick(['yes', 'no', 'unclear', undefined]); },
    async choose({ options = [] } = {}) { return pick([...options, null, 'nobody']); },
    async profile({ facts }) { return Array.from({ length: Math.floor(r() * 4) }, () => ({ t: facts.length ? facts.map((f) => f.value).slice(0, 2).join(' and ') + (r() < 0.3 ? ' [1]' : '') : 'Nothing', f: Array.from({ length: 1 + Math.floor(r() * 3) }, () => Math.floor(r() * (facts.length + 2))) })); },
    async clash() { return pick(['yes', 'no', 'unclear', 'unasked']); },
    async pick() { return null; },
    abort() {}
  };
}

function memoryIO(sources, entries = []) {
  const files = new Map(entries.map((e) => [e.id, Canon.serialiseEntry(e)]));
  let meta = { v: 1, read: {}, out: {} };
  let cache = null;
  return {
    sources: async () => sources,
    meta: async () => structuredClone(meta),
    saveMeta: async (m) => { meta = structuredClone(m); },
    entries: async () => [...files].map(([id, text]) => ({ id, text })),
    saveEntry: async (id, text) => { files.set(id, text); },
    notSlips: async () => [],
    cache: async () => cache && structuredClone(cache),
    saveCache: async (c) => { cache = structuredClone(c); },
    knownWords: async (ws) => Object.fromEntries(ws.map((w) => [w, w.length % 3 !== 0])),
    files
  };
}

// a few entries with traits and kin, so the slip checkers have facts to test against
function seedEntries() {
  const e = (name, kind, id, facts, aliases = []) => ({ ...Canon.newEntry(name, kind, id), aliases, facts: facts.map(([attr, value, as = '']) => ({ attr, value, as, state: 'yours', sources: [{ written: true }] })) });
  return [
    e('Mara', 'person', 'mara', [['sex', 'female'], ['eyes', 'grey'], ['hair', 'red'], ['sibling', 'John Hale', 'elder']]),
    e('John Hale', 'person', 'john-hale', [['sex', 'male'], ['eyes', 'blue'], ['birthplace', 'Corwick']], ['John']),
    e('Bramble', 'creature', 'bramble', [['sex', 'female', 'mare'], ['species', 'horse']]),
    e('Corwick', 'place', 'corwick', []),
    e('the warden', 'person', 'the-warden', [['sex', 'male']], ['warden'])
  ];
}

test('fuzz: the pronoun swap, every form ("He\'s", "her", "Hers"), never undefined', async () => {
  const r = rng(7);
  for (let i = 0; i < 400; i++) {
    const text = `Mara came in. ${sentence(r)} He's here. She's gone. His eyes were blue. Her hair was black. Him, again. Hers too. Himself. HERSELF.`;
    // (paraCandidates is inside checkSources; this reaches it the way the pass does)
    const { slips, asks } = await Canon.checkSources({ sources: [{ bookId: 'b', chId: 'c', label: 'Ch 1', html: `<p>${esc(text)}</p>` }], entries: seedEntries() });
    for (const x of [...slips, ...asks]) assert.ok(typeof x.to === 'string' && x.to.length, text);
  }
});

test('fuzz: sentences, speech, reported speech and the source paragraphs never throw and stay inside the text', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed);
    const text = paragraph(r);
    const ctx = `seed ${seed}: ${text}`;
    const ss = Canon.sentences(text);
    for (const s of ss) assert.ok(s.start >= 0 && s.end <= text.length + 1, ctx);
    for (const [a, b] of [...Canon.speechSpans(text), ...Canon.reportedSpans(text)]) assert.ok(a >= 0 && b <= text.length + 1 && a <= b, ctx);
    assert.ok(Array.isArray(Canon.sourceParas(html(r, 3))), ctx);
  }
});

test('fuzz: the editor\'s code on generated chapters (cast gate, packs, fact gates, clauses, clashes, profiles)', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const r = rng(seed);
    const pick = pickOf(r);
    const paras = Canon.sourceParas(html(r, 2 + Math.floor(r() * 6)));
    const ctx = `seed ${seed}`;
    assert.doesNotThrow(() => {
      const ch = E.chapterModel(paras);
      const names = Canon.shelfNames([ch.text]);
      const proposals = Array.from({ length: 6 }, () => ({ name: pick([...NAMES, 'She', 'the children', '']), kind: pick(['person', 'place', 'group', 'thing', 'creature', 'rule', 'x']), aliases: [pick(NAMES)] }));
      const cast = E.castGate({ proposals, setting: pick(['', ...NAMES]), ch, entries: seedEntries(), names });
      cast.forEach((c, i) => { c.key = i; });
      const hits = E.chapterHits(ch, cast);
      const sexOf = () => pick([null, 'male', 'female']);
      E.sexHints(ch, hits, cast);
      for (const c of cast) {
        const pack = E.packFor(ch, hits, cast, c, sexOf);
        for (const part of E.packParts(pack)) {
          for (let k = 0; k < 4; k++) {
            const x = { g: pick(E.GROUPS), a: pick(['hair', 'eyes', 'role', 'habit', 'mother', '']), v: part.text.split(/\s+/).slice(2, 2 + Math.floor(r() * 5)).join(' '), s: [1 + Math.floor(r() * part.lines.length)], x: 0 };
            E.gateFact(x, part, c, { ch, text: ch.text, cast, suspect: new Set() });
          }
          for (const l of part.lines) E.clauseOf(l.s, E.content(l.s.text).slice(0, 2));
        }
      }
      for (const s of ch.sents) {
        E.clashDetail({ value: pick(['no windows', 'thin', 'forty beds', 'grey']), as: '' }, pick(ch.sents).text, s.text, [pick(NAMES)]);
        E.profileOk(s.text, [{ label: 'Hair', value: 'fair', sources: [{ quote: s.text }] }], { name: 'Mara', aliases: [] });
      }
    }, ctx);
  }
});

test('fuzz: Read the Shelf and the Continuity Pass with a reader that answers anything', async () => {
  for (let seed = 1; seed <= 40; seed++) {
    const r = rng(seed * 101);
    const sources = [
      { bookId: 'book-a', chId: 'c1', book: 'A', label: 'Ch 1', html: html(r, 4 + Math.floor(r() * 5)) },
      { bookId: 'book-a', chId: 'c2', book: 'A', label: 'Ch 2', html: html(r, 3 + Math.floor(r() * 5)) },
      { bookId: 'book-n', chId: 'n1', book: 'Notes', label: 'Ideas', notebook: true, html: html(r, 2) },
      { bookId: 'book-a', chId: 'notes', book: 'A', label: 'Notes', notes: true, html: html(r, 2) }
    ];
    const io = memoryIO(sources, r() < 0.5 ? seedEntries() : []);
    const engine = Canon.createEngine({ io, reader: chaosReader(r) });
    try {
      await engine.readShelf({});
      await engine.check({ scope: 'shelf' });
      // and what it wrote reads back
      for (const [, text] of io.files) Canon.parseEntry(text);
      // a second read, from the cache
      await engine.readShelf({});
    } catch (err) {
      err.message = `seed ${seed * 101}: ${err.message}\n${sources.map((s) => s.html).join('\n')}`;
      throw err;
    }
  }
});
