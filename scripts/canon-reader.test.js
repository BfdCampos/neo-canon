'use strict';

// Canon's real reader on the Ashfall Road fixture: canon-worker.js running
// the quick model over the chapters where Bramble appears. Opt in, since it
// takes minutes on a CPU:
//   CANON_REAL=1 node --test scripts/canon-reader.test.js
// The model comes from CANON_MODEL, or the first quick (Qwen2.5-1.5B) GGUF in
// CANON_MODELS (default /tmp/claude-0/llama-probe/models). The worker runs
// with a dead proxy, so any network use would fail it (P0 #2).

const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Canon = require('../canon.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'canon', 'library');
const CANON = 'canon-the-ashfall-road-shelf-ash';
const SALT = 'book-the-salt-crown-salt2';
const BRAMBLE = ['book-ember-and-thorn-ember1/c2', 'book-the-salt-crown-salt2/c1', 'book-field-notes-notes3/p1'];

function findModel() {
  if (process.env.CANON_MODEL) return process.env.CANON_MODEL;
  const dir = process.env.CANON_MODELS || '/tmp/claude-0/llama-probe/models';
  try { return path.join(dir, fs.readdirSync(dir).find((f) => /qwen2\.5-1\.5b-instruct.*q4_k_m\.gguf$/i.test(f))); } catch { return null; }
}
const model = process.env.CANON_REAL === '1' ? findModel() : null;

test('the quick reader on Bramble\'s chapters: every quote verbatim, and the slip found', { skip: !model && 'set CANON_REAL=1 (and have the quick model)', timeout: 30 * 60 * 1000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-canon-real-'));
  const lib = path.join(root, 'library');
  fs.cpSync(FIXTURE, lib, { recursive: true });
  const dir = path.join(lib, CANON);
  const dead = 'http://127.0.0.1:9';
  const child = fork(path.join(__dirname, '..', 'canon-worker.js'), [], { env: { ...process.env, HTTPS_PROXY: dead, HTTP_PROXY: dead, https_proxy: dead, http_proxy: dead } });
  let seq = 0;
  const waiting = new Map();
  child.on('message', (m) => { const done = waiting.get(m.id); if (done) { waiting.delete(m.id); done(m); } });
  const request = (msg) => new Promise((resolve) => { const id = ++seq; waiting.set(id, resolve); child.send({ ...msg, id }); });
  const times = [];
  const ask = async (msg) => {
    const r = await request({ type: 'prompt', ...msg });
    if (!r.ok) throw new Error(r.error);
    times.push(r.ms);
    return r.result;
  };
  try {
    const t0 = Date.now();
    const loaded = await request({ type: 'load', chat: model, threads: Math.max(1, os.cpus().length - 2) });
    assert.equal(loaded.ok, true, loaded.error);
    const loadMs = Date.now() - t0;

    const library = JSON.parse(fs.readFileSync(path.join(lib, 'library.json'), 'utf8'));
    const sources = () => library.shelves[0].bookIds.flatMap((bookId) => {
      const meta = JSON.parse(fs.readFileSync(path.join(lib, bookId, 'book.json'), 'utf8'));
      return meta.chapterOrder.map((chId, i) => ({ bookId, chId, book: meta.title, label: meta.format === 'notebook' ? meta.chapterTitles[chId] : 'Ch ' + (i + 1),
        html: fs.readFileSync(path.join(lib, bookId, 'chapters', chId + '.html'), 'utf8') }));
    }).filter((s) => BRAMBLE.includes(s.bookId + '/' + s.chId));
    const io = {
      sources,
      meta: () => JSON.parse(fs.readFileSync(path.join(dir, 'canon.json'), 'utf8')),
      saveMeta: (m) => fs.writeFileSync(path.join(dir, 'canon.json'), JSON.stringify(m, null, 2)),
      entries: () => fs.readdirSync(path.join(dir, 'entries')).filter((f) => f.endsWith('.md')).map((f) => ({ id: f.slice(0, -3), text: fs.readFileSync(path.join(dir, 'entries', f), 'utf8') })),
      saveEntry: (id, text) => fs.writeFileSync(path.join(dir, 'entries', id + '.md'), text),
      notSlips: () => JSON.parse(fs.readFileSync(path.join(dir, 'not-slips.json'), 'utf8')),
      cache: () => null,
      saveCache: () => {},
      knownWords: null
    };
    const reader = Canon.localReader({ id: 'quick', tier: 'quick', ask });
    const t1 = Date.now();
    const summary = await Canon.createEngine({ io, reader }).readShelf();
    const readMs = Date.now() - t1;
    const entries = io.entries().map((x) => Canon.parseEntry(x.text));

    // P0 #6: every fact's every quote is the writer's own words, in its chapter
    const texts = new Map(sources().map((s) => [s.bookId + '/' + s.chId, Canon.sourceParas(s.html).map((p) => p.text).join('\n')]));
    for (const e of entries) for (const f of e.facts) for (const s of f.sources) if (!s.written) assert.ok(texts.get(s.book + '/' + s.ch).includes(s.quote), `${e.name}: "${s.quote}"`);

    const bramble = entries.find((e) => e.id === 'bramble');
    assert.ok(bramble, 'Bramble has an entry');
    assert.ok(bramble.facts.some((f) => f.attr === 'sex' && f.value === 'female' && f.state === 'verified'), 'Bramble is a mare, checked');

    const t2 = Date.now();
    const { slips } = await Canon.createEngine({ io, reader }).check({ bookId: SALT });
    const checkMs = Date.now() - t2;
    assert.ok(slips.some((s) => s.entry === 'bramble' && s.attr === 'sex' && s.span === 'his' && /tossed his head/.test(s.sentence)), 'Bramble tossed his head');

    const facts = entries.flatMap((e) => e.facts.map((f) => `${e.name} · ${f.attr}: ${f.value}${f.as ? ` (${f.as})` : ''} · ${f.state}`));
    console.log(JSON.stringify({ model: path.basename(model), loadMs, readMs, checkMs, calls: times.length, msPerCall: Math.round(times.reduce((a, b) => a + b, 0) / Math.max(1, times.length)), summary, facts, slips: slips.map((s) => `${s.name} · ${s.label} · "${s.span}" in "${s.sentence}"`) }, null, 2));
  } finally {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
