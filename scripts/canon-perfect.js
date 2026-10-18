'use strict';

// Readers made from an editor's answer sheet (scripts/fixtures/canon-editor/*
// answers.json), to measure the code around the reader rather than the
// reader (READING.md §13, round 3):
//
//   perfect      lists every sheet fact whose quote is in the entity's pack,
//                citing the sentences that hold it, and answers every
//                question as the sheet would. What it proposes and the code
//                drops is a fault in a gate (or in the pack, when the quote
//                never reached the pack).
//   adversarial  also lists, under each entity, the facts of the others
//                whose quotes sit in its pack (a horse's age under its
//                rider, a house's floors under the town), and the sheet's
//                traps, and believes all of them: yes to every question,
//                its own name to "whose", no to "is it wrong". Whatever of
//                these survives is a fault in the code.
//
//   node scripts/canon-perfect.js [<fixture dir>…]   (default: dev, dev2/*, qa)
//
// prints pack coverage, survival and every drop with its gate.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Canon = require('../canon.js');
const Score = require('./canon-score.js');
const { folderIO } = require('./canon-eval.js');

const N = (s) => Canon.norm(String(s || ''));
const FIX = path.join(__dirname, 'fixtures', 'canon-editor');
const FIXTURES = ['dev', ...fs.readdirSync(path.join(FIX, 'dev2')).map((d) => 'dev2/' + d), 'qa'].map((d) => path.join(FIX, d));

// a sheet's canonical attribute as a reader would give it: group and label
function groupOf(attr) {
  const [head, tail] = String(attr).split('.');
  const G = { sex: 'sex', age: 'age', appearance: 'appearance', role: 'role', occupation: 'role', skill: 'role', personality: 'personality', opinion: 'personality', manner: 'personality',
    habit: 'habit', routine: 'habit', custom: 'habit', relationship: 'relationship', origin: 'origin', history: 'history', state: 'state', possession: 'possession',
    description: 'description', atmosphere: 'description', residents: 'description', location: 'location', rule: 'rule', membership: 'membership', members: 'membership' };
  const L = { occupation: 'job', routine: 'routine', custom: 'custom', opinion: 'opinion', manner: 'manner', atmosphere: 'atmosphere', residents: 'residents', members: 'members', skill: 'skill',
    'location.home': 'home', 'location.part': 'parts', 'relationship.kin': 'kin', 'relationship.friend': 'friend', 'relationship.enemy': 'enemy', 'manner.speech': 'speech', 'appearance.other': 'appearance' };
  return { g: G[head] || 'other', a: L[attr] || tail || head };
}

// the sentences of a pack part that hold a quote (each of its sentences, or a
// sentence the quote lies in) → [ids] or null
function citeIds(text, quote) {
  const lines = [...text.matchAll(/\[(\d+)\] ([^[]*)/g)].map((m) => [+m[1], N(m[2])]);
  const ids = [];
  for (const piece of Canon.sentences(quote).map((s) => N(s.text)).filter(Boolean)) {
    const hit = lines.find(([, t]) => t.includes(piece.replace(/[.!?]+$/, '')) || (piece.includes(t.replace(/[.!?]+$/, '')) && t.length > 12));
    if (!hit) return null;
    if (!ids.includes(hit[0])) ids.push(hit[0]);
  }
  return ids.length && ids.length <= 3 ? ids : null;
}

function sheetIndex(sheet) {
  const all = sheet.entities;
  const byName = (name) => {
    const n = N(name).replace(/^the\s+/, '');
    return all.find((e) => [e.name, ...(e.aliases || [])].some((a) => N(a).replace(/^the\s+/, '') === n)) || null;
  };
  // a claim's sheet fact, if it is one (and not a trap) → fact or null
  const truth = (name, label, value) => {
    const e = byName(name);
    if (!e) return null;
    const pf = { value, as: '', attr: Score.canonLabel(label || ''), quotes: [] };
    const m = Score.matchFact(pf, e.facts.map((f) => ({ ...f, entity: e })));
    const trap = Score.matchFact(pf, (e.traps || []).map((t) => ({ ...t, alt: t.alt || [t.value], quote: '' })));
    if (!m || (trap && trap.score > m.score)) return null;
    return m.fact;
  };
  return { all, byName, truth };
}

// The value as a careful reader writes it: the sheet's wording or one of
// its alternatives, whichever is most in the quote's own words (a reader is
// asked for "the text's own words"; the sheet's editorial wording may not be)
function wording(f) {
  const E = Canon.Editor;
  const bag = new Set(E.content(f.quote));
  const caps = (v) => (v.match(/(?<=\S\s+)\p{Lu}[\p{L}'’-]+/gu) || []).every((w) => N(f.quote).includes(N(w).replace(/['’]s$/, '')));
  const fit = (v) => { const ws = E.content(v); return ws.length ? ws.filter((w) => E.inBag(w, bag)).length / ws.length : 0; };
  let best = f.value;
  for (const v of [f.value, ...(f.alt || [])]) if ((caps(v) && !caps(best)) || (caps(v) === caps(best) && fit(v) > fit(best) + 1e-9)) best = v;
  return best;
}

