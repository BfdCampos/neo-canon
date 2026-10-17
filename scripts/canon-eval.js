'use strict';

// Canon's accuracy with a real reader: Read the Shelf, then the Continuity
// Pass, on a fixture library, scored against its expected.json. Not part of
// `npm test` (minutes to an hour on a CPU). docs/semantics/ACCURACY.md.
//
//   node scripts/canon-eval.js [--fixture canon|canon-heldout|all|<fixture dir>] [--model quick|careful|thorough|deep|fake|<path.gguf>]
//                              [--threads N] [--fresh] [--memo <file>] [--json <file>] [--dump] [--log] [--keep <dir>]
//                              [--legacy] [--sequences N] [--only-cached]
//
// careful, thorough and deep read the editor's way (docs/semantics/READING.md:
// cast, dossiers, verifier, profiles); quick, and --legacy, the paragraph way.
// --sequences N answers N prompts at once (a GPU; 1 on a CPU). --only-cached
// asks the model nothing new: what the memo doesn't hold is answered "none".
//
// --keep <dir> keeps what the run made, for scripts/canon-score.js: the
// Canon folder (entries/*.md) and slips.json (the pass's slips and Worth a
// look). --model fake answers from the fixture's reader-answers.json (none:
// a reader that proposes nothing). A fixture without expected.json is run,
// not scored here.
//
// Models come from CANON_MODELS (default /tmp/claude-0/llama-probe/models).
// Every model answer is remembered in a memo file (keyed by the whole
// prompt), so a change to the gates re-runs in seconds and a change to a
// prompt asks only what changed; --fresh asks everything again. "model s"
// counts the time of every answer, remembered or not, so it reads as a
// cold run. The worker runs with a dead proxy: any network use fails it.
//
// Scored:
//   verified precision  verified facts that are true / all verified (must be 100%)
//   verified recall     expected verified facts found verified
//   slips               expected slips found / missed; false slips (any other)

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const Canon = require('../canon.js');

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const flag = (name) => process.argv.includes('--' + name);
const MODELS = process.env.CANON_MODELS || '/tmp/claude-0/llama-probe/models';
const TIERS = { quick: /qwen2\.5-1\.5b-instruct.*q4_k_m\.gguf$/i, careful: /qwen3-4b-instruct-2507.*q4_k_m\.gguf$/i, thorough: /qwen3-8b.*q4_k_m\.gguf$/i, deep: /qwen3-14b.*q4_k_m\.gguf$/i };
// as main.js READERS has them
const LOAD = { quick: {}, careful: { ctx: 8192, editor: true }, thorough: { ctx: 8192, editor: true, thoughts: 'discourage' }, deep: { ctx: 8192, editor: true, thoughts: 'discourage' } };

function findModel(want) {
  if (fs.existsSync(want)) return { tier: path.basename(want), file: want };
  const f = fs.readdirSync(MODELS).find((x) => TIERS[want].test(x));
  if (!f) throw new Error(`no ${want} model in ${MODELS}`);
  return { tier: want, file: path.join(MODELS, f) };
}

