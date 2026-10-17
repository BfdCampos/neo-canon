// NEO — Canon's reader, in its own process. main.js forks this with
// Electron's utilityProcess (the tests with child_process.fork) and talks to
// it with plain messages, like spell-worker.js:
//   probe  { cpu }                       → { gpu, names, vram } (the hardware, no model)
//   load   { chat: path, threads, cpu, ctx, sequences, thoughts }
//                                        → { gpu, names, vram, sequences, ctx }
//   prompt { system, user, schema, maxTokens } → the answer, parsed JSON
//   abort  { id }                        the running prompt stops within a token
//   unload                               lets go of the model
// It knows nothing about books: the prompts come from canon.js. The model is
// node-llama-cpp's, with prebuilt binaries only (it never compiles or fetches).
//
// `sequences` (docs/semantics/READING.md §5): the context holds that many
// sequences and each prompt takes a free one, so on a graphics card several
// prompts are evaluated in one batch. On the processor it is 1: parallel
// sequences only split the same cores. A sequence keeps what it last read,
// so a prompt that starts the way the last one on it did (the system prompt,
// a passage asked about twice) is not evaluated again.
// `thoughts: 'discourage'`: Qwen3's hybrid models (the Thorough and Deep
// readers) answer without a thinking block; the grammar leaves no room for one.
'use strict';

const port = process.parentPort || {
  on: (_ev, fn) => process.on('message', (data) => fn({ data })),
  postMessage: (m) => process.send(m)
};

let llama = null;
let llamaWant = null; // 'auto' or false (CPU only)
let fallback = null;   // why the GPU wasn't used, for main's log
let model = null;
let context = null;
let wrapper = null;    // the chat wrapper, when the model needs one set
let free = [];         // sequences not answering a prompt
const waiting = [];    // prompts waiting for a sequence
const grammars = new Map(); // schema text → grammar
const running = new Map();  // prompt id → AbortController
let setup = Promise.resolve(); // probe, load and unload, one at a time

const reply = (msg, extra) => port.postMessage({ id: msg.id, ...extra });

async function unload() {
  for (const x of [context, model]) { try { if (x) await x.dispose(); } catch { /* gone */ } }
  context = model = wrapper = null;
  free = [];
  grammars.clear();
}

// The best hardware there is, found by node-llama-cpp: Metal on Apple
// silicon, CUDA or Vulkan elsewhere, else the processor. `cpu` (Reader
// settings → Hardware: CPU only) skips the graphics card. A GPU that won't
// start, or a model that won't fit on it, falls back to the processor.
async function getHardware(cpu) {
  const { getLlama } = await import('node-llama-cpp');
  const want = cpu ? false : 'auto';
  if (llama && llamaWant === want) return llama;
  await unload();
  llama = null;
  try {
    llama = await getLlama({ build: 'never', gpu: want, logLevel: 'error' });
  } catch (err) {
    if (want === false) throw err;
    fallback = 'GPU: ' + (err && err.message || err);
    llama = await getLlama({ build: 'never', gpu: false, logLevel: 'error' });
  }
  llamaWant = want;
  return llama;
}
async function hardware() {
  let names = [];
  let vram = 0;
  try { if (llama.gpu) names = await llama.getGpuDeviceNames(); } catch { /* unnamed */ }
  try { if (llama.gpu) vram = (await llama.getVramState()).total || 0; } catch { /* unknown */ }
  const out = { gpu: llama.gpu || false, names, vram, fallback, sequences: free.length, ctx: context ? context.contextSize : 0 };
  fallback = null;
  return out;
}

async function load(msg) {
  await getHardware(!!msg.cpu);
  await unload();
  try {
    model = await llama.loadModel({ modelPath: msg.chat, gpuLayers: 'auto' });
  } catch (err) {
    if (!llama.gpu) throw err;
    fallback = 'model on the GPU: ' + (err && err.message || err);
    await getHardware(true);
    model = await llama.loadModel({ modelPath: msg.chat });
  }
  // parallel sequences only on a graphics card; one on the processor
  const n = llama.gpu ? Math.max(1, Math.min(8, msg.sequences || 1)) : 1;
  const opts = { contextSize: msg.ctx || 2048, threads: msg.threads || 0, sequences: n };
  try {
    context = await model.createContext(opts);
  } catch (err) {
    // no room for every sequence: as many as fit, down to one
    if (n === 1) throw err;
    context = await model.createContext({ ...opts, sequences: 1 });
  }
  free = [];
  for (let i = 0; i < context.totalSequences; i++) free.push(context.getSequence());
  if (msg.thoughts === 'discourage') {
    const { QwenChatWrapper } = await import('node-llama-cpp');
    wrapper = new QwenChatWrapper({ thoughts: 'discourage' });
  }
  return hardware();
}

