// NEO — Canon's reader, in its own process. main.js forks this with
// Electron's utilityProcess (the tests with child_process.fork) and talks to
// it with plain messages, like spell-worker.js:
//   load   { chat: path, threads }       → { gpu }
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
let model = null;
let context = null;
let sequence = null;
const grammars = new Map(); // schema text → grammar
const running = new Map();  // prompt id → AbortController
let queue = Promise.resolve(); // one prompt at a time: there is one sequence

const reply = (msg, extra) => port.postMessage({ id: msg.id, ...extra });

async function unload() {
  for (const x of [context, model]) { try { if (x) await x.dispose(); } catch { /* gone */ } }
  context = model = sequence = null;
  grammars.clear();
}

async function load(msg) {
  const { getLlama } = await import('node-llama-cpp');
  if (!llama) llama = await getLlama({ build: 'never', gpu: process.platform === 'darwin' ? 'auto' : false, logLevel: 'error' });
  await unload();
  model = await llama.loadModel({ modelPath: msg.chat });
  context = await model.createContext({ contextSize: msg.ctx || 2048, threads: msg.threads || 0 });
  sequence = context.getSequence();
  return { gpu: llama.gpu };
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
  const work = msg.type === 'load' ? load(msg) : msg.type === 'unload' ? unload() : Promise.reject(new Error('unknown message'));
  work.then((result) => reply(msg, { ok: true, result }), (err) => reply(msg, { ok: false, error: String(err && err.message || err) }));
});