// the shelf as main.js reads it: chapters in shelf order, a book's Notes after them
function shelfSources(lib) {
  const library = JSON.parse(fs.readFileSync(path.join(lib, 'library.json'), 'utf8'));
  const out = [];
  for (const bookId of library.shelves[0].bookIds) {
    const meta = JSON.parse(fs.readFileSync(path.join(lib, bookId, 'book.json'), 'utf8'));
    const notebook = meta.format === 'notebook';
    meta.chapterOrder.forEach((chId, i) => out.push({ bookId, chId, book: meta.title,
      label: notebook ? meta.chapterTitles[chId] : 'Ch ' + (i + 1), notebook, html: fs.readFileSync(path.join(lib, bookId, 'chapters', chId + '.html'), 'utf8') }));
    const notes = path.join(lib, bookId, 'notes.html');
    if (!notebook && fs.existsSync(notes)) out.push({ bookId, chId: 'notes', book: meta.title, label: 'Notes', notes: true, html: fs.readFileSync(notes, 'utf8') });
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

function folderIO(lib, dir) {
  const json = (f, fallback) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : fallback;
  return {
    sources: () => shelfSources(lib),
    meta: () => json(path.join(dir, 'canon.json'), {}),
    saveMeta: (m) => fs.writeFileSync(path.join(dir, 'canon.json'), JSON.stringify(m, null, 2)),
    entries: () => fs.readdirSync(path.join(dir, 'entries')).filter((f) => f.endsWith('.md')).map((f) => ({ id: f.slice(0, -3), text: fs.readFileSync(path.join(dir, 'entries', f), 'utf8') })),
    saveEntry: (id, text) => fs.writeFileSync(path.join(dir, 'entries', id + '.md'), text),
    notSlips: () => json(path.join(dir, 'not-slips.json'), []),
    // (kept in memory for the run, and written beside the Canon by --keep: what was dropped and why)
    cache: () => folderIO.last || null,
    saveCache: (c) => { folderIO.last = c; },
    knownWords
  };
}

// a worker with the model loaded, and `ask` remembered in the memo
async function startReader(model, threads, memoFile, fresh) {
  const memo = !fresh && fs.existsSync(memoFile) ? JSON.parse(fs.readFileSync(memoFile, 'utf8')) : {};
  const dead = 'http://127.0.0.1:9';
  let child = null;
  let seq = 0;
  const waiting = new Map();
  const request = (msg) => new Promise((resolve) => { const id = ++seq; waiting.set(id, resolve); child.send({ ...msg, id }); });
  const stats = { asked: 0, remembered: 0, modelMs: 0, loadMs: 0 };
  let loading = null;
  const load = () => loading || (loading = (async () => {
    child = fork(path.join(__dirname, '..', 'canon-worker.js'), [], { env: { ...process.env, HTTPS_PROXY: dead, HTTP_PROXY: dead, https_proxy: dead, http_proxy: dead } });
    child.on('message', (m) => { const done = waiting.get(m.id); if (done) { waiting.delete(m.id); done(m); } });
    const t0 = Date.now();
    const how = LOAD[model.tier] || {};
    const r = await request({ type: 'load', chat: model.file, threads, ctx: flag('legacy') ? 2048 : how.ctx || 2048, thoughts: how.thoughts, sequences: +arg('sequences', 1) });
    if (!r.ok) throw new Error(r.error);
    stats.loadMs = Date.now() - t0;
  })());
  let dirty = 0;
  const save = () => { if (dirty) { fs.mkdirSync(path.dirname(memoFile), { recursive: true }); fs.writeFileSync(memoFile, JSON.stringify(memo)); dirty = 0; } };
  const ask = async (msg) => {
    const key = crypto.createHash('sha256').update(JSON.stringify([path.basename(model.file), msg.system, msg.user, msg.schema, msg.maxTokens, ...(msg.compact ? ['compact'] : [])])).digest('hex');
    const log = (result) => { if (flag('log')) console.error(`--- ${msg.user.split('\n').slice(-2).join(' | ')}\n=> ${JSON.stringify(result)}`); return result; };
    if (memo[key]) { stats.remembered++; stats.modelMs += memo[key].ms; return log(memo[key].result); }
    if (flag('only-cached')) { stats.missing = (stats.missing || 0) + 1; return null; }
    await load();
    const r = await request({ type: 'prompt', ...msg });
    if (!r.ok) throw new Error(r.error);
    stats.asked++;
    stats.modelMs += r.ms;
    const kind = msg.schema === Canon.CAST_SCHEMA ? 'cast' : msg.schema === Canon.DOSSIER_SCHEMA ? 'dossier' : msg.schema === Canon.PROFILE_SCHEMA ? 'profile' : msg.schema === Canon.STORY_SCHEMA ? 'events' : msg.schema === Canon.PROPOSE_SCHEMA ? 'propose' : 'question';
    stats.kinds = stats.kinds || {};
    const k = stats.kinds[kind] = stats.kinds[kind] || { n: 0, ms: 0 };
    k.n++; k.ms += r.ms;
    memo[key] = { result: r.result, ms: r.ms, q: msg.user.slice(-600) }; // (the question's end, to read back)
    dirty++;
    save(); // (every answer: a run stopped part way keeps what it asked)
    return log(r.result);
  };
  return { ask, stats, save, stop: () => { save(); if (child) child.kill(); } };
}

/* ---------- scoring ---------- */

const N = (s) => Canon.norm(String(s || ''));
// the expected entry a read entry stands for: its name or alias, or a name
// part only one expected person carries ("Ilsa", "Varr"; not "Hale")
function entryMap(expected) {
  const all = expected.entries;
  return (name) => {
    const n = N(name).replace(/^the\s+/, '');
    const whole = all.find((e) => [e.name, ...(e.aliases || [])].some((a) => N(a).replace(/^the\s+/, '') === n));
    if (whole) return whole;
    const parts = all.filter((e) => e.kind === 'person' && Canon.nameParts(e.name).some((p) => N(p) === n));
    return parts.length === 1 ? parts[0] : null;
  };
}
// a read fact, true or not: it matches an expected fact (said and plan ones
// are not truths) or one in `alsoTrue` (true, but not asked for)
function truth(expected, ent, f) {
  const x = ent(f.entity);
  if (!x) return { known: false };
  const val = (attr, v) => Canon.ATTRS[attr] && Canon.ATTRS[attr].ref ? ((ent(v) || {}).id || N(v)) : N(v);
  const same = (g) => g.attr === f.attr && val(g.attr, g.value) === val(f.attr, f.value);
  const facts = [...x.facts.filter((g) => !g.said && !g.plan), ...((expected.alsoTrue || {})[x.id] || [])];
  return { known: true, id: x.id, true: facts.some(same), expectedVerified: x.facts.some((g) => same(g) && g.state === 'verified') };
}

function score(expected, entries, slips) {
  const ent = entryMap(expected);
  const verified = [];
  const wrong = [];
  const found = new Set();
  for (const e of entries) {
    for (const f of e.facts) {
      if (f.state !== 'verified') continue;
      const t = truth(expected, ent, { entity: e.name, attr: f.attr, value: f.value });
      const line = `${e.name} · ${Canon.labelOf(f)}: ${f.value}${f.as ? ` (${f.as})` : ''}  ← "${(f.sources.find((s) => !s.written) || {}).quote || ''}"`;
      verified.push(line);
      if (!t.true) wrong.push(line);
      if (t.expectedVerified) found.add(t.id + '|' + f.attr + '|' + N(f.value));
    }
  }
  const want = expected.entries.flatMap((x) => x.facts.filter((g) => g.state === 'verified').map((g) => x.id + '|' + g.attr + '|' + N(g.value)));
  // a verified relation counts as found when its value names the expected entry
  const foundRel = new Set();
  for (const e of entries) {
    for (const f of e.facts) {
      if (f.state !== 'verified' || !(Canon.ATTRS[f.attr] || {}).ref) continue;
      const x = ent(e.name);
      const v = ent(f.value);
      if (x && v) for (const g of x.facts) if (g.state === 'verified' && g.attr === f.attr && (ent(g.value) || {}).id === v.id) foundRel.add(x.id + '|' + g.attr + '|' + N(g.value));
    }
  }
  const recall = want.filter((k) => found.has(k) || foundRel.has(k)).length;
  const key = (s) => N(s.sentence) + '|' + N(s.span);
  const expSlips = new Map(expected.slips.map((s) => [key(s), s]));
  const hit = slips.filter((s) => expSlips.has(key(s)));
  const falseSlips = slips.filter((s) => !expSlips.has(key(s)));
  const missed = expected.slips.filter((s) => !slips.some((x) => key(x) === key(s)));
  return {
    verified: verified.length, wrongVerified: wrong, precision: verified.length ? (verified.length - wrong.length) / verified.length : 1,
    recall: `${recall}/${want.length}`, slipsFound: `${new Set(hit.map(key)).size}/${expected.slips.length}`,
    missed: missed.map((s) => `"${s.span}" in "${s.sentence}"`),
    falseSlips: falseSlips.map((s) => `${s.name} · ${s.book}, ${s.label} · "${s.span}" in "${s.sentence}"`),
    verifiedFacts: verified,
    needs: entries.flatMap((e) => e.facts.filter((f) => f.state === 'unverified' || f.state === 'disagree').map((f) => `${e.name} · ${Canon.labelOf(f)}: ${f.value} · ${f.state}${f.sources.some((s) => s.said) ? ' (said)' : ''}`))
  };
}

async function evalFixture(name, reader, tier) {
  const fixture = fs.existsSync(path.resolve(name, 'library')) ? path.resolve(name) : path.join(__dirname, 'fixtures', name);
  const expFile = path.join(fixture, 'expected.json');
  const expected = fs.existsSync(expFile) ? JSON.parse(fs.readFileSync(expFile, 'utf8')) : null;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-canon-eval-'));
  const lib = path.join(root, 'library');
  fs.cpSync(path.join(fixture, 'library'), lib, { recursive: true });
  const library = JSON.parse(fs.readFileSync(path.join(lib, 'library.json'), 'utf8'));
  const dir = path.join(lib, library.shelves[0].canonId);
  folderIO.last = null;
  const io = folderIO(lib, dir);
  try {
    const before = reader.stats.modelMs;
    const t0 = Date.now();
    const fake = tier === 'fake' && (fs.existsSync(path.join(fixture, 'reader-answers.json')) ? JSON.parse(fs.readFileSync(path.join(fixture, 'reader-answers.json'), 'utf8')) : {});
    const editor = !flag('legacy') && (LOAD[tier] || {}).editor;
    const real = Canon.localReader({ id: tier, tier, editor, ask: reader.ask });
    real.parallel = +arg('sequences', 1);
    const engine = Canon.createEngine({ io, reader: fake ? Canon.fakeReader(fake) : real });
    let told = 0;
    const summary = await engine.readShelf({ onProgress: (p) => {
      if (!flag('progress') || Date.now() - told < 5000) return;
      told = Date.now();
      console.error(`[${new Date().toISOString().slice(11, 19)}] ${p.label} ${p.phase}${p.name ? ' ' + p.name : ''} ${p.n || ''}/${p.of || ''} · eta ${p.eta} s · calls ${p.calls}`);
    } });
    const readMs = reader.stats.modelMs - before;
    const t1 = reader.stats.modelMs;
    const { slips, asks = [] } = await engine.check({ scope: 'shelf' });
    const checkMs = reader.stats.modelMs - t1;
    const entries = io.entries().map((x) => Canon.parseEntry(x.text));
    if (arg('keep')) {
      const keep = path.resolve(arg('keep'), path.basename(fixture));
      fs.rmSync(keep, { recursive: true, force: true });
      fs.cpSync(dir, path.join(keep, 'canon'), { recursive: true });
      if (folderIO.last) fs.writeFileSync(path.join(keep, 'cache.json'), JSON.stringify(folderIO.last, null, 1));
      const pick = (s) => ({ bookId: s.bookId, chId: s.chId, entry: s.entry, name: s.name, attr: s.attr, sentence: s.sentence, span: s.span, to: s.to, strength: s.strength });
      fs.writeFileSync(path.join(keep, 'slips.json'), JSON.stringify({ model: tier, slips: slips.map(pick), worthALook: asks.map(pick) }, null, 2));
    }
    if (flag('dump')) for (const x of io.entries()) console.error(x.text);
    // P0 #6: every quote verbatim
    const texts = new Map(shelfSources(lib).map((s) => [s.bookId + '/' + s.chId, Canon.sourceParas(s.html).map((p) => p.text).join('\n')]));
    const misquoted = entries.flatMap((e) => e.facts.flatMap((f) => f.sources.filter((s) => !s.written && !(texts.get(s.book + '/' + s.ch) || '').includes(s.quote)).map((s) => `${e.name}: "${s.quote}"`)));
    // the story so far it kept (STORY.md), each line's quote verbatim too
    const story = entries.flatMap((e) => e.story.map((x) => `${e.name}: ${x.did}  ← "${(x.sources[0] || {}).quote || ''}"`));
    misquoted.push(...entries.flatMap((e) => e.story.flatMap((x) => x.sources.filter((s) => !(texts.get(s.book + '/' + s.ch) || '').includes(s.quote)).map((s) => `${e.name} (story): "${s.quote}"`))));
    const scored = expected ? score(expected, entries, slips) : { verified: entries.reduce((n, e) => n + e.facts.filter((f) => f.state === 'verified').length, 0), precision: NaN, recall: '-', slipsFound: `${slips.length}/-`, falseSlips: [], wrongVerified: [] };
    return { fixture: name, model: tier, summary, readModelS: Math.round(readMs / 1000), checkModelS: Math.round(checkMs / 1000), wallS: Math.round((Date.now() - t0) / 1000), misquoted, worthALook: asks.map((x) => `${x.name}: ${x.sentence}`), story, ...scored };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  const which = arg('fixture', 'all');
  const fixtures = which === 'all' ? ['canon', 'canon-heldout'] : [which];
  const model = arg('model', 'quick') === 'fake' ? { tier: 'fake', file: 'fake' } : findModel(arg('model', 'quick'));
  const threads = +arg('threads', Math.max(1, os.cpus().length - 2));
  const memoFile = arg('memo', path.join(os.tmpdir(), 'neo-canon-eval', path.basename(model.file) + '.memo.json'));
  const reader = await startReader(model, threads, memoFile, flag('fresh'));
  const results = [];
  try {
    for (const f of fixtures) {
      const r = await evalFixture(f, reader, model.tier);
      results.push(r);
      console.log(JSON.stringify(r, null, 2));
    }
  } finally { reader.stop(); }
  console.log('\nfixture        model    verified  precision  recall  slips  false slips  model s (read+pass)');
  for (const r of results) {
    console.log([r.fixture.padEnd(14), r.model.padEnd(8), String(r.verified).padEnd(9), ((r.precision * 100).toFixed(0) + '%').padEnd(10), r.recall.padEnd(7), r.slipsFound.padEnd(6), String(r.falseSlips.length).padEnd(12), `${r.readModelS + r.checkModelS} (${r.readModelS}+${r.checkModelS})`].join(' '));
  }
  if (reader.stats.kinds) console.log('model time by kind (asked this run): ' + Object.entries(reader.stats.kinds).map(([k, v]) => `${k} ${v.n} × ${Math.round(v.ms / v.n / 100) / 10} s`).join(', '));
  console.log(`(${reader.stats.asked} asked, ${reader.stats.remembered} remembered${reader.stats.missing ? `, ${reader.stats.missing} not in the memo` : ''}; load ${Math.round(reader.stats.loadMs / 1000)} s)`);
  if (arg('json')) fs.writeFileSync(arg('json'), JSON.stringify(results, null, 2));
  process.exitCode = results.every((r) => r.wrongVerified.length === 0 && r.falseSlips.length === 0) ? 0 : 1;
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(2); });
module.exports = { shelfSources, folderIO, knownWords };
