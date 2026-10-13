'use strict';

// Canon against an editor's answer sheet: what a run of the reading engine
// left in a Canon folder (entries/*.md, and the pass's slips), scored the way
// a story editor would mark it. A dev tool, not part of `npm test`.
// docs/semantics/READING.md §9.
//
//   node scripts/canon-score.js <run> <answers.json> [--library <dir>] [--slips <file>]
//                               [--reviewed <file>] [--json <file>] [--review] [--quiet]
//   node scripts/canon-score.js --check <answers.json> [--library <dir>]
//
// <run> is a folder holding canon/entries/*.md and slips.json (what
// `canon-eval.js --keep` writes), or a Canon folder itself (entries/*.md).
// The library (for verbatim checks) defaults to library/ beside answers.json.
// answers.json is an editor's sheet (scripts/fixtures/canon-editor/*) or an
// older fixture's expected.json, read as one (every checked fact a must).
//
// Scored, all deterministic:
//   entities   answer entities found by name or alias (weighted must 3, should 2, nice 1)
//   facts      answer facts matched by a kept fact (verified or yours) of that entity:
//              attribute family + value tokens (synonyms, the sheet's alt phrases)
//              + quote overlap; must-recall on its own. "offered" counts Needs You too.
//   precision  each kept fact: supported (matches an answer fact), wrong (matches a
//              trap, a "said" fact kept as true, or a quote not in the text), or
//              review (quote verbatim, claim unknown): listed for a person, never
//              guessed. --reviewed <file> holds those judgements ({ key: true|false }).
//   key points the sheet's key points found in Story so far (quote or words)
//   slips      must slips found, nice ones not counted either way; false slips,
//              decoys named; Worth a look listed apart
//   profiles   ## Profile present for the entities the sheet marks, every
//              sentence citing [n], every [n] a verbatim quote

const fs = require('node:fs');
const path = require('node:path');
const Canon = require('../canon.js');

const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf('--' + name); return i < 0 ? fallback : argv[i + 1]; };
const flag = (name) => argv.includes('--' + name);
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i && argv[i - 1].startsWith('--') && !['--review', '--quiet'].includes(argv[i - 1])));

const N = (s) => Canon.norm(String(s || ''));
const WEIGHT = { must: 3, should: 2, nice: 1 };

/* ---------- words ---------- */

const STOP = new Set(('a an the and or but of to in on at by for with from into onto as is was were be been being are it its it\'s this that these those ' +
  'her his him he she they them their there here who whom which what when where while than then so very much more most some any all ' +
  'has have had do does did not no nor only own same such too can will would could should may might must just also each every ' +
  'one once up down out over under again further about above below after before between through during without within ' +
  'i me my we our you your himself herself itself themselves s').split(' '));
