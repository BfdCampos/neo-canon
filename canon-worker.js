// NEO — Canon's reader, in its own process. main.js forks this with
// Electron's utilityProcess (the tests with child_process.fork) and talks to
// it with plain messages, like spell-worker.js:
//   probe  { cpu }                       → { gpu, names, vram } (the hardware, no model)
//   load   { chat: path, threads, cpu }  → { gpu, names, vram }
//   prompt { system, user, schema, maxTokens } → the answer, parsed JSON
//   abort  { id }                        the running prompt stops within a token
//   unload                               lets go of the model
// It knows nothing about books: the prompts come from canon.js. The model is
// node-llama-cpp's, with prebuilt binaries only (it never compiles or fetches).
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
let sequence = null;
const grammars = new Map(); // schema text → grammar
const running = new Map();  // prompt id → AbortController
let queue = Promise.resolve(); // one prompt at a time: there is one sequence
let setup = Promise.resolve(); // probe, load and unload, one at a time

const reply = (msg, extra) => port.postMessage({ id: msg.id, ...extra });

async function unload() {
  for (const x of [context, model]) { try { if (x) await x.dispose(); } catch { /* gone */ } }
  context = model = sequence = null;
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
  const out = { gpu: llama.gpu || false, names, vram, fallback };
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
  context = await model.createContext({ contextSize: msg.ctx || 2048, threads: msg.threads || 0 });
  sequence = context.getSequence();
  return hardware();
}

async function prompt(msg, signal) {
  const { LlamaChatSession } = await import('node-llama-cpp');
  if (!sequence) throw new Error('not loaded');
  const key = JSON.stringify(msg.schema);
  if (!grammars.has(key)) grammars.set(key, await llama.createGrammarForJsonSchema(msg.schema));
  const grammar = grammars.get(key);
  // a fresh conversation on the one sequence: what it shares with the last
  // one (the system prompt) is not evaluated again
  const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt: msg.system, autoDisposeSequence: false });
  try {
    const text = await session.prompt(msg.user, { grammar, maxTokens: msg.maxTokens || 256, temperature: 0, signal });
    return grammar.parse(text);
  } finally {
    session.dispose({ disposeSequence: false });
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
    const t0 = Date.now();
    queue = queue.then(() => c.signal.aborted ? Promise.reject(new Error('aborted')) : prompt(msg, c.signal))
      .then((result) => reply(msg, { ok: true, result, ms: Date.now() - t0 }),
        (err) => reply(msg, { ok: false, error: c.signal.aborted ? 'aborted' : String(err && err.message || err) }))
      .finally(() => running.delete(msg.id));
    return;
  }
  // (one at a time: a probe and a load must not start the hardware twice)
  const work = setup = setup.catch(() => {}).then(() => msg.type === 'load' ? load(msg) : msg.type === 'probe' ? getHardware(!!msg.cpu).then(hardware) : msg.type === 'unload' ? unload() : Promise.reject(new Error('unknown message')));
  work.then((result) => reply(msg, { ok: true, result }), (err) => reply(msg, { ok: false, error: String(err && err.message || err) }));
});