// The reader. `mode`: 'perfect' | 'adversarial'. `log` (optional) collects
// what was proposed: [{ entity, attr, value, quote, wrong, of }]
function sheetReader(sheet, { mode = 'perfect', setting = '', log = [], packs = new Map() } = {}) {
  const ix = sheetIndex(sheet);
  const adversary = mode === 'adversarial';
  const wrong = new Set(); // norm(name|value) the adversary made up
  const written = (text, n) => { const b = String(n).replace(/^the\s+/i, ''); return new RegExp(`(?<![\\p{L}])${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u').test(text); };
  return {
    id: 'sheet-' + mode,
    tier: 'careful',
    editor: true,
    parallel: 1,
    judgeRelations: true,
    calls: 0,
    async cast({ text }) {
      const plain = text.replace(/¶\d+\s/g, '');
      const cast = ix.all.filter((e) => [e.name, ...(e.aliases || [])].some((n) => written(plain, n)) && !/^the narrator$/i.test(e.name))
        .map((e) => ({ name: [e.name, ...(e.aliases || [])].find((n) => written(plain, n)), kind: e.kind, aliases: [e.name, ...(e.aliases || [])].filter((n) => written(plain, n) && !/^the narrator$/i.test(n)) }));
      const s = setting && written(plain, setting) ? setting : '';
      return { cast, setting: s };
    },
    async dossier({ name, text }) {
      this.calls++;
      packs.set(name, (packs.get(name) || []).concat(N(text.replace(/\[\d+\] /g, ''))));
      const e = ix.byName(name);
      const out = [];
      const push = (owner, f, isWrong) => {
        const ids = citeIds(text, f.quote);
        if (!ids) return;
        const { g, a } = groupOf(f.attr);
        out.push({ g, a, v: wording(f), s: ids, x: f.said ? 1 : 0 });
        log.push({ entity: name, attr: f.attr, value: f.value, quote: f.quote, wrong: isWrong, of: owner });
        if (isWrong) wrong.add(N(name + '|' + f.value));
      };
      if (e) for (const f of e.facts) push(e.name, f, false);
      if (adversary) {
        // another's fact whose quote is in this pack, filed under this one
        for (const o of ix.all) {
          if (o === e) continue;
          for (const f of o.facts) {
            if (f.said || /^(?:relationship|possession|membership|members|residents|location)/.test(f.attr)) continue;
            if (e && ix.truth(e.name, groupOf(f.attr).a, f.value)) continue; // (true of this one too)
            push(o.name, f, true);
          }
        }
      }
      return out;
    },
    async verify({ name, label, value, negated, other, lasting, strict }) {
      const madeUp = wrong.has(N(name + '|' + value));
      const t = ix.truth(name, label, value);
      if (adversary && madeUp) return negated || other ? 'no' : 'yes';
      if (negated || other) return t ? 'no' : 'yes';
      if (lasting) return t ? 'yes' : 'no';
      return t ? 'yes' : (adversary ? 'yes' : 'no');
    },
    async whose({ name, label, value, options }) {
      if (adversary && wrong.has(N(name + '|' + value))) return name;
      if (ix.truth(name, label, value)) return name;
      const o = (options || []).find((n) => ix.truth(n, label, value));
      return o || 'someone or something else';
    },
    async refers({ sentence, entity }) {
      const e = ix.byName(entity);
      return e && e.facts.some((f) => N(f.quote).includes(N(sentence)) || N(sentence).includes(N(f.quote))) ? 'yes' : 'no';
    },
    async profile() { return []; },
    // the sheet's key points whose quote is in the paragraph
    async events({ text }) {
      return (sheet.keyPoints || []).filter((k) => k.quote && N(text).includes(N(k.quote))).map((k) => ({
        who: k.who.map((id) => (ix.all.find((e) => e.id === id) || {}).name).filter(Boolean), did: k.did, where: '', quote: k.quote.replace(/[.!?]+$/, '') }));
    },
    async contradicts({ sentence }) { return (sheet.slips || []).some((s) => s.kind === 'deed' && N(s.sentence) === N(sentence)) ? 'yes' : 'no'; },
    async clash({ sentence }) { return (sheet.slips || []).some((s) => s.kind !== 'deed' && N(s.sentence) === N(sentence)) ? 'yes' : 'no'; },
    async judge() { return 'unsure'; },
    async propose() { return []; },
    async pick() { return null; },
    abort() {}
  };
}

// Pack coverage: of the sheet's facts (`weights`), the fraction whose every
// quote sentence reached that entity's dossier (the passage packs the
// engine sent the reader, in a run with the perfect reader). → { of, in, missing: [] }
function packCoverage(run, { weights = ['must'] } = {}) {
  const { sheet, packs } = run;
  const ix = sheetIndex(sheet);
  const out = { of: 0, in: 0, missing: [] };
  const byId = new Map();
  for (const [name, texts] of packs) { const e = ix.byName(name); if (e) byId.set(e.id, (byId.get(e.id) || []).concat(texts)); }
  for (const e of sheet.entities) {
    for (const f of e.facts.filter((x) => weights.includes(x.weight) && x.quote)) {
      out.of++;
      const pk = byId.get(e.id) || [];
      const pieces = Canon.sentences(f.quote).map((x) => N(x.text).replace(/[.!?]+$/, '')).filter(Boolean);
      if (pieces.every((q) => pk.some((t) => t.includes(q)))) out.in++;
      else out.missing.push(`${e.name} · ${f.attr}: ${f.value}  ← "${f.quote}"`);
    }
  }
  return out;
}

// Read the Shelf (and the pass) with a sheet reader on a copy of the
// fixture's library. → { score, entries, dropped, log, slips, asks }
async function runSheet(fixture, { mode = 'perfect', setting = '' } = {}) {
  const sheet = JSON.parse(fs.readFileSync(path.join(fixture, 'answers.json'), 'utf8'));
  const answers = Score.readAnswers(path.join(fixture, 'answers.json'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-canon-sheet-'));
  try {
    const lib = path.join(root, 'library');
    fs.cpSync(path.join(fixture, 'library'), lib, { recursive: true });
    const library = JSON.parse(fs.readFileSync(path.join(lib, 'library.json'), 'utf8'));
    const dir = path.join(lib, library.shelves[0].canonId);
    let cache = null;
    const io = { ...folderIO(lib, dir), cache: () => cache && structuredClone(cache), saveCache: (c) => { cache = structuredClone(c); } };
    const log = [];
    const packs = new Map();
    const reader = sheetReader(sheet, { mode, setting, log, packs });
    const engine = Canon.createEngine({ io, reader });
    await engine.readShelf({});
    const { slips, asks = [] } = await engine.check({ scope: 'shelf' });
    const entries = io.entries().map((x) => Canon.parseEntry(x.text));
    const texts = Score.textIndex(lib);
    const pick = (s) => ({ chId: s.chId, sentence: s.sentence, span: s.span, name: s.name });
    const score = Score.score({ answers, run: { entries, profiles: new Map() }, texts, slips: { slips: slips.map(pick), worthALook: asks.map(pick) } });
    return { score, entries, cache, log, slips, asks, sheet, answers, packs };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// Of the sheet's facts a reader could keep as true (not said; not one the
// sheet asks the writer about), how many the entries keep → { of, kept, lost: [] }
function survival(run) {
  const { sheet, entries } = run;
  const needs = new Set((sheet.needs || []).map((n) => n.entity + '|' + n.attr));
  const ent = (a) => entries.filter((e) => [e.name, ...e.aliases].some((n) => [a.name, ...(a.aliases || [])].some((x) => N(x).replace(/^the\s+/, '') === N(n).replace(/^the\s+/, ''))));
  const out = { of: 0, kept: 0, lost: [] };
  for (const a of sheet.entities) {
    const mine = ent(a);
    for (const f of a.facts) {
      if (f.said || needs.has(a.id + '|' + f.attr)) continue;
      out.of++;
      const produced = mine.flatMap((e) => e.facts.filter((g) => ['verified', 'yours'].includes(g.state)).map((g) => {
        const label = Canon.labelOf(g);
        const LEG = { sex: 'sex', species: 'species', eyes: 'appearance.eyes', hair: 'appearance.hair', birthplace: 'origin', sibling: 'relationship.kin', parent: 'relationship.kin', child: 'relationship.kin', spouse: 'relationship.kin', owner: 'possession', home: 'location.home', title: 'role' };
        return { value: g.value, as: g.as, attr: g.attr !== 'other' ? (LEG[g.attr] || Score.canonLabel(label)) : Score.canonLabel(label), quotes: g.sources.filter((s) => !s.written).map((s) => s.quote) };
      }));
      if (produced.some((pf) => { const m = Score.matchFact(pf, [{ ...f, entity: a }]); return m; })) out.kept++;
      else out.lost.push(`${a.name} · ${f.attr}: ${f.value}  ← "${f.quote}"`);
    }
  }
  return out;
}

// what the adversary made up that the entries kept → [lines]
function survivors(run) {
  const { log, entries, sheet } = run;
  const ix = sheetIndex(sheet);
  const out = [];
  for (const x of log.filter((y) => y.wrong)) {
    const e = entries.find((y) => [y.name, ...y.aliases].some((n) => N(n) === N(x.entity)));
    if (!e) continue;
    const kept = e.facts.filter((g) => ['verified'].includes(g.state)).filter((g) => {
      const pf = { value: g.value, as: g.as, attr: Score.canonLabel(Canon.labelOf(g)), quotes: g.sources.map((s) => s.quote) };
      const m = Score.matchFact(pf, [{ attr: x.attr, value: x.value, quote: x.quote, alt: [] }]);
      return m && !ix.truth(e.name, Canon.labelOf(g), g.value);
    });
    for (const g of kept) out.push(`${e.name} · ${Canon.labelOf(g)}: ${g.value}  (really ${x.of}'s)  ← "${(g.sources[0] || {}).quote}"`);
  }
  return [...new Set(out)];
}

const SETTINGS = { dev: 'the Weighhouse' };

async function main() {
  const dirs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const fixtures = dirs.length ? dirs.map((d) => path.resolve(d)) : FIXTURES;
  for (const fx of fixtures) {
    const name = path.relative(FIX, fx);
    const setting = SETTINGS[name] || '';
    const run = await runSheet(fx, { mode: 'perfect', setting });
    const cov = packCoverage(run, { weights: ['must', 'should', 'nice'] });
    const covMust = packCoverage(run, { weights: ['must'] });
    const sv = survival(run);
    const adv = await runSheet(fx, { mode: 'adversarial', setting });
    const bad = survivors(adv);
    console.log(`\n== ${name}: pack coverage must ${covMust.in}/${covMust.of}, all ${cov.in}/${cov.of}; perfect reader keeps ${sv.kept}/${sv.of}; wrong kept ${run.score.precision.wrong.length}; adversary's kept ${bad.length}/${adv.log.filter((x) => x.wrong).length}; slips ${run.score.slips ? `${run.score.slips.found}/${run.score.slips.of}, false ${run.score.slips.false.length}` : '-'}`);
    if (process.argv.includes('--v')) {
      for (const m of cov.missing) console.log('  not in pack: ' + m);
      for (const m of sv.lost) console.log('  lost: ' + m);
      for (const w of run.score.precision.wrong) console.log('  wrong: ' + w);
      for (const w of bad) console.log('  adversary kept: ' + w);
      if (run.score.slips) for (const w of run.score.slips.missed || []) console.log('  slip missed: ' + w);
      if (run.score.slips) for (const w of run.score.slips.false || []) console.log('  false slip: ' + w);
      for (const [ch, xs] of Object.entries(((run.cache || {}).ed || {}).dropped || {})) for (const x of xs) if (run.log.some((y) => N(y.entity) === N(x.entity) && N(y.value) === N(x.value))) console.log(`  gate (${ch.split('/').pop()}): ${x.entity} · ${x.label}: ${x.value} — ${x.why}`);
      for (const x of Object.values((run.cache || {}).dropped || {})) console.log(`  engine: ${x.entry} · ${x.attr}: ${x.value} — ${x.why}  ← "${x.quote}"`);
    }
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { sheetReader, packCoverage, runSheet, survival, survivors, FIXTURES, SETTINGS, groupOf, citeIds };
