# Canon — architecture

Engineering plan for the `semantics` fork. [PRODUCT.md](PRODUCT.md) is the source of truth for behaviour; [PROBE.md](PROBE.md) holds the measured facts about local models. Where this plan cuts something from the spec, it says so in §8.

The one principle everything below follows: **the reader proposes, code decides.** A small model on a CPU is slow and makes things up, so the model is used only where language understanding is unavoidable (spotting candidate facts, confirming who a pronoun means). Quote checks, merging, the fact vocabulary, slip detection, substitutions, incremental reading and every write are plain deterministic code in one file that `node:test` can run without a model.

---

## 1. Files

| File | New? | Role | Size (est.) |
|---|---|---|---|
| `canon.js` | new | All Canon logic, no I/O of its own: text and HTML utilities, the fact vocabulary and lexicons, quote gate, merge, entry Markdown parse/serialise, slip checkers, substitutions, and the engine (`createEngine({ io, reader })`) that runs the pipelines. Loaded by `main.js` (`require`) and by the window (`<script src="canon.js">`, `window.Canon`), the same dual shape as `i18n.js`. No writer-visible strings: it returns codes, `app.js` turns them into `t()` text. | ~1,000 |
| `canon-worker.js` | new | `utilityProcess` running node-llama-cpp: loads the models, runs grammar-constrained prompts and embeddings, honours abort. Knows nothing about books. | ~150 |
| `main.js` | edit | A CANON block beside the spellcheck block: worker wiring (copy of `spellRequest`/`startSpellProcess`), the `io` adapter over `libName`/`writeFileDurable`/`writeJSON`/`readJSON`, `canon:*` handlers, the reader downloader, two Edit menu items, `canon-` in the backup filter. | +~350 |
| `preload.js` | edit | ~20 `canon*` methods and `onCanon(cb)`. | +~25 |
| `app.js` | edit | One `/*  CANON  */` section: the tab, entry page, Needs You, setup page, slip marks and popover, Continuity Pass toggle, quiet-pause timer, change-across-series review. Plus small hooks in BOOKSHELF (shelf menu, notebook), TABS (`switchTab`), SNAPSHOTS (snapshot a book that is not open). | +~1,200 |
| `index.html` | edit | One tab `<div data-tab="canon">`, one `<script src="canon.js">` before `app.js`, one `#canon-view` container. | +~10 |
| `styles.css` | edit | Entry page, `::highlight(neo-slip)` muted-gold dotted underline, notebook tile, setup page. | +~150 |
| `package.json` | edit | `node-llama-cpp` pinned exactly (3.22.1), `asarUnpack`, CUDA excluded (§5.4). | — |

No other new runtime files. Pocket: `scripts/pocket-www.js` does not copy `canon.js`; the CANON section of `app.js` checks `window.neo.canonOpen && window.Canon` once and stays inert without them (no tab, no menu handling), so Pocket shows no Canon and never touches `canon-*` folders.

### Reused NEO machinery

