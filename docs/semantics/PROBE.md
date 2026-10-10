# Local model probe (node-llama-cpp 3.22.1, Linux 4-core CPU VM, no GPU)

- Install: `npm i node-llama-cpp` prebuilt, no compile. ESM-only → `await import()` from CJS. Ship only CPU/Metal/Vulkan variants (exclude ~540 MB CUDA via electron-builder `files`); `asarUnpack` node-llama-cpp + @node-llama-cpp. Run inference in a `utilityProcess` (like spell-worker.js).
- Download: `createModelDownloader({modelUri:'hf:Qwen/Qwen2.5-1.5B-Instruct-GGUF:Q4_K_M', dirPath, showCliProgress:false, onProgress:({totalSize,downloadedSize})=>{}})` then `d.download({signal})`. Aborted download resolved silently with empty dir and restarted at 0% (resume unconfirmed).
- Extraction: `llama.createGrammarForJsonSchema(schema)`; `LlamaChatSession({contextSequence: ctx.getSequence()})`; `s.prompt(p,{grammar,maxTokens,temperature:0})`; must `s.dispose({disposeSequence:true})` or "No sequences left". `grammar.parse(r)`.
  - Qwen2.5-1.5B Q4: ~12 tok/s, ~48 s/call; dupes, "species: grey mare" mistake.
  - Qwen3-4B-Instruct-2507 Q4 (2.5 GB, Apache-2.0): ~5 tok/s, ~98 s/280 tok; best quality but did not resolve "the old horse" to Bramble, missed sex:female.
  - Qwen2.5-3B: research licence — avoid.
  - CPU here is slow; real laptops 2–5× faster. Expect 10–100 s/paragraph here.
- Embeddings: `hf:nomic-ai/nomic-embed-text-v1.5-GGUF:Q4_K_M` 84 MB, 768 dims, 30–80 ms/text, use `search_query:`/`search_document:` prefixes.
- Models cached at /tmp/claude-0/llama-probe/models/ (hf_Qwen_Qwen2.5-1.5B-Instruct.Q4_K_M.gguf, hf_unsloth_Qwen3-4B-Instruct-2507.Q4_K_M.gguf, hf_nomic-ai_nomic-embed-text-v1.5.Q4_K_M.gguf). Scripts: /tmp/claude-0/llama-probe/{dl,t}.mjs
