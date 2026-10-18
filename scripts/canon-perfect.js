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
const Canon = require(process.env.CANON_JS || '../canon.js');
const Score = require('./canon-score.js');
const { folderIO } = require('./canon-eval.js');

const N = (s) => Canon.norm(String(s || ''));
const FIX = path.join(__dirname, 'fixtures', 'canon-editor');
const FIXTURES = ['dev', ...fs.readdirSync(path.join(FIX, 'dev2')).map((d) => 'dev2/' + d), 'qa'].map((d) => path.join(FIX, d));
// round 4: stories written for the third held-out brief's failure types
const DEV3 = fs.readdirSync(path.join(FIX, 'dev3')).map((d) => path.join(FIX, 'dev3', d));
// round 5: stories written for the fourth held-out brief's slip types
const DEV4 = fs.readdirSync(path.join(FIX, 'dev4')).map((d) => path.join(FIX, 'dev4', d));

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
// → { v, supported }: supported when the words are the quote's (its names, half its words)
function worded(f) {
  const E = Canon.Editor;
  const bag = new Set(E.content(f.quote));
  // (its names and its numbers in the quote)
  const caps = (v) => (v.match(/(?<![\p{L}])\p{Lu}[\p{L}'’-]+/gu) || []).filter((w) => !/^(?:The|A|An)$/.test(w)).every((w) => N(f.quote).includes(N(w).replace(/['’]s$/, '')))
    && E.content(v).filter((w) => /^(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|first|second|third|twenty|thirty|forty|fifty|hundred)$/.test(w)).every((w) => E.inBag(w, bag));
  const fit = (v) => { const ws = E.content(v); return ws.length ? ws.filter((w) => E.inBag(w, bag)).length / ws.length : 0; };
  // (at most twelve words, as the prompt asks; the sheet's own wording when it
  // is in the quote's words, else the alternative most so)
  const all = [f.value, ...(f.alt || [])].filter((v) => v.split(/\s+/).length <= 12);
  if (!all.length) all.push(f.value);
  // (the sheet's own wording if it holds; else the alternative most in the quote's words)
  if (caps(all[0]) && fit(all[0]) >= 0.5) return { v: all[0], supported: true };
  const ok = all.filter((v) => caps(v) && fit(v) >= 0.5).sort((x, y) => fit(y) - fit(x))[0];
  if (ok) return { v: ok, supported: true };
  let best = all[0];
  for (const v of all) if ((caps(v) && !caps(best)) || (caps(v) === caps(best) && fit(v) > fit(best) + 1e-9)) best = v;
  return { v: best, supported: ['sex', 'name'].includes(f.attr) };
}