- `libName()` for every canon id, entry slug and member book id; `writeFileDurable` for `.md` files, `writeJSON`/`readJSON` (with `.bak`/`.tmp` recovery) for `canon.json` and `not-slips.json`.
- CSS Highlight API (`CSS.highlights.set('neo-slip', …)`) as spellcheck (`neo-spell`) and find (`neo-search`) do. `captureBody` needs no change, since nothing is put into the DOM.
- The spellcheck pass's toggle/lazy-scan shape (`spellOn`, `spellScanned`, `spellElFor`) for the Continuity Pass; `window.neo.spellCheckWords` to tell a misspelt name from a real word.
- `#side-pane` (Find's right-hand pane) for pass results, Needs You and Review Changes; `#nav-pane` for the entry list; `popMenu` for right-click menus; `snapshotStructure` and `takeSnapshot('r', …)` before applying changes.
- `textHash` (SNAPSHOTS): `canon.js` carries a copy of the same 53-bit hash (8 lines) so it runs in `main.js` without `app.js`; a test asserts the two agree.
- `t()`/`tk()` and `node scripts/i18n.js template` for all copy.

---

## 2. On disk

### 2.1 Library (synced, plain files)

```
NEO Library/
  library.json                       shelf gains "canonId": "canon-the-ashfall-road-shelf-3"
  canon-<slug>-<shelfId>/
    canon.json
    not-slips.json
    entries/<entry-slug>.md
    set-aside/<entry-slug>.md          whole entries set aside or merged away
```

`canon.json` (written only when one of its fields changes, never on a timer):

```json
{
  "v": 1,
  "shelfId": "shelf-3",
  "reader": { "id": "qwen3-4b-2507-q4km", "prompt": 1 },
  "read": { "book-ember-and-thorn-k3/c7": "1a2b3c4d5e6f7", "book-field-notes-n9/notes": "…" },
  "out": { "book-field-notes-n9": ["p3"], "book-the-salt-crown-s2": ["notes"] },
  "settings": {}
}
```

- `read` is the `textHash` of each source last read. It is synced on purpose: a second device that sees the same hash skips the chapter instead of reading it again. Key `<bookId>/<chId>`, or `<bookId>/notes` for a Notes tab.
- `out` is **Leave Out of Canon** (page ids, or `"notes"`). It lives here, not in `book.json`, so opting out of Canon leaves books untouched.
- Member books are not stored: they are the shelf's `bookIds` in `library.json` at read time, in shelf order (= reading order).

`not-slips.json`:

```json
[{ "fact": "bramble/sex", "sentence": "9f8e…", "span": "brown", "text": "Ilsa's eyes looked almost brown in the firelight.", "at": "2026-10-10T12:00:00Z" }]
```

`sentence` is `textHash(norm(sentence))`; `text` (first 120 chars) feeds the **Dismissed** list only. A slip is suppressed when `fact` and `sentence` both match. Editing the sentence changes the hash and the slip returns.

### 2.2 Entry file

The §3 shape from PRODUCT.md, with the syntax pinned down so the parser is small and a hand edit always round-trips:

```markdown
---
id: bramble
name: Bramble
kind: creature
aliases: [the grey mare, the grey]
---
# Bramble

## Facts
- Species: horse · verified
  - Ember and Thorn, Ch 2: "Bramble, the grey mare, would not cross the ford." {book:book-ember-and-thorn-k3, ch:c7}
- Sex: female (mare) · yours
  - Field Notes, Horses: "Bramble — mare, eleven, bad-tempered with strangers." {book:book-field-notes-n9, ch:p1}
  - Written in Canon
- Sibling: Oren Hale (younger) · verified
  - Ember and Thorn, Ch 1: "Oren's younger sister" {book:book-ember-and-thorn-k3, ch:c1}
- Owner: Tamsin Hale · unverified
  - Ember and Thorn, Ch 4: "Tamsin led her own horse, Bramble, up the bank." {book:book-ember-and-thorn-k3, ch:c9, changed}

## Set aside
- Sex: male (gelding) · not right
  - The Salt Crown, Ch 2: "That's no mare, that's a gelding, I'd swear it" {book:book-the-salt-crown-s2, ch:c2, said:the horse-trader}

## In my words
Bad-tempered with strangers. Bites.
```

Grammar (one line = one thing; the parser is ~80 lines):

- Front matter: `id`, `name`, `kind` (`person|creature|place|thing|group|other`), `aliases` as a flow list. Unknown keys are kept and written back.
- Fact line: `- <Label>: <value>[ (<as written>)] · <state>`. Labels are the closed vocabulary below, in English in the file (stable across interface languages; the tab shows `tk(label)`). An unknown label is kept as an `other` fact: shown, never raises slips.
- States: `verified`, `unverified`, `yours`, `disagree`; in *Set aside*: `set aside`, `not right` (the extractor never re-proposes that attribute/value from that quote).
- Source line: `- <Book title>, <Ch n | Notes | page title>: "<quote ≤ 30 words>" {book:<id>, ch:<id|notes>[, said:<speaker>][, plan][, changed]}`, or `- Written in Canon`. The human label is regenerated on write; the `{…}` anchor is what code reads. `said` = sourced only from dialogue (never raises slips); `plan` = a question, "what if", "maybe" (stored at most *unverified*); `changed` = the quote is no longer in that chapter.
- A fact with two or more values is several lines with the same label and state `disagree`.
- `## In my words` and everything after it is kept byte for byte.
- A file that fails to parse is left exactly as it is, listed with "Canon couldn't read this entry. It's left as it was." and never written by Canon until it parses.

Fact key: `<entryId>/<attr>` for single-valued attributes, `<entryId>/<attr>/<valueSlug>` for relations (`tamsin-hale/sibling/oren-hale`).

**Vocabulary** (`ATTRS` in `canon.js`), with what may raise slips in the MVP:

| attr | Label | Values | Slips |
|---|---|---|---|
| `sex` | Sex | female / male (+ as written: mare, stallion, woman…) | yes |
| `species` | Species | open noun, normalised by lexicon (horse, wolf, human) | yes |
| `eyes` / `hair` | Eyes / Hair | closed colour list (grey/gray, brown, green, blue, black, red, fair/blond, white, hazel, amber) | yes |
| `birthplace` | Born in | entry name | yes |
| `sibling`, `parent`, `child`, `spouse` | Sibling, Parent of, Child of, Married to | entry name (+ `younger`/`elder`/`twin` for sibling) | yes |
| `name` | (the entry name and aliases) | — | spelling only |
| `owner`, `home`, `title`, `state`, `other` | Owner, Lives in, Title, State, Other | free | no (recorded) |

Lexicons live beside it: `SEX_WORDS` (mare/stallion/gelding/colt/filly/woman/man/girl/boy/sister/brother/queen/king/…, with each word's sex and its swap: `mare↔stallion`), `PRONOUNS` (she/her/hers/herself ↔ he/him/his/himself; `her` swaps to `his` or `him`), `FEMALE_ONLY` (in foal, pregnant, mother of: listed, never swapped), colours, kin words (`younger↔elder|older`, `sister↔brother`, `daughter↔son`). English only in the MVP; other languages are "Early" (PRODUCT §6 stage 2).

### 2.3 Cache (this device only, rebuildable)

`userData/canon-cache/<canonId>/index.json` — deleting it costs only a re-read (P1 #21: entries are never rewritten by a cache rebuild, since an entry is written only when its serialised text differs).

```json
{
  "v": 1, "reader": "qwen3-4b-2507-q4km", "prompt": 1,
  "proposals": { "<ctxHash>": [{ "entity": "Bramble", "kind": "creature", "attr": "sex", "value": "mare", "quote": "Bramble, the grey mare" }] },
  "judged":    { "<factKey>|<quoteHash>": "yes" },
  "sources":   { "book-…/c7": { "hash": "…", "paras": ["<paraHash>", "…"] } },
  "mentions":  { "bramble": [["book-…", "c7", "<paraHash>"]] },
  "checked":   { "book-…/c7": ["<paraHash>", "…"] }
}
```

- `ctxHash` = `textHash(prompt version + reader id + previous paragraph + paragraph)`: a paragraph is re-proposed only when it or the one before it changed.
- `mentions` (entry → paragraphs naming it or an alias) is rebuilt deterministically on every read; it powers "4 more" and change-across-series.
- Embeddings, when M11 lands: `vectors.f32` + `vectors.json` (paragraph hash → row) in the same folder.

`userData/models/` holds weights (§5). Nothing Canon writes to the library is larger than a few KB per entry (P0 #4).

---

## 3. IPC

### 3.1 Window ↔ main (`canon:*`, all `ipcMain.handle` unless marked *send*)

| Channel | Args | Returns |
|---|---|---|
| `canon:create` | `shelfId, shelfName` | `canonId`. Reuses an existing `canon-*-<shelfId>` folder (Keep a Canon again). The window then sets `shelf.canonId` and writes `library.json` as usual. |
| `canon:open` | `canonId` | `{ meta, entries:[{ id, file, stamp, data \| error }], notSlips, setAside:[…], reader: status }`. Starts the engine for that Canon. |
| `canon:refresh` | `canonId` | `{ changed:[entry…], removed:[id…] }` — entry files whose `mtimeMs:size` stamp moved (hand edits, other device). Called from the window's focus refresh. |
| `canon:saveEntry` | `canonId, entry, stamp` | `{ ok, stamp }` or `{ conflict, entry }` when the file changed since `stamp` (re-read, window re-applies its edit). |
| `canon:setAside` / `canon:restore` | `canonId, entryId` | `true` — moves the file between `entries/` and `set-aside/`. |
| `canon:merge` | `canonId, fromId, intoId` | merged entry; `from` goes to `set-aside/`. |
| `canon:saveMeta` | `canonId, patch` | `true` (`out`, `settings`). |
| `canon:notSlip` / `canon:unNotSlip` | `canonId, record` | `true` |
| `canon:readShelf` | `canonId, { again }` | `{ entries, facts, verified, needs }` when finished; progress arrives on the event channel. `again` = Read Everything Again (ignores `read` hashes and cache; *yours* facts untouched, P1 #17). |
| `canon:check` | `{ canonId, bookId, scope: 'book'\|'shelf'\|{chId, paras?}, mode: 'pass'\|'quiet', skip }` | `{ slips }`, streamed per chapter as `slips` events. `skip` = the caret paragraph's text when it lacks end punctuation. |
| `canon:changeFact` | `{ canonId, entryId, attr, value }` | `{ passages:[{ bookId, chId, sentence, span, to \| null, why }] }`. Writes the new *yours* fact and sets the old one aside first. |
| `canon:stop` | — | `true` — cancels the running read/check (abort reaches the worker). |
| `canon:typing` | *send*, throttled to 1 per 500 ms | — main pauses the reader (§4.3). |
| `canon:readerStatus` | — | `{ installed: tierId \| null, recommend, catalogue, download: { state, got, total, tier } }` |
| `canon:download` / `canon:pauseDownload` / `canon:removeReader` | `tierId` | `true` |

Events: main → window `webContents.send('canon', msg)`, preload `onCanon(cb)`. `msg.type` ∈ `progress {phase:'read'|'check', book, ch, n, of, eta}`, `slips {bookId, chId, slips}`, `entries {changed}`, `download {state, got, total}`, `done`, `error {code}`.

Orchestration lives in **main** (it can read every member book's chapters without the window opening them, and owns the single write queue); deterministic work there is cheap (a 100k-word check is well under 100 ms of string work). Writes to chapters stay in the window (§4.4).

### 3.2 Main ↔ `canon-worker.js`

Same shape as `spell-worker.js`: `{ id, type, … }` in, `{ id, ok, result | error, ms, tokens }` out.

| type | Payload | Result |
|---|---|---|
| `load` | `{ chat: path, embed: path \| null, threads, ctx: 4096 }` | `{ gpu, vramFree }`. `getLlama({ build: 'never' })` — never compiles, never fetches. |
| `prompt` | `{ system, user, schema, maxTokens, temperature: 0 }` | parsed JSON (grammar from `createGrammarForJsonSchema`, cached per schema). Session disposed with `{ disposeSequence: true }` after every call. |
| `embed` | `{ texts, kind: 'query' \| 'document' }` | `number[][]` (prefixes `search_query:`/`search_document:` added here) |
| `abort` | `{ id }` | the running `prompt` rejects with `aborted` within one token (AbortController + `stopOnAbortSignal`) |
| `unload` | — | frees the models |

Main forks it with `serviceName: 'NEO reader'`, then `os.setPriority(child.pid, 19)` so the writing room wins the CPU, and `threads = max(1, cores − 2)`.

### 3.3 The reader interface (`canon.js`)

```js
reader = {
  id,                                    // goes into cache keys and canon.json
  propose({ text, before, known }),      // → [{ entity, kind, attr, value, asWritten, quote }]
  judge({ claim, quote, paragraph }),    // → 'yes' | 'no' | 'unclear'
  refers({ sentence, span, entity, paragraph }),  // → 'yes' | 'no' | 'unclear'
  pick({ sentence, span, options }),     // → one of options (her → his | him), or null
  embed(texts, kind),                    // optional
  abort()
}
```

Three implementations, all ~40–80 lines: `localReader(request)` (prompts + schemas → worker), `fakeReader(answers)` (tests, §6), and in stage 2 `httpReader({ kind: 'ollama' | 'openai' | 'anthropic', key })` in `main.js` (keys in `secrets.json` via the existing `secret:set`). Prompts and JSON schemas live in `canon.js` so every reader gets the same ones; the engine never knows which reader it has.

---

## 4. Pipelines

### 4.0 Shared text model (`canon.js`)

- `sourceParas(html)` → `[{ text, hash }]`: a regex walk of NEO's flat `<p>` HTML (no DOM needed in main), dropping `p.scene-break`, `p.ghost`, `.ph-mark` spans and tags, decoding entities. The window uses the same function on `chapterHTML`, so main and window agree on paragraph text.
- `norm(s)`: NFKC, curly → straight quotes, dashes → `-`, ellipsis → `...`, whitespace collapsed, lower-cased. Used for every comparison and hash; never for display.
- `sentences(text)` → `[{ text, start, end, speech: [[a,b]…] }]`: splitter aware of `Mr.`/`Capt.`/initials; `speech` = spans inside quotation marks (all `QUOTE_STYLES` pairs, plus em-dash dialogue lines).
- `mentions(text, entries)` → `[{ entryId, start, end, via: name|alias|surname }]`, longest match first; a bare surname or title form ("Captain Varr") counts only when exactly one *person* entry carries it.

### 4.1 Read the Shelf (and every later incremental read)

```
readShelf(canon, { again }):
  sources = for book in shelf order: book chapters, then notes.html; notebooks: pages
            minus canon.out, minus Darlings/stickies/outline/snapshots (never listed)
  for src in sources:
    html = io.readChapter(src);  h = textHash(html)
    if !again && canon.read[src] == h: continue
    paras = sourceParas(html)
    for (p, i) in paras:
      if !cueful(p, known): continue                     # §8 cut 1: no cue, no call
      key = ctxHash(paras[i-1], p)
      props = cache.proposals[key] ?? await reader.propose({ text: p.text, before: paras[i-1]?.text,
                                                             known: entriesNamedIn(p, i-1) })
      cache.proposals[key] = props
      for f in props:
        q = gateQuote(f.quote, html)                     # norm(quote) ⊂ norm(sourceText), ≤ 30 words,
        if !q: continue                                  #   else discarded (P0 #7)
        if !valueInQuote(f) || !entityInReach(f, p): continue   # value word or lexicon synonym in quote;
                                                         #   entity name/alias in quote or same paragraph
        f.said = inSpeech(q, p);  f.plan = isPlan(q)     # '?', what if, maybe, perhaps
        if matchesSetAside(f): continue                  # "Not right" remembered
        candidates.push(normaliseValue(f))               # mare → female (mare); "grey of wet slate" → grey
    canon.read[src] = h
    yield progress
  merge(candidates) into entries:                        # by norm(name) / alias / unique surname; else new entry
    same attr+value → add source (dedupe by quote);  different value → state 'disagree'
    never touch 'yours' facts; a 'yours' value that disagrees → keep yours, list the other under Needs You
  checking(newFacts):
    if ruleSupported(f): verified                        # §8 cut 2: closed lexicon word + entity name in the
                                                         #   same quote, not speech, not plan
    else: ans = cache.judged[k] ?? await reader.judge(...)  →  yes: verified | else unverified
    plan or said → never above unverified / never slips
  sourcesChanged(): every source quote not found in its chapter → {changed}, fact → unverified (P1 #19)
  rebuild mentions; write each entry whose serialised text changed (writeFileDurable); write canon.json once
```

`cueful(p)`: the paragraph names a known entry or a capitalised non-initial word not in the dictionary, or holds a lexicon word (sex, colour + eyes/hair, kin, species, *born*). Everything else costs no model call.

`propose` prompt: a short system prompt with the vocabulary, the known entries named nearby (so "the old horse" can be tied to Bramble), and a JSON schema with `attr` as an enum and `quote` as a string; `maxTokens: 300`; output is compact (`[{e,k,a,v,q}]`).

Progress: phase `read` then `check`; `eta` = remaining cueful paragraphs × the mean of the last 10 calls (copy says "about N minutes" only after three calls have been timed).

### 4.2 Continuity Pass (deterministic first)

```
check(sources, mode):
  facts = entries' facts with state verified|yours, not said, not plan, attr in SLIP_ATTRS
  for src in sources: for p in sourceParas(src) (skip p.text == skip): for s in sentences(p):
    if s overlaps a speech span only → skip the speech part
    for c in candidates(s, p, prevSentence, facts):
      if notSlips has (c.fact, hash(s)): continue
      if c.strength == 'weak':
         if !reader: continue                    # no reader → only strong slips (§8 cut 4)
         if await reader.refers(...) != 'yes': continue
      c.proposal = swap(c)                       # mare→stallion, he→she; her→his|him via reader.pick, else null
      gateSpan(c)                                # span text must occur verbatim in s
      out.push(c)
```

Checkers (each ~30–60 lines, each with its own tests):

| Check | Strong when | Weak when (needs `refers`) |
|---|---|---|
| **Pronoun sex** | the sentence names exactly one sexed entry E, E precedes the pronoun, no other entry or capitalised name in the clause | the pronoun opens a sentence and the previous sentence names exactly one sexed entry |
| **Sex noun** (`the stallion`) | — | no entry is named in the sentence; the most recent entry of that species in the last 3 sentences of the paragraph is E with the other sex, and no entry with the noun's sex was named in that window |
| **Colour** (`brown eyes`) | `E's <colour> eyes|hair` or E sole named entry and `<colour> eyes` in the sentence | — |
| **Kin** (`the elder of the two Hales`) | — | sentence names E (or E's surname uniquely in an appositive) with the antonym kin word |
| **Species / birthplace** | `E, the <species-noun>`; `E was born in <place entry>` | — |
| **Name spelling** | capitalised token, not an entry name or alias, Damerau distance ≤ 1 (≤ 2 for names ≥ 8 letters) to one, unknown to the spell dictionary (`spell:check`) | — |

Decoys fall out of the rules: "Rook shook his mane" names Rook only; the horse-trader is in speech; "a mare's flank" names no entry; the Maybe page is in `out`; Oren's hand is a `state` (no slips); the firelight line is in `not-slips.json`.

Window side: `canonPassOn` mirrors `spellOn`. Results become Ranges by finding the paragraph whose `textHash(norm(text))` matches, then the sentence, then the span inside it (anchored by text, like sources, so stale offsets cannot mark the wrong word). One `Highlight` per Canon (`neo-slip`), rebuilt per chapter. Popover: an absolutely placed element opened on hover, right-click or ⌥Enter, never from the caret. **Keep** selects the span and `document.execCommand('insertText', false, to)`, which is the browser's own undo step (⌘Z). **Not a slip** → `canonNotSlip`.

### 4.3 Quiet checking on a pause

Window:

```
on keydown in the editor: lastKeyAt = now; clear marks in the caret's paragraph;
                          canonTyping() (throttled); clearTimeout(quietT); quietT = setTimeout(quiet, 90_000)
quiet(): if !setting || !reader || document.hidden: return
         flush the 800 ms save debounce for this chapter
         asked = now
         slips = await canonCheck({ scope: { chId }, mode: 'quiet', skip: caretParaIfUnfinished })
         if lastKeyAt > asked: drop slips                 # P0 #8: only while still paused
         else paint
```

Main, for `mode: 'quiet'`: first an incremental read of changed sources (§4.1, usually one chapter), then check only paragraphs whose hash is not in `cache.checked[src]`. One `setTimeout` per pause, reset by typing: no interval timer, and no file is written unless a read changed an entry (P1 #20).

Pausing (also during Read the Shelf): on `canon:typing` main sets `paused`, sends `abort` for the running prompt, and requeues that paragraph; the queue resumes after 10 s without another `canon:typing`. The abort lands within one token (≤ 0.3 s at 5 tok/s), meeting "within a second". The worst cost is one paragraph's work redone. The worker runs at nice 19 with two cores left free (P0 #12).

### 4.4 Changing a fact across the series

```
main  canon:changeFact(E, attr, value):
        old = E.fact(attr); E.setAside(old); E.add({ attr, value, state: 'yours', source: 'Written in Canon' })
        write E
        passages = check(all shelf sources incl. notes and notebooks, facts = [E.fact(attr)])   # same checkers
                   ∪ FEMALE_ONLY/MALE_ONLY phrases naming E          # "in foal" → to: null, why: 'needs-words'
        return passages (each: bookId, chId, sentence, span, to | null)
window: side pane "Review Changes · N passages in M books"
        Apply / Skip / Edit… per item; Apply All Shown appears once the last item has been seen (IntersectionObserver)
        apply(item):
          if first apply in item.book:
             if open book: snapshotStructure(); takeSnapshot('r')
             else:         takeSnapshot('r', htmlOf = disk text, meta = that book)   # small refactor, §1
          if open book and chapter on screen: select span in the DOM; execCommand('insertText')  (⌘Z)
          else: html = readChapter / readAux; html2 = Canon.replaceInHtml(html, sentence, span, to)
                if html2 == null → "Needs your words — open the passage"     # span crosses a tag
                writeChapter(bookId, chId, html2, stamp)   # existing write path; only changed chapters
        finish: "6 passages changed, 1 skipped. Bramble is a stallion."
```

`replaceInHtml` maps text offsets onto text nodes of the HTML string and replaces only inside a single text node, after confirming the sentence is still there. Snapshots hold the bytes read from disk, so Restore returns each chapter byte-identical (P0 #11).

### 4.5 Hand edits

- In the tab: the window edits a parsed entry with `canon.js` helpers (add fact → *yours* with `Written in Canon`; That's right → *yours*; Not right / Set Aside → *Set aside*; rename; aliases) and calls `canonSaveEntry(entry, stamp)`. Main serialises, compares with the file, writes only if different, and updates its in-memory copy. Hand-made facts are never rewritten by reads (P1 #17).
- In a text editor: on focus (the same moment `refreshFromDisk` runs) the window calls `canonRefresh`; main re-reads entries whose stamp moved. A conflicting `saveEntry` returns the disk version and the window re-applies its one change on top. An entry is only ever written in response to an action or a read that changed it, so two idle devices never write (P2 #26).
- Round-trip law, tested on every fixture entry: `serialise(parse(text)) === text` for canonical text, and `parse(serialise(e))` deep-equals `e`.

---

## 5. The reader: models, download, packaging

### 5.1 Catalogue (`READERS` in `main.js`)

| Tier | Writer sees | File | Size | Licence |
|---|---|---|---|---|
| `careful` | Careful reader | `unsloth/Qwen3-4B-Instruct-2507-GGUF` · `Qwen3-4B-Instruct-2507-Q4_K_M.gguf` | 2.5 GB | Apache-2.0 |
| `quick` | Quick reader | `Qwen/Qwen2.5-1.5B-Instruct-GGUF` · `qwen2.5-1.5b-instruct-q4_k_m.gguf` | 1.1 GB | Apache-2.0 |
| (always) | — | `nomic-ai/nomic-embed-text-v1.5-GGUF` · `nomic-embed-text-v1.5.Q4_K_M.gguf` | 84 MB | Apache-2.0 |

Each row pins `resolve/<commit sha>/<file>`, byte size and sha256 (Hugging Face shows the LFS sha256). Qwen2.5-3B is excluded (research licence). Sizes in copy come from the catalogue, not the strings in PRODUCT.md (5.2/2.4 GB were placeholders).

Recommendation from `os.totalmem()`: ≥ 16 GB → careful; ≥ 8 GB → quick; below → "short on memory". GPU detection is left out of the MVP (Metal is used automatically on Apple silicon either way).

### 5.2 Download

A ~70-line downloader in `main.js` on Electron's `net.fetch` (system proxy and certificates), not node-llama-cpp's (the probe saw an abort restart from 0%):

- Write to `userData/models/<file>.part`; on start, `Range: bytes=<size>-`; a 200 instead of 206 starts over.
- sha256 is streamed while writing; on resume the existing `.part` is hashed first (seconds). At the end: size and hash must match, then rename. A mismatch deletes the file → "The download arrived damaged…".
- `settings.json` gets `readerWanted: tier` when **Download** is pressed and loses it on **Pause**. On launch, a `.part` plus `readerWanted` resumes quietly. That is the only network use, and only after the writer pressed Download (P0 #2).
- Progress events every 500 ms. Offline/failed fetch → `error {code:'offline'}`.

### 5.3 Runtime

The worker starts on demand (first read, pass or quiet check), never at launch. If the native binding fails to load, `readerStatus` reports `broken` and Canon falls back to hand-kept mode; NEO itself is unaffected (the Windows boot smoke test never loads it).

### 5.4 Packaging

```json
"dependencies": { "node-llama-cpp": "3.22.1" },
"asarUnpack": ["node_modules/node-llama-cpp/**", "node_modules/@node-llama-cpp/**"],
"files": ["!node_modules/@node-llama-cpp/*cuda*/**", "!node_modules/node-llama-cpp/llama/{llama.cpp,gitRelease.bundle}/**"]
```

ESM-only: `canon-worker.js` stays CommonJS and does `await import('node-llama-cpp')`. Per-platform prebuilt packages arrive as optional dependencies; the mac build keeps Metal, Windows/Linux keep CPU and Vulkan. Check the installer size before and after.

### 5.5 Stage 2 and stage 3

- **Stage 2**: `httpReader` for Ollama (localhost, no key), OpenAI and Anthropic (key via `secret:set`, never the library). Same prompts and schemas, JSON mode/tools instead of grammars. The setup page gains "Use another reader" with the line "Your text leaves this computer." Nothing in `canon.js` changes; `reader.id` in cache keys keeps their proposals apart.
- **Stage 3 (web)**: what changes is the `io` adapter (a database or object store per user instead of `fs`), auth in front of it, and the reader becoming a hosted `httpReader` with a word allowance metered in the server. What stays: `canon.js` entirely (it is already I/O-free), the entry Markdown as the export/interchange format, the gates and checkers, and the window code (it only talks to `window.neo`). Per-device cache becomes per-user server cache.

---

## 6. Testing in this container

Measured here: 4 cores, 15 GB RAM, no GPU; `xvfb-run` is installed; `xvfb-run -a npx electron --no-sandbox scripts/tabs.e2e.js` runs NEO's existing in-process e2e harness (7 of 9 passed; the 2 failures are menu lookups and unrelated to Canon). Playwright is not in `node_modules` (only its browsers in `/opt/pw-browsers`), so Canon's UI tests use the existing harness (`wc.executeJavaScript`, `sendInputEvent`, `capturePage` for screenshots) rather than `_electron`.

### 6.1 Unit tests (`npm test`, no model, seconds)

- `scripts/canon.test.js` — `norm`, `sourceParas`, `sentences` (speech spans), `mentions`, quote gate (curly quotes, dashes, whitespace, >30 words rejected, absent → rejected), `valueInQuote`, value normalising, merge (alias, unique surname; Hales stay apart), entry parse/serialise round-trip and the unparseable-file rule, each checker with strong/weak cases, `swap`, `replaceInHtml`, `textHash` equal to `app.js`'s (loaded through `vm`, as `snapshots.test.js` does).
- `scripts/canon-fixture.test.js` — the engine on a temp copy of the fixture library with `fakeReader`:
  - Read the Shelf gives exactly Ilsa Varr, Tamsin Hale, Oren Hale, Bramble, Rook, Corwick (Saltmere allowed); every model-made fact has a quote found verbatim (P0 #6); the planted bad proposals never land (P0 #7); "in foal" at most *unverified*; nothing from the Maybe page (P1 #16) or Darlings/stickies (P1 #15).
  - Continuity Pass on *The Salt Crown*: exactly the five P0 slips, no decoy (P0 #13).
  - Change Bramble to stallion: the Book 1 Ch 2 "grey mare" line and the Field Notes line, nothing from Book 2.
  - Incremental: editing one paragraph re-proposes one context (count reader calls); idle re-run writes no file (mtimes unchanged, P1 #20); deleting the cache changes no entry byte (P1 #21); hand-added facts survive `again` (P1 #17); editing a quoted passage marks `changed` (P1 #19); not-slip then edit sentence (P1 #18).

`fakeReader` answers from `scripts/fixtures/canon/reader-answers.json`: `{ "<first 40 chars of paragraph>": [proposals…] }` for `propose`, and rule tables for `judge`/`refers`/`pick`. It deliberately includes a misquoted fact, a value absent from its quote, the trader's "gelding", a "species: grey mare" mislabel (as the probe saw) and the foal question, so the gates are tested against the failure modes actually measured.

### 6.2 Real-model test (opt-in)

`scripts/canon-reader.test.js` skips unless `CANON_REAL=1` and a model is found (`CANON_MODELS` or `/tmp/claude-0/llama-probe/models/`). It runs the real worker on the fixture's Book 1 Ch 2 and Book 2 Ch 1 only (a few minutes here with Qwen3-4B), and asserts properties, not exact output: every surviving fact passes the gates, Bramble ends up female, and the pass flags "tossed his head". It runs with `HTTPS_PROXY=http://127.0.0.1:9` (the container reaches the internet only through its proxy), so any network attempt fails the test (P0 #2). It also records calls/s for the ETA constant.

### 6.3 UI (e2e, xvfb)

`scripts/canon.e2e.js` (`npm run test:canon` → `electron scripts/canon.e2e.js`; here `xvfb-run -a npx electron --no-sandbox …`), built like `tabs.e2e.js`: temp `userData` and `documents`, a copy of the fixture library, and `NEO_CANON_FAKE=<answers.json>` (honoured only when `!app.isPackaged`) so no model is needed. Checks:

- A library without Canon: four tabs, no `.canon-*` element visible, Edit menu gains only the two Canon items (P0 #1).
- Keep a Canon → folder, `canon.json`, `entries/` (P0 #5); tab appears on member books only.
- Continuity Pass toggles marks on; `CSS.highlights.get('neo-slip').size === 5`; chapter files and `captureBody` output contain no slip markup (P0 #9); toggling off clears.
- Keep → one undo step restores the text; no file change without Apply (P0 #10).
- Quiet check: fake clock (`window.__canonQuietMs = 300`) → marks; a key pressed during the check → none painted (P0 #8).
- Change across series → snapshots `r` in both books; Snapshots → Restore → chapter bytes identical (P0 #11).
- Latency (P0 #12): 200 `insertText` keystrokes, keystroke-to-`requestAnimationFrame` times with Canon off vs. a read running (`NEO_CANON_FAKE_BURN=1` makes the fake worker spin a core at nice 19, or the real model with `CANON_REAL=1`); median within 10%.

### 6.4 Fixture: `scripts/fixtures/canon/`

A ready library folder (QA can point File → Library Folder… at a copy):

```
scripts/fixtures/canon/
  library/
    library.json                                    shelf "The Ashfall Road" (shelf-ash), canonId set
    book-ember-and-thorn-ember1/  book.json, chapters/{c1,c2,c3}.html, notes.html (empty)
    book-the-salt-crown-salt2/    book.json, chapters/{c1,c2,c3}.html, notes.html ("Bramble is in foal by the end of book 2?")
    book-field-notes-notes3/      book.json ("format": "notebook"), chapters/{p1 Horses, p2 House Varr, p3 Maybe}.html
    canon-the-ashfall-road-shelf-ash/  canon.json ("out": {"book-field-notes-notes3": ["p3"]}), not-slips.json (firelight line), entries/
  reader-answers.json        fake reader
  expected.json              entries + facts (attr, value, state, source chapter) and the five slips (chapter, sentence, span)
  darlings + stickies        one darling and one sticky in Book 1 asserting "Bramble is a gelding", to prove they're ignored
```

Chapters are 300–600 words of plain NEO `<p>` HTML following PRODUCT §7. Constraints the prose must keep so the rules are tested honestly: Book 2 Ch 3's "the stallion" sentence has Bramble named in the previous two sentences and Rook absent from the scene; "Rook shook his mane" comes directly after a sentence naming Bramble; the trader's line is in quotation marks; "the road back to Corwyck" occurs once.

---

## 7. Build order

Each milestone ends with `npm test` green, `npm run lint` clean, and `node scripts/i18n.js template` run when strings changed (P1 #23 at every step).

1. **M0 — Fixture and text core.** Author `scripts/fixtures/canon/` and `expected.json`; `canon.js` with `norm`, `textHash`, `sourceParas`, `sentences`, `mentions`, quote gate. *Accept:* `canon.test.js` text cases; P0 #1 (no UI change yet, existing tests pass).
2. **M1 — Entries on disk.** Vocabulary, parse/serialise, round-trip; `canon:create/open/saveEntry/setAside/restore/saveMeta/refresh` with `libName` + `writeFileDurable`; `canon-` added to the daily backup; shelf menu Keep / Stop Keeping a Canon. *Accept:* P0 #5, P0 #4, P2 #25 (refresh), round-trip tests.
3. **M2 — Canon tab, hand-kept.** Tab (member books only), nav list with filter, entry page, + Add a fact (*yours*), That's right / Set Aside / restore, New Entry, aliases, rename, click a source → chapter with the quote lit (`neo-search` highlight). Setup page placeholder. *Accept:* P1 #22, hand-kept mode of PRODUCT §4.9.
4. **M3 — Deterministic checkers and the Continuity Pass.** All strong checkers, `swap`, `not-slips`, marks + popover + Keep + Not a slip, side-pane results, Edit menu items. Works against *yours*/*verified* facts with no reader (strong slips only). *Accept:* P0 #9, #10, P1 #18; P0 #13 using `expected.json` facts loaded as *yours* (three of the five slips are strong: "tossed his head", "brown eyes", "Corwyck"; the elder-sister and "the stallion" slips are weak and wait for M5).
5. **M4 — Engine with the fake reader.** Reader interface, `fakeReader`, Read the Shelf pipeline (cues, gates, merge, rule checking, judge), cache, `canon.json.read`, incremental reads, `changed` sources, Needs You queue. *Accept:* P0 #6, #7, P1 #15, #16 (data), #17, #19, #20, #21; fixture expected entries.
6. **M5 — Local reader.** `canon-worker.js`, `localReader`, prompts/schemas, abort + requeue, nice/threads, weak checkers through `refers`, `her → his|him` through `pick`. Packaging changes. *Accept:* `canon-reader.test.js` (opt-in), full P0 #13 with the fake, P0 #2 (dead-proxy run).
7. **M6 — Getting the reader.** Catalogue, recommendation, downloader (Range resume, sha256, pause, offline, damaged), setup page copy. *Accept:* P0 #3 (unit test the downloader against a local HTTP server that drops the connection halfway; restart resumes from the `.part`), P0 #4.
8. **M7 — Read the Shelf UI and pausing.** Start button with the measured estimate, progress line, summary, pause within 1 s of a key, resume after 10 s. *Accept:* P0 #12 (e2e latency), progress copy.
9. **M8 — Quiet checking.** 90 s timer, caret-paragraph rule, drop late results, first key clears the caret paragraph's marks, setting in Edit menu and `DEVICE_LOOK`. *Accept:* P0 #8.
10. **M9 — Change across series.** `canon:changeFact`, Review Changes pane, Apply/Skip/Edit…, Apply All Shown, snapshots for books that are not open (`takeSnapshot` takes a meta and `htmlOf`), `replaceInHtml`. *Accept:* P0 #10, #11; the fixture's expected review list.
11. **M10 — Notebooks.** `"format": "notebook"`: New Notebook on the shelf +, CSS-only cloth tile, Pages tab name, no numbering/drop caps/goal, Outline and Notes hidden, left out of binding, limited exports; Leave Out of Canon in the nav right-click with the hollow ring. *Accept:* P1 #14, #16 (UI).
12. **M11 — Polish (P2 and optional).** Merge Into…, Dismissed (n) list, Read Everything Again, "4 more" mentions list. Embeddings only if M5 measurements show the known-entries list no longer fits the prompt (≈ 40+ entries named in a chapter): then rank entries per paragraph with nomic. *Accept:* P2 #24, #26.

---

## 8. Cuts and flags against PRODUCT.md

1. **"About 40 minutes" for 112,400 words is not reachable on a CPU.** Measured 48–98 s per paragraph call here; laptops 2–5× faster. One call per paragraph would be 4–20 hours. Cut: only *cueful* paragraphs go to the reader (most narrative paragraphs carry no name, trait word or kin word). Copy shows an estimate measured from the first calls, never a fixed number. Read the Shelf on a long series is an overnight job on slow machines; say so plainly.
2. **Checking every fact with a second model call doubles the cost.** Cut: a fact whose quote contains both the entity's name and a closed-lexicon value word ("Bramble, the grey mare") is verified by rule; only the rest go to `judge`. Rule verification is still a second, independent gate from the proposal.
3. **"Checking must agree" for every slip.** Cut: strong deterministic candidates (sole named entity in the same clause, `<colour> eyes` with a possessive, spelling) are slips without a model call; only weak ones (cross-sentence pronouns, "the stallion", kin) need `refers === 'yes'`. This is both cheaper and more accurate than asking a 4B model.
4. **The Continuity Pass with no reader.** The spec says it needs the reader. Strong checks need none, so a hand-kept Canon can run them; weak checks then say "Needs Canon's reader". Smallest change with real value; the owner may prefer the spec's version (one `if`).
5. **Embeddings in the MVP** add a download, a vector store and a code path that the fixture does not need: mentions are found by name and alias. Deferred to M11 behind `reader.embed`; the catalogue keeps the 84 MB file so a later release needn't ask again.
6. **GPU-based recommendation**: memory only for now.
7. **"Sources disagree raises a slip on the newer passage only after the writer picks"**: the pick happens in Needs You (That's right on one value sets it *yours*, the other drops to *Set aside*); then the ordinary pass finds the newer passage. No extra machinery.
8. **Download progress copy says "about 6 minutes"**: computed from the last 10 s of throughput; no estimate before that.
9. **Two Edit items on shelves without a Canon** (PRODUCT §4.9) mean the Edit menu is not literally unchanged; P0 #1 is read as "unchanged apart from those two items".
10. **Backups**: today's daily zip only takes `book-*` and `library.json`; Canon folders must be added or a writer's hand-kept facts have no backup.