// a sequence for one prompt: a free one, or the next to come free
const take = () => free.length ? Promise.resolve(free.pop()) : new Promise((resolve) => waiting.push(resolve));
const give = (seq) => { const next = waiting.shift(); if (next) next(seq); else free.push(seq); };

// `compact`: JSON on one line, no indenting (an answer of 25 facts is a
// third shorter). node-llama-cpp builds that grammar but doesn't export the
// switch, so its own builder is loaded from its files; if that ever fails,
// the ordinary grammar (newlines allowed) does the same job, more slowly.
let compactBuilder;
async function compactGrammar(schema) {
  if (compactBuilder === undefined) {
    try {
      const { pathToFileURL } = require('node:url');
      const path = require('node:path');
      const file = path.join(path.dirname(require.resolve('node-llama-cpp')), 'utils', 'gbnfJson', 'getGbnfGrammarForGbnfJsonSchema.js');
      compactBuilder = (await import(pathToFileURL(file).href)).getGbnfGrammarForGbnfJsonSchema;
    } catch { compactBuilder = null; }
  }
  if (!compactBuilder) return llama.createGrammarForJsonSchema(schema);
  const grammar = await llama.createGrammar({ grammar: compactBuilder(schema, { allowNewLines: false }), stopGenerationTriggers: ['\n\n'], trimWhitespaceSuffix: true });
  return { compact: grammar, parse: (text) => JSON.parse(text) };
}

async function prompt(msg, signal) {
  const { LlamaChatSession } = await import('node-llama-cpp');
  if (!context) throw new Error('not loaded');
  const key = (msg.compact ? 'c' : '') + JSON.stringify(msg.schema);
  if (!grammars.has(key)) grammars.set(key, msg.compact ? compactGrammar(msg.schema) : llama.createGrammarForJsonSchema(msg.schema));
  const made = await grammars.get(key);
  // (a compact grammar comes with its own parse)
  const grammar = made.compact || made;
  const sequence = await take();
  const t0 = Date.now();
  try {
    if (signal.aborted) throw new Error('aborted');
    // a fresh conversation on the sequence: what it shares with the last
    // one (the system prompt) is not evaluated again
    const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt: msg.system, autoDisposeSequence: false, ...(wrapper ? { chatWrapper: wrapper } : {}) });
    try {
      const text = await session.prompt(msg.user, { grammar, maxTokens: msg.maxTokens || 256, temperature: 0, signal });
      return { result: made.compact ? made.parse(text) : grammar.parse(text), ms: Date.now() - t0 };
    } finally {
      session.dispose({ disposeSequence: false });
    }
  } finally {
    give(sequence);
  }
}

port.on('message', (e) => {
  const msg = e.data || {};
  if (msg.type === 'abort') {
    const c = running.get(msg.target);
    if (c) c.abort();
    reply(msg, { ok: true });
    return;
  }
  if (msg.type === 'prompt') {
    const c = new AbortController();
    running.set(msg.id, c);
    // (after a load that is still under way); `ms` is the model's own time
    setup.catch(() => {}).then(() => c.signal.aborted ? Promise.reject(new Error('aborted')) : prompt(msg, c.signal))
      .then(({ result, ms }) => reply(msg, { ok: true, result, ms }),
        (err) => reply(msg, { ok: false, error: c.signal.aborted ? 'aborted' : String(err && err.message || err) }))
      .finally(() => running.delete(msg.id));
    return;
  }
  // (one at a time: a probe and a load must not start the hardware twice)
  const work = setup = setup.catch(() => {}).then(() => msg.type === 'load' ? load(msg) : msg.type === 'probe' ? getHardware(!!msg.cpu).then(hardware) : msg.type === 'unload' ? unload() : Promise.reject(new Error('unknown message')));
  work.then((result) => reply(msg, { ok: true, result }), (err) => reply(msg, { ok: false, error: String(err && err.message || err) }));
});