// one word in a common form: plural, past, -ing and -ly off; British and American spelling
const VARIANT = { gray: 'grey', colour: 'color', colored: 'color', coloured: 'color', blond: 'blonde' };
function stem(w) {
  w = VARIANT[w] || w;
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('ly')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('es') && !w.endsWith('ses')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}
const words = (s) => N(s).replace(/['’]s\b/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const content = (s) => words(s).filter((w) => !STOP.has(w)).map(stem);
// Values that mean the same in a story bible. Each group's words stand for
// each other (after stemming).
const SYNONYMS = [
  ['female', 'woman', 'girl', 'lady', 'she', 'her'], ['male', 'man', 'boy', 'he', 'him', 'gentleman'],
  ['fair', 'blonde', 'straw', 'golden', 'flaxen'], ['black', 'dark', 'jet'], ['grey', 'silver', 'ash'], ['brown', 'chestnut', 'brunette'],
  ['thin', 'narrow', 'skinny', 'rake', 'lean', 'slight', 'gaunt', 'bony'], ['big', 'large', 'heavy', 'stout', 'fat', 'broad', 'huge'],
  ['old', 'elderly', 'aged', 'ancient'], ['young', 'youth', 'child', 'kid'], ['tall', 'tallest', 'taller'], ['short', 'shorter', 'small', 'little'],
  ['spectacle', 'glass', 'eyeglass'], ['cropped', 'crop', 'shorn', 'close'], ['window', 'windowless'], ['friend', 'friendship', 'companion', 'ally'],
  ['born', 'birth', 'birthplace'], ['job', 'work', 'occupation', 'role', 'duty'], ['hum', 'humm', 'hymn'], ['rule', 'law', 'regulation'],
  ['every', 'each', 'daily', 'always'], ['morning', 'dawn', 'daybreak'], ['sick', 'ill', 'vomit'], ['gentle', 'gently', 'soft', 'careful'],
  ['watch', 'watchful', 'observe', 'observant', 'notice'], ['tattoo', 'ink', 'inked', 'mark'], ['valley', 'lowland'], ['bread', 'crust']
].map((g) => g.map(stem));
const SYN = new Map();
for (const g of SYNONYMS) for (const w of g) SYN.set(w, g[0]);
const canonWord = (w) => SYN.get(w) || w;
const bag = (s) => new Set(content(s).map(canonWord));
function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / Math.min(a.size, b.size);
}

/* ---------- attributes ---------- */

// An open label, as a reader or a writer wrote it, to the canonical set
// (READING.md §5). Unknown labels stay themselves and match by family only
// through the catch-all ('description', 'other', 'note').
const LABELS = {
  sex: 'sex', gender: 'sex',
  age: 'age', 'how old': 'age',
  eyes: 'appearance.eyes', eye: 'appearance.eyes', 'eye colour': 'appearance.eyes', 'eye color': 'appearance.eyes',
  hair: 'appearance.hair', 'hair colour': 'appearance.hair', 'hair color': 'appearance.hair', haircut: 'appearance.hair',
  height: 'appearance.height', build: 'appearance.build', body: 'appearance.build', figure: 'appearance.build', size: 'appearance.build',
  face: 'appearance.face', skin: 'appearance.face', clothing: 'appearance.clothing', clothes: 'appearance.clothing', dress: 'appearance.clothing', wears: 'appearance.clothing', outfit: 'appearance.clothing',
  mark: 'appearance.mark', marks: 'appearance.mark', tattoo: 'appearance.mark', scar: 'appearance.mark', 'distinguishing mark': 'appearance.mark',
  appearance: 'appearance', looks: 'appearance', look: 'appearance', 'physical description': 'appearance', glasses: 'appearance.other', spectacles: 'appearance.other',
  species: 'species',
  role: 'role', job: 'occupation', occupation: 'occupation', work: 'occupation', profession: 'occupation', duty: 'role', duties: 'role', position: 'role', title: 'role', rank: 'role',
  personality: 'personality', temperament: 'personality', character: 'personality', trait: 'personality', traits: 'personality', nature: 'personality', manner: 'manner', 'manner of speech': 'manner.speech', speech: 'manner.speech', voice: 'manner.speech', accent: 'manner.speech',
  habit: 'habit', habits: 'habit', routine: 'routine', routines: 'routine', custom: 'custom', customs: 'custom', practice: 'custom', ritual: 'routine', schedule: 'routine',
  relationship: 'relationship', relationships: 'relationship', friend: 'relationship.friend', friends: 'relationship.friend', 'friend of': 'relationship.friend', ally: 'relationship.friend', enemy: 'relationship.enemy',
  sibling: 'relationship.kin', 'child of': 'relationship.kin', 'parent of': 'relationship.kin', 'married to': 'relationship.kin', kin: 'relationship.kin', family: 'relationship.kin', spouse: 'relationship.kin',
  owner: 'possession', possession: 'possession', possessions: 'possession', carries: 'possession', owns: 'possession', belongings: 'possession',
  origin: 'origin', 'born in': 'origin', birthplace: 'origin', born: 'origin', from: 'origin', background: 'history', backstory: 'history', history: 'history', past: 'history',
  'lives in': 'location.home', home: 'location.home', residence: 'location.home', location: 'location', where: 'location', situated: 'location', place: 'location', 'part of': 'location.part', parts: 'location.part', rooms: 'location.part',
  description: 'description', 'what it is like': 'description', features: 'description', layout: 'description', atmosphere: 'atmosphere', smell: 'atmosphere', sound: 'atmosphere', light: 'atmosphere', mood: 'atmosphere',
  rule: 'rule', rules: 'rule', law: 'rule', laws: 'rule', system: 'rule', 'how it works': 'rule',
  membership: 'membership', member: 'membership', group: 'membership', caste: 'membership', 'belongs to': 'membership', members: 'members', residents: 'residents', 'who is there': 'residents', inhabitants: 'residents',
  state: 'state', condition: 'state', health: 'state', status: 'state',
  name: 'name', nickname: 'name', alias: 'name', 'also known as': 'name', called: 'name',
  function: 'function', purpose: 'function', use: 'use', effect: 'effect', effects: 'effect', taste: 'description',
  opinion: 'opinion', belief: 'opinion', skill: 'skill', skills: 'skill', ability: 'skill',
  other: 'other', note: 'other', notes: 'other', fact: 'other', detail: 'other'
};
// families: the attributes an editor would let stand for each other
const FAMILY = { occupation: 'role', routine: 'habit', custom: 'habit', atmosphere: 'description', residents: 'description', function: 'function', use: 'function', effect: 'function', members: 'membership', 'manner.speech': 'personality', manner: 'personality', opinion: 'personality', origin: 'origin', history: 'history', species: 'species', skill: 'role' };
const family = (a) => FAMILY[a] || a.split('.')[0];
function canonLabel(label) {
  const l = N(label).replace(/[_]/g, ' ').trim();
  if (LABELS[l]) return LABELS[l];
  if (/^[a-z]+(?:\.[a-z]+)+$/.test(l)) return l; // already canonical: appearance.hair
  const last = l.split(/\s+/).pop();
  const first = l.split(/\s+/)[0];
  return LABELS[last] || LABELS[first] || l;
}
// legacy closed attributes (canon.js ATTRS) in the canonical set
const LEGACY = { sex: 'sex', species: 'species', eyes: 'appearance.eyes', hair: 'appearance.hair', birthplace: 'origin', sibling: 'relationship.kin', parent: 'relationship.kin', child: 'relationship.kin', spouse: 'relationship.kin', owner: 'possession', home: 'location.home', title: 'role', state: 'state' };
const CATCH_ALL = new Set(['other', 'description']);
function attrScore(produced, answer) {
  if (produced === answer) return 1;
  if (family(produced) === family(answer)) return 0.8;
  if (CATCH_ALL.has(produced) || CATCH_ALL.has(family(produced))) return 0.5;
  return 0;
}

/* ---------- the texts ---------- */

function shelfSources(lib) {
  const library = JSON.parse(fs.readFileSync(path.join(lib, 'library.json'), 'utf8'));
  const out = [];
  for (const shelf of library.shelves) {
    for (const bookId of shelf.bookIds) {
      const meta = JSON.parse(fs.readFileSync(path.join(lib, bookId, 'book.json'), 'utf8'));
      for (const chId of meta.chapterOrder) out.push({ bookId, chId, html: fs.readFileSync(path.join(lib, bookId, 'chapters', chId + '.html'), 'utf8') });
      const notes = path.join(lib, bookId, 'notes.html');
      if (fs.existsSync(notes)) out.push({ bookId, chId: 'notes', html: fs.readFileSync(notes, 'utf8') });
    }
  }
  return out.map((s) => ({ ...s, text: Canon.sourceParas(s.html).map((p) => p.text).join('\n') }));
}
function textIndex(lib) {
  const sources = lib && fs.existsSync(path.join(lib, 'library.json')) ? shelfSources(lib) : [];
  const byCh = new Map();
  for (const s of sources) {
    byCh.set(s.bookId + '/' + s.chId, N(s.text));
    byCh.set(s.chId, (byCh.has(s.chId) ? byCh.get(s.chId) + '\n' : '') + N(s.text));
  }
  const all = sources.map((s) => N(s.text)).join('\n');
  return {
    has: !!sources.length,
    // verbatim in the chapter named (book/ch or ch), else anywhere on the shelf
    verbatim: (quote, ch, book) => {
      const q = N(quote);
      if (!q) return false;
      const t = (book && byCh.get(book + '/' + ch)) || (ch && byCh.get(ch));
      return t ? t.includes(q) : all.includes(q);
    }
  };
}

/* ---------- the answer sheet ---------- */

function readAnswers(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (raw.entities) return raw;
  // an older fixture's expected.json: checked facts are musts, the rest nice
  const entities = raw.entries.map((x) => ({
    id: x.id, name: x.name, kind: x.kind, aliases: x.aliases || [], weight: 'must', profile: false,
    facts: x.facts.map((f) => ({
      attr: LEGACY[f.attr] || f.attr, value: f.value, alt: f.as ? [f.as] : [], quote: '', ch: (f.chapters || [''])[0].split('/').pop(),
      weight: f.state === 'verified' ? 'must' : 'nice', said: !!(f.said || f.plan), hard: ['sex', 'species', 'eyes', 'hair'].includes(f.attr)
    })),
    traps: []
  }));
  const keyPoints = Object.entries(raw.story || {}).flatMap(([id, lines]) => lines.map((did) => ({ who: [id], did, quote: '', weight: 'must' })));
  return {
    about: 'read from ' + path.basename(file) + ' (legacy expected.json)', set: 'legacy', legacy: true, entities, keyPoints,
    slips: (raw.slips || []).map((s) => ({ ch: s.chapter, kind: s.attr === 'event' ? 'deed' : 'trait', entity: s.entry, attr: s.attr, sentence: s.sentence, span: s.span, weight: 'must' })),
    decoys: (raw.decoys || []).map((d) => (typeof d === 'string' ? { sentence: d } : d))
  };
}

function checkAnswers(answers, texts) {
  const bad = [];
  const see = (where, quote, ch) => { if (quote && !texts.verbatim(quote, ch)) bad.push(`${where}: "${quote}" (${ch || 'shelf'})`); };
  for (const e of answers.entities) {
    for (const f of e.facts) {
      see(`${e.name} · ${f.attr}`, f.quote, f.ch);
      // (another passage may be in another chapter)
      for (const q of f.also || []) see(`${e.name} · ${f.attr} (also)`, q, null);
    }
  }
  for (const k of answers.keyPoints || []) { see(`key point "${k.did}"`, k.quote, k.ch); for (const q of k.also || []) see(`key point "${k.did}" (also)`, q, null); }
  for (const s of answers.slips || []) {
    see(`slip "${s.span}"`, s.sentence, s.ch);
    if (s.sentence && !N(s.sentence).includes(N(s.span))) bad.push(`slip span "${s.span}" not in its sentence`);
    if (s.against) see(`slip "${s.span}" against`, s.against.quote, s.against.ch);
  }
  for (const d of answers.decoys || []) see('decoy', d.sentence, d.ch);
  return bad;
}

/* ---------- a run ---------- */

function readRun(run) {
  const dirs = [path.join(run, 'canon', 'entries'), path.join(run, 'entries'), run];
  const dir = dirs.find((d) => fs.existsSync(d) && fs.readdirSync(d).some((f) => f.endsWith('.md')));
  const slipsFile = [path.join(run, 'slips.json'), path.join(run, '..', 'slips.json')].find((f) => fs.existsSync(f)) || null;
  if (!dir) return { entries: [], slipsFile };
  const entries = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    return { ...Canon.parseEntry(text), id: f.slice(0, -3), raw: text };
  }).filter((e) => !e.error);
  return { entries, slipsFile };
}