// The reader. `mode`: 'perfect' | 'adversarial'. `log` (optional) collects
// what was proposed: [{ entity, attr, value, quote, wrong, of }]
function sheetReader(sheet, { mode = 'perfect', setting = '', log = [], packs = new Map() } = {}) {
  const ix = sheetIndex(sheet);
  const adversary = mode === 'adversarial';
  const wrong = new Set(); // norm(name|value) the adversary made up
  const written = (text, n) => { const b = String(n).replace(/^the\s+/i, ''); return new RegExp(`(?<![\\p{L}])${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u').test(text); };
  return {
    ix,
    wrongSet: wrong,
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
        const { v, supported } = worded(f);
        out.push({ g, a, v, s: ids, x: f.said ? 1 : 0 });
        log.push({ entity: name, attr: f.attr, value: f.value, v, quote: f.quote, wrong: isWrong, of: owner, supported });
        if (isWrong) wrong.add(N(name + '|' + f.value));
      };
      if (e) for (const f of e.facts) push(e.name, f, false);
      // (round 4) the other side of a Which is right?, where the pack holds it: the writer's
      // notes say one thing ("teaches chemistry"), the prose another; a reader lists both
      for (const nd of (sheet.needs || []).filter((x) => e && x.entity === e.id)) {
        for (const v of nd.values) {
          for (const [n, line] of [...text.matchAll(/\[(\d+)\] ([^[]*)/g)].map((m) => [+m[1], m[2].trim()])) {
            const seg = line.split(/[.;]\s+|:\s+/).find((x) => new RegExp(`(?<![\\p{L}])${v}(?![\\p{L}])`, 'iu').test(x));
            if (!seg || out.some((o) => o.s.includes(n) && N(o.v).includes(N(v)))) continue;
            const { g, a } = groupOf(nd.attr);
            const v1 = seg.replace(/[.]+$/, '').trim();
            out.push({ g, a, v: v1, s: [n], x: 0 });
            log.push({ entity: name, attr: nd.attr, value: v1, v: v1, quote: line, wrong: false, of: e.name, supported: true, need: true });
          }
        }
      }
      if (adversary) {
        // another's fact whose quote is in this pack, filed under this one
        for (const o of ix.all) {
          if (o === e) continue;
          for (const f of o.facts) {
            if (f.said || /^(?:relationship|possession|membership|members|residents|location)/.test(f.attr)) continue;
            if (e && ix.truth(e.name, groupOf(f.attr).a, f.value)) continue; // (true of this one too)
            // (a sentence the sheet has as this one's too: what it says may be both's)
            if (e && e.facts.some((g) => Canon.sentences(g.quote).some((x) => N(f.quote).includes(N(x.text).replace(/[.!?]+$/, '')) || N(x.text).includes(N(f.quote).replace(/[.!?]+$/, ''))))) continue;
            push(o.name, f, true);
          }
        }
      }
      return out;
    },
    async verify({ name, label, value, negated, other, lasting, moment }) {
      const madeUp = wrong.has(N(name + '|' + value));
      // (a Which is right? value the pack holds is what that passage says)
      const need = log.some((y) => y.need && N(y.entity) === N(name) && N(y.v) === N(value));
      if (need) return negated || other || moment ? 'no' : 'yes';
      const t = ix.truth(name, label, value);
      if (adversary && madeUp) return negated || other || moment ? 'no' : 'yes';
      if (negated || other || moment) return t ? 'no' : 'yes';
      if (lasting) return t ? 'yes' : 'no';
      return t ? 'yes' : (adversary ? 'yes' : 'no');
    },
    async whose({ name, label, value, options }) {
      if (log.some((y) => y.need && N(y.entity) === N(name) && N(y.v) === N(value))) return name;
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

// Round 4: a reader that fails the way the real Careful reader failed on the
// third held-out batch (/tmp eval3 BRIEF: failure types, never the stories).
// It knows the sheet, like the perfect reader, and on top of it:
//
//   labels     gives every fact a drifting label ("situated", "address",
//              "shift start", "eye colour", "teaches"), never the sheet's
//   slips      proposes each later value a slip stands on as a fact of its
//              own, under another label, and believes it
//   moments    proposes a feeling, a posture or one action in one scene as a
//              lasting state ("very cold and frightened", "asleep on his chest")
//   subjects   gives an animal the sex of the nearest he or she, whoever's it is
//   speech     never marks what is said as said (a chat line, a letter)
//   identity   proposes a nickname as its own one, a name shared by
//              generations as one person (the epithets its aliases), an
//              animal as a person, a transposed room number as a place
//   profiles   writes sentences that cite real facts and say more than they do
//   slips      answers no when asked whether a later sentence says otherwise
//
// and believes all of it: yes to every question about what it made up, its own
// name to "whose", no to "is it wrong", "lasting" to "only this moment".
const DRIFT = {
  location: ['situated', 'address', 'where', 'position'], 'location.home': ['address', 'lodging', 'room'], 'location.part': ['part of', 'within'],
  routine: ['shift start', 'schedule', 'timetable', 'daily'], habit: ['pattern', 'usual', 'tendency'], custom: ['tradition'],
  occupation: ['job', 'teaches', 'works as'], role: ['position', 'title', 'post'], skill: ['ability'],
  'appearance.eyes': ['eye colour', 'eyes'], 'appearance.hair': ['hair colour', 'hair'], 'appearance.build': ['body', 'frame'], 'appearance.face': ['beard', 'features'],
  'appearance.mark': ['ear', 'scar'], 'appearance.other': ['glasses', 'walk'], age: ['years', 'age'], sex: ['gender', 'sex'], species: ['animal', 'breed'],
  description: ['features', 'look', 'building'], history: ['past', 'deed', 'founding'], state: ['condition', 'status'], name: ['nickname', 'name'],
  'relationship.kin': ['family', 'son', 'parent'], possession: ['owns', 'pet'], personality: ['temper', 'nature'], 'manner.speech': ['voice'], residents: ['patient', 'occupant'], event: ['deed', 'built']
};
const MOMENT_RE = /(?<![\p{L}])(?:was|were|lay|sat|stood|fell|felt|looked)\s+((?:(?:very|so|too|quite|half|fast)\s+)?(?:awake|asleep|cold|tired|frightened|afraid|scared|furious|angry|sad|happy|hungry|wet|exhausted|nervous|late|alone|still|quiet|silent|crying|shaking|pale|ill|sick|drunk)(?:\s*(?:,|and)\s*(?:(?:very|so)\s+)?[\p{Ll}]+){0,2}(?:\s+(?:on|at|by|with|in|across)\s+(?:his|her|the|their|its)\s+\p{Ll}+)?)/u;
const POSTURE_RE = /(?<![\p{L}])(?:fell asleep|stood at|lay across|sat on|sat at|stood by)\s+((?:the|his|her|its|their)\s+[\p{Ll}-]+(?:,\s*[\p{Ll}]+)?)/u;
function driftReader(sheet, base, { log, wrongSet, hash, N, Canon, yesToSlips = false }) {
  const pick = (xs, k) => xs[Math.abs(hash(k)) % xs.length];
  const drift = (attr, k) => pick(DRIFT[attr] || DRIFT[String(attr).split('.')[0]] || [String(attr).split('.').pop()], k);
  const EPITHET = /\s+(?:the\s+(?:Elder|Younger|Third|Second|First)|Junior|Senior|Jr|Sr)$/;
  const lines = (text) => [...text.matchAll(/\[(\d+)\] ([^[]*)/g)].map((m) => [+m[1], m[2].trim()]);
  const ix = base.ix;
  const drifted = new Set();
  return {
    ...base,
    drifted,
    id: 'sheet-drift',
    async cast(args) {
      const r = await base.cast(args);
      const plain = args.text.replace(/¶\d+\s/g, '');
      const out = [];
      const seen = new Set();
      for (const c of r.cast) {
        const e = ix.byName(c.name);
        let name = c.name;
        let aliases = [...c.aliases];
        // (one person for a name generations share: the epithets are aliases)
        if (e && EPITHET.test(e.name)) {
          name = e.name.replace(EPITHET, '');
          if (!new RegExp(name).test(plain)) name = e.name.split(/\s+/)[0];
          aliases = sheet.entities.filter((x) => EPITHET.test(x.name) && x.name.startsWith(name)).flatMap((x) => [x.name, ...(x.aliases || [])]).filter((a) => plain.includes(a));
        }
        if (seen.has(N(name))) continue;
        seen.add(N(name));
        // (an animal is a person; a nickname is its own one)
        const kind = c.kind === 'creature' ? 'person' : c.kind;
        const split = aliases.filter((a) => /^\p{Lu}\p{Ll}{2,6}$/u.test(a) && !EPITHET.test(name));
        out.push({ name, kind, aliases: aliases.filter((a) => !split.includes(a)) });
        for (const a of split) if (!seen.has(N(a))) { seen.add(N(a)); out.push({ name: a, kind, aliases: [] }); }
      }
      // what the sheet says is no one, when the chapter writes it (a transposed room number)
      for (const n of sheet.notEntities || []) if (/\d/.test(n) && plain.includes(n) && !seen.has(N(n))) out.push({ name: n, kind: 'place', aliases: [] });
      return { cast: out, setting: r.setting };
    },
    async dossier(args) {
      const facts = await base.dossier(args);
      const { name, text } = args;
      const e = ix.byName(name) || sheet.entities.find((x) => EPITHET.test(x.name) && x.name.startsWith(name));
      const ls = lines(text);
      const out = facts.map((f, i) => ({ ...f, a: drift(f.a, name + f.v + i), x: 0 }));
      const add = (g, a, v, s, why) => {
        out.push({ g, a, v, s, x: 0 });
        log.push({ entity: name, attr: a, value: v, v, quote: (ls.find(([n]) => n === s[0]) || [])[1] || '', wrong: true, of: why, supported: false });
        wrongSet.add(N(name + '|' + v));
      };
      // the later value a slip stands on, as a fact of its own
      for (const sl of sheet.slips || []) {
        const at = ls.find(([, t]) => N(sl.sentence).includes(N(t).replace(/[.!?]+$/, '')) || N(t).includes(N(sl.sentence).replace(/[.!?]+$/, '')));
        if (!at) continue;
        if (sl.kind === 'deed') {
          const doer = ix.byName(sl.span) || sheet.entities.find((x) => N(x.name) === N(sl.span));
          if (doer && ix.byName(name) === doer) add('history', 'deed', N(sl.against.quote).split(/\s+/).slice(-8).join(' '), [at[0]], 'slip');
          continue;
        }
        if (!e || e.id !== sl.entity) continue;
        add(Canon.Editor.GROUPS.includes(String(sl.attr).split('.')[0]) ? String(sl.attr).split('.')[0] : 'description', drift(sl.attr, sl.sentence), sl.span, [at[0]], 'slip');
      }
      // the sheet's traps, where a sentence of the pack holds their words
      for (const t of (e && e.traps) || []) {
        const vs = Canon.Editor.content(t.value);
        const at = ls.find(([, s]) => { const bag = new Set(Canon.Editor.content(s)); return vs.length && vs.filter((w) => Canon.Editor.inBag(w, bag)).length / vs.length >= 0.5; });
        if (at) add(String(t.attr).split('.')[0] === 'appearance' ? 'appearance' : (Canon.Editor.GROUPS.includes(String(t.attr).split('.')[0]) ? String(t.attr).split('.')[0] : 'other'), drift(t.attr, t.value), t.value, [at[0]], 'trap');
      }
      // one moment, as a lasting state
      for (const [n, s] of ls) {
        const m = MOMENT_RE.exec(s) || POSTURE_RE.exec(s);
        if (m && N(s).includes(N(name).replace(/^the\s+/, '').split(' ')[0]) || (m && /^(?:He|She|It)\b/.test(s))) add('state', pick(['mood', 'state', 'condition', 'habit'], s), m[1].replace(/[,.]$/, ''), [n], 'moment');
      }
      // an animal's sex from the nearest he or she
      if (e && e.kind === 'creature') {
        const at = ls.find(([, s]) => /(?<![\p{L}])(?:he|his|him|she|her)(?![\p{L}])/iu.test(s));
        if (at) { const male = /(?<![\p{L}])(?:he|his|him)(?![\p{L}])/iu.test(at[1]); const v = male ? 'male' : 'female'; if (!(e.facts || []).some((f) => f.attr === 'sex' && f.value === v)) add('sex', 'sex', v, [at[0]], 'pronoun'); }
      }
      return out;
    },
    async verify(q) {
      if (wrongSet.has(N(q.name + '|' + q.value))) return q.negated || q.other || q.moment ? 'no' : 'yes';
      // (a true fact under a drifted label is still true: the label isn't the sheet's)
      return base.verify({ ...q, label: 'other' });
    },
    async whose(q) { return wrongSet.has(N(q.name + '|' + q.value)) ? q.name : base.whose({ ...q, label: 'other' }); },
    // sentences that cite real facts and say more than they do
    async profile({ name, kind, facts }) {
      if (!facts.length) return [];
      const [a, b] = [facts[0], facts[1] || facts[0]];
      const out = [
        { t: `${name} is ${a.value}.`, f: [a.n] },
        { t: `${name} is a kind and gentle ${kind === 'person' ? 'soul' : 'place'} known for ${b.value}.`, f: [b.n] },
        { t: `${name} is always frightened and never ${b.value}.`, f: [a.n, b.n] },
        { t: `${name}, whose ${String(b.label).toLowerCase()} is ${b.value}, is loved by everyone.`, f: [b.n] },
        // (every word in the facts, the meaning not: a "never" dropped, one word of a value picked out)
        ...facts.filter((f) => /(?<![\p{L}])(?:never|not|no|none|nobody)(?![\p{L}])/iu.test(f.value)).slice(0, 1).map((f) => ({ t: `${name} ${f.value.replace(/(?<![\p{L}])(?:never|not|no|none|nobody)\s+/iu, '')}.`, f: [f.n] })),
        ...facts.filter((f) => /\s(?:of|in|at)\s+\S/.test(f.value)).slice(0, 1).map((f) => ({ t: `${name} is ${f.value.split(/\s(?:of|in|at)\s+/)[1]}.`, f: [f.n] }))
      ];
      // (every one of them but a plain "X's label is value" says something the facts don't;
      // "X is value" does only when value isn't what X is: an age, a role, a look of the whole)
      // ("X is value" says otherwise when the value is what happened to X, what X does or has, whom X is kin to)
      const BAD = /^(?:history|habit|routine|custom|relationship|possession|residents|members|function|use|effect)/;
      for (const x of out) if (x !== out[0] || (BAD.test(Canon.canonLabel(a.label || '')) && !/^(?:born|built|founded|kept|owned)\b/i.test(a.value))) drifted.add(N(x.t).replace(/[.\s]+$/, ''));
      out.push({ t: `The ${String(a.label).toLowerCase()} of ${name} is ${a.value}.`, f: [a.n] });
      return out;
    },
    async entails({ more }) { return more ? 'no' : 'yes'; },
    async contradicts() { return yesToSlips ? 'yes' : 'no'; },
    async clash() { return yesToSlips ? 'yes' : 'no'; },
    async refers() { return 'yes'; }
  };
}

// Round 5: a reader that fails the way the real Careful reader failed on the
// fourth held-out batch (/tmp eval4 BRIEF: types only). The drift reader, and:
//
//   ties       casts each one by the name the chapter writes, never by an
//              epithet ("the commander", "the old man", "the boy") or a short
//              name ("Tom"), which it casts as someone of its own when it is a
//              name; the narrator is no one, the name a radio call or a line
//              of speech gives the narrator its own empty one
//   renamed    a pet called by another name is another pet
//   numbers    a numbered room or hut is no one (Hut 12 is never cast), and the
//              number turned round is a place with the slip's sentence as a fact
//   recall     never proposes a rank, a species or a breed
//   times      gives a watch or a shift as the bare range ("2200 to 0600")
//
// and it believes all of it, as the drift reader does.
function drift5Reader(sheet, base, { log, wrongSet, N }) {
  const ix = base.ix;
  const lines = (text) => [...text.matchAll(/\[(\d+)\] ([^[]*)/g)].map((m) => [+m[1], m[2].trim()]);
  const own = (e, a) => { const ws = N(e.name).split(/\s+/); return N(a).split(/\s+/).every((w) => ws.includes(w)); };
  const RANKISH = /^(?:able seaman|leading seaman|(?:chief )?petty officer|midshipman|sub-lieutenant|lieutenant(?: commander| colonel)?|commander|captain|commodore|admiral|private|lance corporal|corporal|sergeant|staff sergeant|major|colonel|brigadier|general|constable|police constable|inspector|detective(?: \w+)?|superintendent|vicar|rector|canon|bishop|archdeacon)$/i;
  const renamed = (sheet.slips || []).filter((sl) => sl.kind === 'name' && !/\d/.test(sl.span));
  return {
    ...base,
    id: 'sheet-drift5',
    async cast(args) {
      const r = await base.cast(args);
      const plain = args.text.replace(/¶\d+\s/g, '');
      const out = [];
      const seen = new Set();
      for (const c of r.cast) {
        const e = ix.byName(c.name) || ix.byName((c.aliases || [])[0] || '');
        if (e && /\s\d+$/.test(e.name)) continue; // (a numbered room is no one)
        if (e && (e.aliases || []).some((a) => /^the narrator$/i.test(a))) {
          // (the narrator is no one; the name the radio or a line of speech gives is its own empty one)
          const said = [e.name, ...e.aliases].filter((a) => !/^the narrator$/i.test(a)).find((a) => plain.includes(a));
          if (said && !seen.has(N(said))) { seen.add(N(said)); out.push({ name: said, kind: 'person', aliases: [] }); }
          continue;
        }
        const keep = (c.aliases || []).filter((a) => e ? own(e, a) : true);
        // (a nickname the drift reader already cast as its own one stays so)
        const name = e && !own(e, c.name) && keep.length ? keep[0] : c.name;
        if (seen.has(N(name))) continue;
        seen.add(N(name));
        out.push({ ...c, name, aliases: keep.filter((a) => N(a) !== N(name)) });
        // a short name or nickname written here is someone of its own
        for (const a of (c.aliases || []).filter((x) => e && !own(e, x) && /^\p{Lu}/u.test(x) && plain.includes(x))) if (!seen.has(N(a))) { seen.add(N(a)); out.push({ name: a, kind: c.kind, aliases: [] }); }
      }
      // a pet called by another name is another pet
      for (const sl of renamed) if (plain.includes(sl.span) && !seen.has(N(sl.span))) { seen.add(N(sl.span)); out.push({ name: sl.span, kind: 'creature', aliases: [] }); }
      return { cast: out, setting: r.setting };
    },
    async dossier(args) {
      const facts = await base.dossier(args);
      const ls = lines(args.text);
      let out = facts.filter((f) => !(f.g === 'species' || (f.g === 'role' && RANKISH.test(String(f.v).trim()))));
      // (a watch or a shift as the bare range)
      out = out.map((f) => { const m = /(\d{4})\s+(?:to|until|till|-|–)\s+(\d{4})/.exec(f.v); return m ? { ...f, v: `${m[1]} to ${m[2]}` } : f; });
      for (const f of out) if (/^\d{4} to \d{4}$/.test(f.v)) { log.push({ entity: args.name, attr: 'routine', value: f.v, v: f.v, quote: '', wrong: false, of: args.name, supported: true }); }
      // the number turned round: a place, the slip's sentence its fact
      for (const sl of (sheet.slips || []).filter((x) => x.kind === 'name' && /\d/.test(x.span) && N(x.span) === N(args.name))) {
        const at = ls.find(([, t]) => N(sl.sentence).includes(N(t).replace(/[.!?]+$/, '')) || N(t).includes(N(sl.sentence).replace(/[.!?]+$/, '')));
        if (!at) continue;
        const v = at[1].replace(/[.!?]+$/, '').split(/,\s*/).pop();
        out.push({ g: 'description', a: 'room', v, s: [at[0]], x: 0 });
        log.push({ entity: args.name, attr: 'description', value: v, v, quote: at[1], wrong: true, of: 'slip', supported: false });
        wrongSet.add(N(args.name + '|' + v));
      }
      return out;
    }
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
    // ('credulous': the drift reader, but yes to every slip question — what a false slip needs)
    const reader = mode === 'drift' || mode === 'credulous' || mode === 'drift5'
      ? (() => {
        const base = sheetReader(sheet, { mode: 'perfect', setting, log, packs });
        const d = driftReader(sheet, base, { log, wrongSet: base.wrongSet, hash: (k) => [...String(k)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7), N, Canon, yesToSlips: mode === 'credulous' });
        return mode === 'drift5' ? drift5Reader(sheet, d, { log, wrongSet: base.wrongSet, N }) : d;
      })()
      : sheetReader(sheet, { mode, setting, log, packs });
    const engine = Canon.createEngine({ io, reader });
    await engine.readShelf({});
    const { slips, asks = [] } = await engine.check({ scope: 'shelf' });
    const entries = io.entries().map((x) => ({ ...Canon.parseEntry(x.text), raw: x.text }));
    const texts = Score.textIndex(lib);
    const pick = (s) => ({ chId: s.chId, sentence: s.sentence, span: s.span, name: s.name });
    const score = Score.score({ answers, run: { entries, profiles: new Map() }, texts, slips: { slips: slips.map(pick), worthALook: asks.map(pick) } });
    return { score, entries, cache, log, slips, asks, sheet, answers, packs, drifted: reader.drifted || null };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// Of the sheet's facts a reader could keep as true (not said; not one the
// sheet asks the writer about), how many the entries keep → { of, kept, lost: [],
// proposed: { of, kept } (those the perfect reader proposed: what the gates decide) }
function survival(run) {
  const { sheet, entries } = run;
  const needs = new Set((sheet.needs || []).map((n) => n.entity + '|' + n.attr));
  const ent = (a) => entries.filter((e) => [e.name, ...e.aliases].some((n) => [a.name, ...(a.aliases || [])].some((x) => N(x).replace(/^the\s+/, '') === N(n).replace(/^the\s+/, ''))));
  const out = { of: 0, kept: 0, lost: [], proposed: { of: 0, kept: 0 } };
  for (const a of sheet.entities) {
    const mine = ent(a);
    for (const f of a.facts) {
      if (f.said || needs.has(a.id + '|' + f.attr)) continue;
      out.of++;
      const produced = mine.flatMap((e) => e.facts.filter((g) => ['verified', 'yours', 'reading'].includes(g.state)).map((g) => {
        const label = Canon.labelOf(g);
        const LEG = { sex: 'sex', species: 'species', eyes: 'appearance.eyes', hair: 'appearance.hair', birthplace: 'origin', sibling: 'relationship.kin', parent: 'relationship.kin', child: 'relationship.kin', spouse: 'relationship.kin', owner: 'possession', home: 'location.home', title: 'role' };
        return { value: g.value, as: g.as, attr: g.attr !== 'other' ? (LEG[g.attr] || Score.canonLabel(label)) : Score.canonLabel(label), quotes: g.sources.filter((s) => !s.written).map((s) => s.quote) };
      }));
      // (a name is kept in the entry's names: "Anselm", "Brother Ink")
      const named = f.attr === 'name' && mine.some((e) => [e.name, ...e.aliases].some((n) => Canon.Editor.content(f.value).some((w) => Canon.Editor.content(n).includes(w))));
      // (a sheet value its own quote doesn't hold — "Hesper (not Coll)" from "He was not one of the Spared" — is the sheet's reading, not a reader's: not counted)
      // (nor one whose quote is a sentence the sheet has a slip stand on: no fact is read from a slip's sentence)
      const onSlip = (sheet.slips || []).some((x) => N(x.sentence).includes(N(Canon.sentences(f.quote)[0].text).replace(/[.!?]+$/, '')));
      const offered = !onSlip && (named || (run.log || []).some((y) => !y.wrong && y.supported && y.value === f.value && y.quote === f.quote));
      if (offered) out.proposed.of++;
      if (named || produced.some((pf) => { const m = Score.matchFact(pf, [{ ...f, entity: a }]); return m; })) { out.kept++; if (offered) out.proposed.kept++; }
      else {
        // why: the gate that dropped what the reader proposed, or never proposed (not in the pack)
        const said = (run.log || []).filter((y) => !y.wrong && y.value === f.value && y.quote === f.quote);
        const drops = Object.entries(((run.cache || {}).ed || {}).dropped || {}).flatMap(([, xs]) => xs.filter((x) => said.some((y) => N(y.entity) === N(x.entity) && N(y.v) === N(x.value))).map((x) => x.why));
        const eng = Object.values((run.cache || {}).dropped || {}).filter((x) => mine.some((e) => e.name === x.entry) && N(x.quote).includes(N(Canon.sentences(f.quote)[0].text).slice(0, 30))).map((x) => 'engine ' + x.why + ' ' + x.attr);
        const why = (offered ? '' : 'not counted: ') + (drops.length ? drops.join(', ') : eng.length ? eng.join(', ') : said.length ? 'kept elsewhere/merged?' : 'not proposed');
        out.lost.push(`${a.name} · ${f.attr}: ${f.value}  ← "${f.quote}"  [${why}]`);
      }
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
    const kept = e.facts.filter((g) => ['verified', 'reading'].includes(g.state)).filter((g) => {
      const pf = { value: g.value, as: g.as, attr: Score.canonLabel(Canon.labelOf(g)), quotes: g.sources.map((s) => s.quote) };
      const m = Score.matchFact(pf, [{ attr: x.attr, value: x.value, quote: x.quote, alt: [] }]);
      return m && !ix.truth(e.name, Canon.labelOf(g), g.value) && !ix.truth(e.name, 'other', g.value);
    });
    for (const g of kept) out.push(`${e.name} · ${Canon.labelOf(g)}: ${g.value}  (${['slip', 'trap', 'moment', 'pronoun'].includes(x.of) ? x.of : `really ${x.of}'s`})  ← "${(g.sources[0] || {}).quote}"`);
  }
  return [...new Set(out)];
}

const SETTINGS = { dev: 'the Weighhouse' };

// One line per reader for a run: must recall (dotted, and everything shown),
// precision of what is shown (the sheet, its traps, what the reader made up),
// slips, Which is right?, identity and profiles
function summary(run, { made = [] } = {}) {
  const sc = run.score;
  const said = run.entries.flatMap((e) => (Score.readProfile(e.raw) || { sentences: [] }).sentences.map((t) => N(t.replace(/\s*\[\d+\]/g, '')).replace(/[.\s]+$/, '')));
  const drifted = run.drifted ? said.filter((t) => run.drifted.has(t)).length : 0;
  const shown = (f) => ['verified', 'yours', 'reading'].includes(f.state);
  const dotted = run.entries.reduce((n, e) => n + e.facts.filter((f) => ['verified', 'yours'].includes(f.state)).length, 0);
  const reading = run.entries.reduce((n, e) => n + e.facts.filter((f) => f.state === 'reading').length, 0);
  const wrong = sc.precision.wrong.length + made.length;
  const judged = sc.precision.supported + wrong;
  const s = sc.slips || { found: 0, of: 0, false: [], worthALook: [] };
  return { must: `${sc.facts.must.found}/${sc.facts.must.of}`, mustDot: `${sc.facts.mustDotted.found}/${sc.facts.mustDotted.of}`, prec: judged ? `${sc.precision.supported}/${judged}` : '-', dotted, reading, unjudged: sc.precision.review.length,
    slips: `${s.found}/${s.of}`, falseSlips: s.false.length, worth: (s.worthALook || []).length, needs: `${sc.needs.found}/${sc.needs.want}`,
    junk: (sc.entities.junk || []).length, split: (sc.entities.split || []).length, profBad: (sc.profiles.unsupported || []).length + drifted, profOf: sc.profiles.sentences || 0, shown: run.entries.reduce((n, e) => n + e.facts.filter(shown).length, 0) };
}
const line = (m, x) => `${m.padEnd(11)} must ${x.must.padEnd(7)} (dotted ${x.mustDot}) precision ${x.prec.padEnd(8)} (dotted ${x.dotted}, reading ${x.reading}, unjudged ${x.unjudged})  slips ${x.slips} false ${x.falseSlips} worth ${x.worth}  needs ${x.needs}  junk ${x.junk} split ${x.split}  profile bad ${x.profBad}/${x.profOf}`;

async function main() {
  const tot = {};
  const sum = (m, x) => { const t = (tot[m] = tot[m] || {}); for (const [k, v] of Object.entries(x)) { if (typeof v === 'number') t[k] = (t[k] || 0) + v; else if (/^\d+\/\d+$/.test(v)) { const [a, b] = v.split('/').map(Number); const [c, d] = (t[k] || '0/0').split('/').map(Number); t[k] = `${a + c}/${b + d}`; } else t[k] = t[k] || v; } };
  const dirs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const fixtures = dirs.length ? dirs.map((d) => path.resolve(d)) : [...FIXTURES, ...DEV3, ...DEV4];
  const v = process.argv.includes('--v');
  for (const fx of fixtures) {
    const name = path.relative(FIX, fx);
    const setting = SETTINGS[name] || '';
    const run = await runSheet(fx, { mode: 'perfect', setting });
    const cov = packCoverage(run, { weights: ['must', 'should', 'nice'] });
    const covMust = packCoverage(run, { weights: ['must'] });
    const sv = survival(run);
    const adv = await runSheet(fx, { mode: 'adversarial', setting });
    const bad = survivors(adv);
    const dr = await runSheet(fx, { mode: 'drift', setting });
    const drBad = survivors(dr);
    const cr = await runSheet(fx, { mode: 'credulous', setting });
    const d5 = await runSheet(fx, { mode: 'drift5', setting });
    console.log(`\n== ${name}: pack coverage must ${covMust.in}/${covMust.of}, all ${cov.in}/${cov.of}; perfect reader keeps ${sv.kept}/${sv.of} (of what it proposed ${sv.proposed.kept}/${sv.proposed.of}); adversary's kept ${bad.length}/${adv.log.filter((x) => x.wrong).length}; drift's kept ${drBad.length}/${dr.log.filter((x) => x.wrong).length}`);
    const sums = { perfect: summary(run), adversary: summary(adv, { made: bad }), drift: summary(dr, { made: drBad }), credulous: summary(cr, { made: survivors(cr) }), drift5: summary(d5, { made: survivors(d5) }) };
    for (const [m, x] of Object.entries(sums)) { console.log('  ' + line(m, x)); sum(m, x); for (const set of ['dev2', 'dev3', 'dev4']) if (name.startsWith(set + '/')) sum(m + '·' + set, x); }
    const show = (tag, r, made) => {
      for (const w of r.score.precision.wrong) console.log(`  ${tag} wrong: ${w}`);
      for (const w of made) console.log(`  ${tag} kept made-up: ${w}`);
      if (r.score.slips) for (const w of r.score.slips.missed || []) console.log(`  ${tag} slip missed: ${w}`);
      if (r.score.slips) for (const w of r.score.slips.false || []) console.log(`  ${tag} false slip: ${w}`);
      if (r.score.slips) for (const w of r.score.slips.worthALook || []) console.log(`  ${tag} worth a look: ${w}`);
      for (const w of r.score.needs.missed || []) console.log(`  ${tag} needs missed: ${w}`);
      for (const w of r.score.entities.junk || []) console.log(`  ${tag} junk: ${w}`);
      for (const w of r.score.entities.split || []) console.log(`  ${tag} split: ${w}`);
      for (const w of r.score.profiles.unsupported || []) console.log(`  ${tag} profile: ${w}`);
    };
    if (v || process.argv.includes('--drift')) { show('drift', dr, drBad); show('credulous', cr, survivors(cr)); }
    if (v || process.argv.includes('--drift5')) show('drift5', d5, survivors(d5));
    if (v) {
      for (const m of cov.missing) console.log('  not in pack: ' + m);
      for (const m of sv.lost) console.log('  lost: ' + m);
      show('perfect', run, []);
      for (const w of bad) console.log('  adversary kept: ' + w);
      if (adv.score.slips) for (const w of adv.score.slips.false || []) console.log('  adversary false slip: ' + w);
      for (const [ch, xs] of Object.entries(((run.cache || {}).ed || {}).dropped || {})) for (const x of xs) if (run.log.some((y) => !y.wrong && N(y.entity) === N(x.entity) && N(y.v) === N(x.value))) console.log(`  gate (${ch.split('/').pop()}): ${x.entity} · ${x.label}: ${x.value} — ${x.why}`);
      for (const x of Object.values((run.cache || {}).dropped || {})) console.log(`  engine: ${x.entry} · ${x.attr}: ${x.value} — ${x.why}  ← "${x.quote}"`);
    }
  }
  console.log('\n== totals');
  for (const [m, x] of Object.entries(tot)) console.log('  ' + line(m, x));
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { sheetReader, driftReader, drift5Reader, packCoverage, runSheet, survival, survivors, summary, FIXTURES, DEV3, DEV4, SETTINGS, groupOf, citeIds };