// "## Profile": prose whose every sentence cites [n], and the [n] lines
// under it: - [1] Book, Ch 1: "quote" {book:…, ch:…} (READING.md §6)
function readProfile(raw) {
  const m = /(?:^|\n)## Profile\n([\s\S]*?)(?=\n## |$)/.exec(String(raw).replace(/\r\n?/g, '\n'));
  if (!m) return null;
  const lines = m[1].split('\n');
  const cites = new Map();
  const prose = [];
  for (const line of lines) {
    const c = /^\s*[-*] \[(\d+)\] (.*?): "(.*)" \{([^{}]*)\}\s*$/.exec(line);
    if (c) {
      const ref = Object.fromEntries(c[4].split(',').map((x) => x.trim().split(':')).map(([k, ...v]) => [k, v.join(':').trim()]));
      cites.set(c[1], { label: c[2], quote: c[3], book: ref.book, ch: ref.ch });
    } else if (line.trim()) prose.push(line.trim());
  }
  const text = prose.join(' ');
  const sentences = text.split(/(?<=[.!?](?:\s*\[\d+\])*)\s+(?=[A-Z“"‘'])/).map((s) => s.trim()).filter(Boolean);
  return { text, sentences, cites };
}

/* ---------- matching ---------- */

function entityMatcher(answers) {
  const strip = (s) => N(s).replace(/^(?:the|a|an)\s+/, '');
  const names = new Map();
  for (const e of answers.entities) for (const n of [e.name, ...(e.aliases || [])]) names.set(strip(n), e);
  return (entry) => {
    for (const n of [entry.name, ...(entry.aliases || [])]) { const hit = names.get(strip(n)); if (hit) return hit; }
    // a name part only one answer person carries ("Ilsa" for Ilsa Varr)
    const parts = answers.entities.filter((e) => e.kind === 'person' && [e.name, ...(e.aliases || [])].some((a) => Canon.nameParts(a).some((p) => strip(p) === strip(entry.name))));
    return parts.length === 1 ? parts[0] : null;
  };
}

function valueScore(pValue, pAs, aFact) {
  const p = bag(pValue + ' ' + (pAs || ''));
  let best = overlap(p, bag(aFact.value));
  for (const alt of aFact.alt || []) {
    const b = bag(alt);
    if (b.size && [...b].every((w) => p.has(w))) best = Math.max(best, 1);
  }
  return best;
}
function quoteScore(pQuotes, aFact) {
  let best = 0;
  for (const q of pQuotes) {
    for (const a of [aFact.quote, ...(aFact.also || [])].filter(Boolean)) {
      if (N(a).includes(N(q)) || N(q).includes(N(a))) return 1;
      best = Math.max(best, overlap(new Set(words(q)), new Set(words(a))));
    }
  }
  return best;
}
// The answer fact a produced fact stands for, or null. Deterministic: value
// words must overlap (a different claim from the same quote is not a
// match); then attribute family, value and quote are weighed together.
function matchFact(pf, aFacts) {
  let best = null;
  for (const a of aFacts) {
    const v = valueScore(pf.value, pf.as, a);
    if (v < 0.34) continue;
    const at = attrScore(pf.attr, a.attr);
    const q = pf.quotes.length ? quoteScore(pf.quotes, a) : 0;
    // a hard trait matches only on its own value word ("fair", not "cropped")
    if (a.hard && v < 0.5) continue;
    const score = 0.45 * v + 0.3 * q + 0.25 * at;
    const ok = (at >= 0.5 && v >= 0.5) || (q >= 0.6 && v >= 0.34) || (at >= 0.8 && q >= 0.4);
    if (ok && score >= 0.5 && (!best || score > best.score)) best = { fact: a, score, v, q, at };
  }
  return best;
}

function slipMatches(produced, answer) {
  if (answer.ch && produced.chId && answer.ch !== produced.chId && !/\//.test(answer.ch)) return false;
  const ps = N(produced.sentence);
  const as = N(answer.sentence);
  const same = ps === as || ps.includes(as) || as.includes(ps) || overlap(new Set(words(ps)), new Set(words(as))) >= 0.8;
  if (!same) return false;
  const pSpan = N(produced.span);
  const aSpan = N(answer.span);
  return !pSpan || !aSpan || pSpan.includes(aSpan) || aSpan.includes(pSpan) || overlap(new Set(words(pSpan)), new Set(words(aSpan))) > 0;
}

/* ---------- score ---------- */

function score({ answers, run, texts, slips, reviewed }) {
  const ent = entityMatcher(answers);
  const byAnswer = new Map(answers.entities.map((e) => [e.id, []]));
  const unmatchedEntries = [];
  for (const e of run.entries) {
    const a = ent(e);
    if (a) byAnswer.get(a.id).push(e); else unmatchedEntries.push(e);
  }
  const wsum = (xs) => xs.reduce((n, x) => n + (WEIGHT[x.weight] || 1), 0);
  // entities
  const entFound = answers.entities.filter((a) => byAnswer.get(a.id).length);
  const entities = { found: entFound.length, of: answers.entities.length, weighted: wsum(entFound) / (wsum(answers.entities) || 1),
    missed: answers.entities.filter((a) => !byAnswer.get(a.id).length).map((a) => `${a.name} (${a.weight})`),
    split: answers.entities.filter((a) => byAnswer.get(a.id).length > 1).map((a) => `${a.name}: ${byAnswer.get(a.id).map((e) => e.name).join(' + ')}`),
    extra: unmatchedEntries.map((e) => `${e.name} (${e.kind})`) };

  // facts
  const kept = (f) => f.state === 'verified' || f.state === 'yours';
  const found = new Set();
  const offered = new Set();
  const precision = { supported: 0, wrong: [], review: [], reviewedTrue: 0 };
  const allAnswerFacts = answers.entities.flatMap((a) => a.facts.map((f) => ({ ...f, entity: a })));
  const factId = (f) => f.entity.id + '|' + f.attr + '|' + f.value;
  const producedFacts = [];
  for (const e of run.entries) {
    const a = ent(e);
    for (const f of e.facts) {
      const label = Canon.labelOf(f);
      const attr = f.attr !== 'other' ? (LEGACY[f.attr] || canonLabel(label)) : canonLabel(label);
      const srcs = f.sources.filter((s) => !s.written);
      producedFacts.push({ entry: e, a, f, label, attr, value: f.value, as: f.as, quotes: srcs.map((s) => s.quote), srcs, said: srcs.length > 0 && srcs.every((s) => s.said || s.plan), kept: kept(f) });
    }
  }
  for (const pf of producedFacts) {
    const line = `${pf.entry.name} · ${pf.label}: ${pf.value}${pf.as ? ` (${pf.as})` : ''} · ${pf.f.state}  ← "${pf.quotes[0] || '(written in Canon)'}"`;
    const facts = pf.a ? pf.a.facts.map((f) => ({ ...f, entity: pf.a })) : [];
    const m = matchFact(pf, facts);
    const trap = pf.a && matchFact(pf, (pf.a.traps || []).map((t) => ({ ...t, alt: t.alt || [t.value], quote: '' })));
    if (m && (!trap || m.score >= trap.score)) {
      if (pf.kept && !(m.fact.said && !pf.said)) found.add(factId(m.fact));
      offered.add(factId(m.fact));
    }
    if (!pf.kept) continue;
    const misquoted = texts.has && pf.srcs.some((s) => !texts.verbatim(s.quote, s.ch, s.book));
    if (pf.f.state === 'yours' && !pf.srcs.length) { precision.supported++; continue; } // the writer's own
    if (misquoted) precision.wrong.push(line + '  [quote not in the text]');
    else if (trap && (!m || trap.score > m.score)) precision.wrong.push(line + `  [trap: ${trap.fact.why || trap.fact.value}]`);
    else if (m && m.fact.said && !pf.said) precision.wrong.push(line + '  [only said in speech, kept as true]');
    else if (m) precision.supported++;
    else {
      const key = N(`${pf.entry.name}|${pf.label}|${pf.value}`);
      if (reviewed && key in reviewed) { if (reviewed[key]) { precision.supported++; precision.reviewedTrue++; } else precision.wrong.push(line + '  [reviewed: wrong]'); } else precision.review.push({ key, line });
    }
  }
  const factsOf = (w) => allAnswerFacts.filter((f) => !w || f.weight === w);
  const recallOf = (w, set = found) => { const xs = factsOf(w); return { found: xs.filter((f) => set.has(factId(f))).length, of: xs.length }; };
  const allW = allAnswerFacts;
  const facts = {
    must: recallOf('must'), should: recallOf('should'), nice: recallOf('nice'), all: recallOf(null),
    weighted: wsum(allW.filter((f) => found.has(factId(f)))) / (wsum(allW) || 1),
    offeredMust: recallOf('must', offered),
    produced: producedFacts.length, kept: producedFacts.filter((x) => x.kept).length,
    missedMust: factsOf('must').filter((f) => !found.has(factId(f))).map((f) => `${f.entity.name} · ${f.attr}: ${f.value}`)
  };
  const judged = precision.supported + precision.wrong.length;
  precision.value = judged ? precision.supported / judged : null;
  precision.lower = facts.kept ? precision.supported / facts.kept : null;

  // key points
  const story = run.entries.flatMap((e) => (e.story || []).map((x) => ({ entry: e, did: x.did, quotes: x.sources.map((s) => s.quote), ch: (x.sources[0] || {}).ch })));
  const kps = answers.keyPoints || [];
  const kpFound = kps.filter((k) => story.some((s) => {
    if (k.ch && s.ch && k.ch !== s.ch) return false;
    const q = s.quotes.some((pq) => [k.quote, ...(k.also || [])].filter(Boolean).some((aq) => N(aq).includes(N(pq)) || N(pq).includes(N(aq)) || overlap(new Set(words(pq)), new Set(words(aq))) >= 0.6));
    return q || overlap(bag(s.did), bag(k.did)) >= 0.6;
  }));
  const keyPoints = { found: kpFound.length, of: kps.length, must: { found: kpFound.filter((k) => k.weight === 'must').length, of: kps.filter((k) => k.weight === 'must').length },
    produced: new Set(story.map((s) => N(s.did))).size, missed: kps.filter((k) => !kpFound.includes(k)).map((k) => `${k.did} (${k.weight})`) };

  // slips
  let slipScore = null;
  if (slips) {
    const want = (answers.slips || []).filter((s) => s.weight !== 'nice');
    const nice = (answers.slips || []).filter((s) => s.weight === 'nice');
    const hit = want.filter((s) => slips.slips.some((p) => slipMatches(p, s)));
    const falseSlips = slips.slips.filter((p) => !(answers.slips || []).some((s) => slipMatches(p, s)));
    const decoyHit = (p) => (answers.decoys || []).find((d) => slipMatches({ ...p, span: '' }, { ...d, span: '' }));
    slipScore = {
      found: hit.length, of: want.length, niceFound: nice.filter((s) => slips.slips.some((p) => slipMatches(p, s))).length,
      missed: want.filter((s) => !hit.includes(s)).map((s) => `[${s.kind}] "${s.span}" in "${s.sentence}"`),
      false: falseSlips.map((p) => `"${p.span}" in "${p.sentence}"${decoyHit(p) ? '  [decoy: ' + (decoyHit(p).why || 'listed') + ']' : ''}`),
      worthALook: (slips.worthALook || []).map((p) => `"${p.span}" in "${p.sentence}"${(answers.slips || []).some((s) => slipMatches(p, s)) ? '  [a real slip]' : decoyHit(p) ? '  [decoy]' : ''}`)
    };
  }

  // profiles
  const wantProfile = answers.entities.filter((a) => a.profile);
  const profiles = { want: wantProfile.length, present: 0, cited: 0, notes: [] };
  for (const a of wantProfile) {
    const p = byAnswer.get(a.id).map((e) => readProfile(e.raw)).find(Boolean);
    if (!p || !p.sentences.length) continue;
    profiles.present++;
    const uncited = p.sentences.filter((s) => !/\[\d+\]/.test(s));
    const badRefs = [...p.text.matchAll(/\[(\d+)\]/g)].map((m) => m[1]).filter((n) => !p.cites.has(n) || (texts.has && !texts.verbatim(p.cites.get(n).quote, p.cites.get(n).ch, p.cites.get(n).book)));
    if (!uncited.length && !badRefs.length) profiles.cited++;
    else profiles.notes.push(`${a.name}: ${uncited.length} sentence(s) without a citation, ${new Set(badRefs).size} citation(s) not verbatim or missing`);
  }

  return { entities, facts, precision, keyPoints, slips: slipScore, profiles };
}

/* ---------- output ---------- */

const pct = (x) => (x == null || Number.isNaN(x) ? '  -' : `${Math.round(x * 100)}%`.padStart(4));
const frac = (r) => `${r.found}/${r.of}`;
function table(name, s) {
  const rows = [
    ['entities', frac(s.entities), pct(s.entities.weighted) + ' weighted'],
    ['facts must', frac(s.facts.must), pct(s.facts.must.of ? s.facts.must.found / s.facts.must.of : null) + `  (offered incl. Needs You ${frac(s.facts.offeredMust)})`],
    ['facts should', frac(s.facts.should), pct(s.facts.should.of ? s.facts.should.found / s.facts.should.of : null)],
    ['facts nice', frac(s.facts.nice), pct(s.facts.nice.of ? s.facts.nice.found / s.facts.nice.of : null)],
    ['facts weighted', '', pct(s.facts.weighted) + `  (${s.facts.kept} kept of ${s.facts.produced} produced)`],
    ['precision', `${s.precision.supported}/${s.precision.supported + s.precision.wrong.length}`, pct(s.precision.value) + `  (${s.precision.wrong.length} wrong, ${s.precision.review.length} to review; lower bound ${pct(s.precision.lower).trim()})`],
    ['key points', frac(s.keyPoints), `must ${frac(s.keyPoints.must)}  (${s.keyPoints.produced} produced)`],
    ['slips', s.slips ? frac(s.slips) : '-', s.slips ? `${s.slips.false.length} false, ${s.slips.worthALook.length} worth a look` : 'no slips file'],
    ['profiles', `${s.profiles.present}/${s.profiles.want}`, `${s.profiles.cited} fully cited`]
  ];
  return [`${name}`, ...rows.map(([a, b, c]) => `  ${a.padEnd(15)}${String(b).padEnd(8)}${c}`)].join('\n');
}

function main() {
  const check = arg('check');
  const answersFile = check || positional[1];
  if (!answersFile) { console.error('usage: canon-score.js <run> <answers.json> | --check <answers.json>'); process.exit(2); }
  const answers = readAnswers(answersFile);
  const lib = arg('library', [path.join(path.dirname(answersFile), 'library'), path.dirname(answersFile)].find((d) => fs.existsSync(path.join(d, 'library.json'))));
  const texts = textIndex(lib);
  if (check) {
    const bad = checkAnswers(answers, texts);
    const n = answers.entities.reduce((k, e) => k + e.facts.length, 0);
    console.log(`${answers.entities.length} entities, ${n} facts (${answers.entities.reduce((k, e) => k + e.facts.filter((f) => f.weight === 'must').length, 0)} must), ${(answers.keyPoints || []).length} key points, ${(answers.slips || []).length} slips, ${(answers.decoys || []).length} decoys`);
    if (!texts.has) console.log('(no library found: quotes not checked)');
    for (const b of bad) console.log('NOT VERBATIM ' + b);
    process.exitCode = bad.length ? 1 : 0;
    return;
  }
  const run = readRun(positional[0]);
  const slipsFile = arg('slips', run.slipsFile);
  const slips = slipsFile ? JSON.parse(fs.readFileSync(slipsFile, 'utf8')) : null;
  const reviewed = arg('reviewed') ? JSON.parse(fs.readFileSync(arg('reviewed'), 'utf8')) : null;
  const s = score({ answers, run, texts, slips, reviewed });
  console.log(table(`${answers.set || path.basename(answersFile)} · ${positional[0]} · ${run.entries.length} entries`, s));
  if (!flag('quiet')) {
    const list = (title, xs) => { if (xs && xs.length) console.log(`\n${title}\n` + xs.map((x) => '  ' + x).join('\n')); };
    list('missed entities', s.entities.missed);
    list('entries split', s.entities.split);
    list('missed must facts', s.facts.missedMust);
    list('wrong kept facts', s.precision.wrong);
    if (flag('review')) list('to review (quote verbatim, claim not on the sheet)', s.precision.review.map((r) => r.line + `\n      key: ${JSON.stringify(r.key)}`));
    else if (s.precision.review.length) console.log(`\n${s.precision.review.length} kept facts to review: --review lists them`);
    list('missed key points', s.keyPoints.missed);
    if (s.slips) { list('missed slips', s.slips.missed); list('false slips', s.slips.false); list('worth a look', s.slips.worthALook); }
    list('profiles', s.profiles.notes);
  }
  if (arg('json')) fs.writeFileSync(arg('json'), JSON.stringify({ answers: answersFile, run: positional[0], ...s, precision: { ...s.precision, review: s.precision.review.map((r) => r.line) } }, null, 2));
}

if (require.main === module) main();
module.exports = { readAnswers, checkAnswers, score, readRun, readProfile, canonLabel, matchFact, attrScore, valueScore, textIndex };
