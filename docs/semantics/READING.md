# Reading like an editor — Canon's reading engine, rebuilt

The owner's user test, on a 1,345-word chapter of their own: Canon kept *Pio · Sex: female* and nothing about the Academy. A story editor would have written a page. The causes were the engine's design, not the model alone: a closed vocabulary (sex, species, eyes, hair, born, kin, owner, home), one paragraph at a time with no cast list and no chapter, and a 4B model asked to do everything in one pass. This page is the rebuild the owner approved: a multi-pass *editor workflow*. The principle stays: **the reader proposes, code decides; never generate prose for the book.** What changes is what the reader is allowed to propose (open facts), what it sees (an entity's every passage), and how many times it is checked (a verifier and an editor pass).

Targets: recall a writer finds useful (a lead character ~15 facts per chapter like this one, the main place ~10), precision ≥ 95% on open facts and 100% on hard traits, **zero false slips**. Accuracy over speed.

## 1. The passes

```
chapter text ──► 1 CAST ──► 2 DOSSIERS (one per entity, in parallel) ──► 3 VERIFY ──► 4 EDITOR ──► entries/*.md
                 (model)     code gathers passages; model lists facts    (model,      (code merges,
                                                                          per fact)    model: profile)
later chapters ──► 5 SLIPS: hard traits by rule (as now) · open facts: code finds candidates, model confirms
                   · deeds: Story so far (STORY.md, as now)
```

Every pass's answer is grammar-constrained JSON (node-llama-cpp `createGrammarForJsonSchema`), short keys, temperature 0. Every pass is cached per input hash (§7). The model never writes a quote: **it cites sentence ids, and code copies the writer's words** — so a misquote is impossible by construction and output tokens fall by ~70%.

### Pass 1 — Cast (one call per chapter)

Input: the chapter, paragraphs numbered `¶1…¶n`; the Canon's existing cast (`name · kind · aliases`) so the reader reuses names. Prompt sketch: *"List every person, creature, place, group, thing and rule of the world this chapter names or refers to by role ('the warden'). Include aliases exactly as written."*

```json
{"c":[{"n":"Hesper","k":"person","a":["Forty-one"],"p":[1,3]},{"n":"the warden","k":"person","a":[],"p":[3,5]},
      {"n":"the Spared","k":"group","a":[],"p":[8]}]}
```
`n` name, `k` kind (person|creature|place|group|thing|rule), `a` aliases, `p` paragraphs where it appears.

Code decides:
- Each name and alias must be in the chapter, verbatim, with its capitals (a role name "the warden" in lower case, written ≥ 2 times). A pronoun, a misspelling (`misspelt`), a word the shelf writes both ways ("Ponies") is dropped, as ACCURACY.md rule 5.
- A cast name equal to an entry's name or alias joins that entry. A role name that a later passage ties to a proper name ("His name … was Anselm") becomes an alias by rule — the model may propose the tie, the quote must state it ("name … was", "called", "known as").
- Deterministic extras stay: `shelfPlaces`, `kinEvidence`, scare-quoted capitalised terms (`the “Spared”`) as group candidates.

### Pass 2 — Dossiers (one call per entity per chapter, in parallel)

Code gathers the **passage pack** for an entity: every sentence that names it or an alias; the sentences after it whose subject pronoun agrees with the entity and no other entity is named in between (the `referent` rule, ACCURACY.md 9, extended across sentences of one paragraph); and for places and groups, every sentence in a paragraph that opens with the place ("Forty beds ran down the Long Room…"). Sentences are numbered `[s1]…[sN]` and carry their paragraph's speech spans (marked «…» so the model sees what is said). Capped at ~1,500 tokens; a long pack is split and the halves' facts merged by the editor.

Prompt sketch (per kind; the person version): *"From these sentences only, list what a story editor would note about HESPER: appearance (body, height, hair, eyes, face, clothing, marks), age, role/job, personality, habits and routines, relationships, origin and history, state, possessions. One fact per line, value ≤ 10 words in the text's own words, cite the sentence ids that state it. Skip anything only said by a character (mark it said), guessed, or about someone else."* Places: what it is like (sight, sound, smell, temperature), layout and parts, how it works (routines, rules), who is there. Groups: who belongs, how you tell, customs, rules. Rules of the world: the rule, its consequence, who keeps it.

```json
{"f":[{"g":"appearance","a":"hair","v":"cropped close, fair as wet straw","s":[7]},
      {"g":"origin","a":"born","v":"third floor, room with the green tiles","s":[14]},
      {"g":"relationship","a":"friend","v":"Coll","s":[11],"x":0}]}
```
`g` group (closed enum, §4), `a` open label (≤ 3 words), `v` value, `s` sentence ids (1–3), `x` 1 if only said in speech. The schema caps `f` at 25 items; `v` at 80 characters.

**Self-consistency (GPU tiers):** the dossier is asked twice — the second time with the pack's sentences in reverse order inside each paragraph — and a fact is kept only when both lists hold it (same group, value token overlap ≥ 0.5, a shared sentence id). Facts in only one go to the verifier with a stricter bar (both directions, §3). On the CPU this is off; the verifier carries it.

### Pass 3 — Verifier (one short call per fact)

The gates, in order; failing any drops the fact quietly into the cache's `dropped` with the reason (never Needs You):
1. **Cited** — every `s` id exists in the pack. The quote is the cited sentence(s), copied by code; trimmed to the clause holding the value's words when that clause stands alone.
2. **Tied** — the cited sentence names the entity (name or alias), or its subject pronoun resolves to it by `referent` (strong), or — for places and groups — the sentence lies in a paragraph the entity opens. Otherwise the verifier is asked *"In this sentence, who or what does 'she' refer to?"* with options (as `refers` today); only the entity's name passes.
3. **Grounded** — at least half the value's content words share a stem with the cited sentences, or map through the lexicon (`girl` → female, `tallest` → tall, `not one window` → no windows). Interpretive groups (personality, relationship) may instead pass on a double *yes* (step 4 asked twice, the second as "Is this stated, not guessed?").
4. **Supported** — *"Sentences: … Claim: Hesper — hair: cropped close, fair as wet straw. Do the sentences state this about Hesper? yes / no / unclear"*. Only *yes* keeps it. A fact the dossier marked `x` (said) is kept as said, never as true; one the code finds inside speech or reported speech (`speechSpans`, `reportedSpans`) is said whatever the model marked.
5. **Hard traits** (sex, species, eye and hair colour) still need deterministic evidence (`shelfEvidence`, ACCURACY.md 2): an open fact can carry "fair as wet straw", but only the rule makes *Hair: fair* a trait that raises slips.

Schema: `{"a":"yes"|"no"|"unclear"}`, max 4 tokens. On the CPU, facts sharing a cited sentence are verified together (`{"a":["yes","no",…]}`, ≤ 6 per call); on the GPU each alone.

### Pass 4 — Editor (code first; one model call per entity)

Code: normalises each label to the canonical set (§4); merges facts of one entity with the same canonical attribute and value-token overlap ≥ 0.6 (sources unioned, the earliest wording kept); applies **first said, first kept** (ACCURACY.md 10) to single-valued attributes (sex, species, eyes, hair colour, age, born in, height when stated as a measure); keeps every value of attributes that change (state, role, location, possession, relationship). Conflicts follow today's rules: the writer's notes against the prose → *Which is right?* in Needs You; a later prose value → the pass's slip, not a fact.

Model (one call per entity whose kept facts changed): near-duplicates code didn't catch — *"Which of these numbered facts say the same thing? Give groups of ids and the id whose wording is best."* `{"m":[[3,7],[9,12]],"best":[7,9]}`; code applies a merge only within one canonical family. Then the **profile**:

*"Write 2–4 short sentences introducing HESPER for a story bible, using only these numbered facts. End each sentence with the ids it uses, like [2,5]. No fact not listed; no guess."* `{"p":[{"t":"Hesper is fifteen, the tallest girl in her year, and one of the Spared.","f":[1,2,6]}]}`

Code keeps a profile sentence only when every content word in it stems from its cited facts' values or quotes, or is a function word or the entity's name; ids map to the facts' first sources. A profile is made again only when the kept facts' hash changes. A profile is the second place (after Story so far) where the reader writes words, and like it is labelled *Canon's profile*, never manuscript text.

### Pass 5 — Slips

- **Hard traits**: unchanged (the deterministic checkers in `checkSources`, the reader asked only for weak referents).
- **Deeds**: unchanged (STORY.md §5).
- **Open facts** (new, verify-then-flag): for each sentence checked (not speech, plan, question, or belief — the existing exclusions), code retrieves the entity's kept open facts from *earlier* in reading order that (a) the sentence is tied to by Pass 3's rule 2, and (b) share a distinctive word with it or a polarity cue against it (`no/not/never/nothing/always/only` on one side, the same head noun on the other: *window*). Then the reader: *"A (Ch 1): 'and not one window between the lot'. Canon has: the Long Room — no windows. B: 'Grey light came down through the Long Room's high windows…' Does B contradict A about the Long Room?"* and, on yes, the other way round *"Can A and B both be true?"* Only yes-then-no is a slip (mark on the span B's words share with the fact); *unclear* or the Quick reader → Worth a look; no reader → nothing. A sentence about another entity of the same kind (the infirmary's one window) fails the tie and is never asked. An exception stated as one ("On feast days it went twelve") is the reader's to answer — the dev set holds it as a decoy.

Kept open facts never raise a slip on their own unchecked state: a fact that failed a gate isn't in the entry, and unverified facts never flag (unchanged rule).

## 2. Who decides what

| Decision | Model proposes | Code decides |
|---|---|---|
| Who is in the chapter | cast list, aliases, kind | verbatim names, capitals, misspellings, joining entries |
| Which passages are about X | — | name/alias matches, pronoun chains (`referent`), place paragraphs |
| What the facts are | group, label, value, sentence ids | quote = cited sentence(s); tie; grounding; speech → said |
| Whether a fact holds | yes / no / unclear (once or twice) | only yes keeps; hard traits need rule evidence |
| Duplicates, labels, conflicts | merge groups (one family only) | canonical labels, first said first kept, Needs You |
| Profile | sentences with fact ids | every word grounded in cited facts, else dropped |
| Slips | contradiction yes/no both ways | candidates, ties, exclusions, the mark's span |

## 3. Attribute groups and normalisation

Closed **groups** (the schema enum): `appearance, age, sex, role, personality, habit, relationship, origin, history, state, possession, description, location, rule, membership, other`. Open **labels** under them, mapped to canonical keys by a table in `canon.js` (the one `scripts/canon-score.js` uses, `canonLabel`): `appearance.{hair, eyes, height, build, face, clothing, mark, other}`, `sex`, `age`, `role`/`occupation`, `personality`, `manner.speech`, `habit`/`routine`/`custom`, `relationship.{friend, kin, enemy}`, `origin`, `history`, `state`, `possession`, `location.{home, part}`, `description`, `atmosphere`, `residents`, `rule`, `membership`/`members`, `function`/`use`/`effect`, `name`. A label the table doesn't know stays as written under its group. Today's attributes keep their meaning: Eyes = `appearance.eyes`, Born in = `origin`, Sibling/Parent of/Child of/Married to = `relationship.kin`, Owner = `possession` (inverse), Lives in = `location.home`, Title = `role`.

## 4. In the entry, and in the file

The entry page groups facts under small headings in a fixed order — Profile, **Appearance**, **Who they are** (age, role, personality, membership), **Habits and routines**, **Relationships**, **Origin and history**, **State**, then for places **What it's like**, **How it works**, **Who's there**, then **Other** — each group folded after six lines. The group is derived from the label through the table, so the file needs no new syntax:

```markdown
---
id: hesper
name: Hesper
kind: person
aliases: [Forty-one]
---
# Hesper

## Profile
Hesper is fifteen, the tallest girl in her year, and one of the Spared [1]. She was born on the third floor and has never been further than the outer gate [2].
- [1] Under the Line, Ch 1: "Hesper was fifteen and the tallest girl in her year" {book:book-under-the-line-wh1, ch:c1}
- [2] Under the Line, Ch 1: "Hesper had been born on the third floor, in the room with the green tiles, and she had never once been further than the outer gate" {book:book-under-the-line-wh1, ch:c1}
- Canon’s profile {note:k3d9xa}

## Facts
- Sex: female (girl) · verified
  - Under the Line, Ch 1: "Hesper was fifteen and the tallest girl in her year" {book:book-under-the-line-wh1, ch:c1}
- Hair: fair (fair as wet straw) · verified
  - Under the Line, Ch 1: "Her hair was cropped close to the skull and fair as wet straw" {book:book-under-the-line-wh1, ch:c1}
- Habit: keeps her hands still · verified
  - Under the Line, Ch 1: "She kept her hands still." {book:book-under-the-line-wh1, ch:c1}
```

Compatibility, checked against `parseEntry` today:
- `## Profile` comes before `## Facts`. Today's parser keeps every line there in `lead.top` and writes it back byte for byte, so an older build (or Pocket) round-trips a profile untouched. The new parser reads the citation lines with the source-line syntax.
- `- [n] …` lines are the profile's sources; `note:` is the hash of the prose Canon wrote. Words that no longer match it are the writer's: never rewritten, still checked for citations (STORY.md's rule for Canon's notes).
- Open facts are ordinary fact lines with a label (`attr: 'other', label`), as a hand-typed fact is now. States are unchanged: a verified open fact is `verified`; one only said is `unverified` with `said`. Facts are written in group order, then reading order.
- A writer's hand-typed fact, a fact line Canon doesn't know, a note under a fact: kept where they are, as today.

## 5. Parallelism and hardware

The worker (`canon-worker.js`) gains `sequences`: the context is created with `sequences: N` and each prompt takes a free `LlamaContextSequence`; node-llama-cpp batches the sequences' tokens together on the GPU. N = 4 on a GPU with room (Thorough on a 10 GB card: weights 5.0 GB + KV cache f16 ~144 KB/token × 4 sequences × 4,096 tokens ≈ 2.4 GB), 2 on Apple silicon, 1 on the CPU (parallel sequences only split the same cores). `canon.js` runs each pass as a promise pool of size `reader.parallel`. Dossiers of different entities, and verifications of different facts, are independent; the editor pass waits for its entity's verifications.

Qwen3-8B and 14B are hybrid-thinking models: the worker loads them with `QwenChatWrapper({ thoughts: 'discourage' })` (and the grammar leaves no room for a think block). Context 8,192 for the cast pass, 4,096 for the rest.

## 6. Time budget (measured on the dev chapter, M1)

The dev shelf (*The Weighhouse*, 1,670 words in two chapters), model time summed over every call, 4-core CPU VM with no GPU, 4 threads, one sequence; cold load not included (Careful 4B: 251 s from a cold disk, 15 s warm). See §11 for the Thorough run.

| Pass | Calls (dev) | Careful 4B, CPU, measured | RTX 3080, Thorough 8B, 4 sequences (estimate; the owner measures) |
|---|---|---|---|
| Cast | 2 (one a chapter) | 62 s a call | ~5 s |
| Dossiers | 20 (13 entities, long packs in two parts) | 46 s a call (13–170 s) | ~25 s |
| Verifier and the referent / "someone else" / "lasting" questions | 142 | 2.1 s a call (a passage asked about twice is read once) | ~15 s |
| Story so far (events, as before) | 35 | 8.1 s a call | ~10 s |
| Profiles | 10 | 17 s a call | ~10 s |
| The pass (slips, later chapter) | ~10 | ~3 s a call | ~5 s |
| **Total** | 209 | **~31 min for 1,670 words** (1,887 s read + 12 s pass) | **~1–1.5 min a chapter** |

Thorough 8B on the same CPU (plain Node, to check quality, not speed): cast 131 s, dossier 87 s, a question 4.8 s, events 13 s, profiles 24 s a call; 286 calls, **~60 min** of model time for the dev shelf.

The progress line names the pass ("Finding who and what is here…", "Reading about Hesper… (3 of 12)", "Checking facts… (40 of 104)", "Noting what happens…", "Writing profiles…") and estimates what is left from how long each kind of question has taken on this computer.

A 90,000-word novel is a first read of ~1.5–2 h on the 3080 (once; every later read is the changed chapters only) and is not a reasonable first read on a 4-core CPU with Careful (~20 h): there the Quick tier keeps today's per-paragraph engine, and the editor workflow runs per chapter on request. Reading still pauses while the writer types (`CANON_RESUME_MS`).

## 7. Caching and incrementality

`canon-cache/<canonId>/index.json` (device only) gains, keyed by model id and prompt version:
- `cast[book/ch]` by the chapter's text hash;
- `dossier[entity/book/ch]` by the hash of the entity's passage pack (a chapter edit far from Hesper leaves her dossier cached);
- `verdict[fact]` by hash of (claim, cited sentences);
- `profile[entity]` by the hash of its kept facts;
- `dropped` as today, with the gate that dropped each proposal.
`canon.json` `read` keeps the chapters whose facts are current. Facts are re-derived per chapter like Story so far: a chapter read again replaces Canon's facts whose sources are all in it; the writer's facts (`yours`), set-aside and not-right lines are never touched.

## 8. Readers

| Tier | Writer sees | File (pinned) | Size | Picked when |
|---|---|---|---|---|
| `thorough` (new) | Thorough reader | `Qwen/Qwen3-8B-GGUF` @ `7c41481f57cb95916b40956ab2f0b139b296d974` · `Qwen3-8B-Q4_K_M.gguf` · sha256 `d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785` | 5,027,783,488 B | GPU ≥ 8 GB; Apple silicon ≥ 24 GB |
| `deep` (settings only) | Deep reader | `Qwen/Qwen3-14B-GGUF` @ `530227a7d994db8eca5ab5ced2fb692b614357fd` · `Qwen3-14B-Q4_K_M.gguf` · sha256 `500a8806e85ee9c83f3ae08420295592451379b4f8cf2d0f41c15dffeb6b81f0` | 9,001,752,960 B | offered at GPU ≥ 12 GB; on 10 GB it spills layers to the CPU |
| `careful` | Careful reader | unchanged (Qwen3-4B-Instruct-2507) | 2.5 GB | GPU 6–8 GB; Apple silicon 16 GB |
| `quick` | Quick reader | unchanged (Qwen2.5-1.5B) | 1.1 GB | CPU only, ≥ 8 GB |

Both new files were checked against the Hugging Face API (repo sha, file size, LFS sha256; `resolve/<sha>/<file>` answers 302 to the CDN). Licence Apache-2.0. `readerPick` gains the `vramGB >= 8 → thorough` branch; the owner's RTX 3080 (10 GB) gets Thorough. **Provider slot:** every pass goes through the reader interface (`cast, dossier, verify, merge, profile, contradicts`), so stage 2's `httpReader` (ARCHITECTURE.md §5.5) drops in with the same prompts and JSON schemas; `reader.id` in every cache key keeps answers apart.

## 9. Measuring: answer sheets and `scripts/canon-score.js`

Two sets, written for this rebuild (original text, the owner's chapter's shape: an institution with routines, a sensory place, a lead seen through action and pronouns, people known by role, a caste term in quotes, scare quotes, straight and curly dialogue, a rule of the world in narration, and a short Ch 2 with three slips — a hard trait, an open-fact contradiction, a deed swap — and decoys):
- **dev**: *The Weighhouse* (`scripts/fixtures/canon-editor/dev/`): 1,284 + 386 words; 13 entities, 94 facts (41 must), 10 key points, 3 slips (+1 optional), 9 decoys. Build against it.
- **held-out**: kept outside the repository by the evaluation lead; never read by the builder. The final gate.

`answers.json`: entities (kind, aliases, weight, `profile`), facts (canonical attr, value, verbatim `quote`, `also`, `alt` phrasings, must/should/nice, `hard`, `said`), `traps` (claims a reader is likely to make that are wrong), key points, slips with span and the passage they contradict, decoys. `node scripts/canon-score.js --check <answers.json>` proves every quote verbatim.

`node scripts/canon-score.js <run> <answers.json> [--review] [--reviewed <file>] [--json <file>]`, where `<run>` is what `node scripts/canon-eval.js --fixture <dir> --model <tier> --keep <out>` leaves (`canon/entries/*.md` and `slips.json`). Deterministic matching: canonical attribute family (exact 1, family 0.8, catch-all 0.5), value tokens (stemmed, stop words out, a synonym table, the sheet's `alt` phrases), quote overlap; the value must overlap or it is a different claim from the same quote. Precision: a kept fact is *supported* (matches the sheet), *wrong* (a trap, a misquote, a said fact kept as true) or *to review* — quote verbatim, claim not on the sheet — listed for a person, whose judgement goes in `--reviewed` (never guessed). Slips: found / missed / false (decoys named), Worth a look apart. Profiles: present, every sentence cited, every citation verbatim. `scripts/canon-score.test.js` (in `npm test`) holds the matcher to a perfect run (100%) and to its traps.

### Baseline (current engine, before the rebuild)

| Engine / reader | Set | Entities | Must facts | Weighted facts | Precision | Key points | Slips | False slips | Model time |
|---|---|---|---|---|---|---|---|---|---|
| fake reader | Ashfall Road (legacy expected.json) | 7/7 | 13/13 | 95% | 100% | 4/4 | 6/6 | 0 | — |
| no reader | dev | 0/13 | 0/41 | 0% | — | 0/10 | 0/3 | 0 | — |
| Careful (4B, CPU) | dev | 2/13 | 0/41 | 0% | — (0 kept) | 4/10 (must 1/5) | 0/3 | 0 | 1,203 s (60 calls, 4 threads) |

The legacy fixture scores full marks because its expected facts *are* the closed vocabulary; on the dev chapter the same engine finds what the owner saw: two entries (Hesper, Coll), no place, group or role-named person, and one fact — *Sex: female*, left unverified and wrongly marked as said, because "too tall, the warden said" later in the sentence counts as reported speech touching the quote. Its 15 Story so far lines are verbatim and sensible, 4 of them on the sheet; the three slips are missed (hair was never established; there is no Long Room; the crust deed is on Coll but "the warden" is no entry).

## 10. Milestones and acceptance (dev set; held-out is the final gate)

| M | Build | Accept on dev (Careful on this CPU; Thorough on the owner's 3080, from a memo file he sends back) |
|---|---|---|
| M1 | Worker: `sequences`, `thoughts: 'discourage'`, Thorough/Deep in the catalogue, `readerPick`; time the passes on CPU (and the 3080 by the owner) | Thorough loads; parallel answers equal sequential ones; §6 table replaced by measurements |
| M2 | Cast pass + passage packs (code) | entity recall must 100%, weighted ≥ 90%; no pronoun or misspelt entry; packs hold ≥ 95% of the sheet's must quotes |
| M3 | Dossiers + verifier + gates; open facts in the file | must-fact recall ≥ 80% (Thorough) / ≥ 65% (Careful); weighted ≥ 65%; precision ≥ 95% after review; 0 traps; 0 misquotes; hard traits 100% precise |
| M4 | Editor: normalisation, merges, first said first kept, profiles | profiles present and fully cited for every `profile: true` entity; no duplicate facts (same family, overlap ≥ 0.6); existing `npm test` green |
| M5 | Open-fact slips (verify-then-flag) | dev slips 3/3, 0 false slips, decoys never flagged; Ashfall and Lantern Coast unchanged (100% precision, 0 false slips) |
| M6 | UI: grouped facts, profile, Needs You copy; e2e; docs | the owner re-runs his own chapter; then the **held-out set once**: must recall ≥ 75%, precision ≥ 95%, 0 false slips, profiles cited |

A miss on the held-out set sends the work back to dev with a written reason; the held-out sheet is not opened by the builder at any point, and it is replaced (a new one written) if it ever is.

## 11. Results (dev set)

Runs with `scripts/canon-eval.js --fixture scripts/fixtures/canon-editor/dev --model <tier> --keep <dir>` and `scripts/canon-score.js`, 4-core CPU, no GPU, after the tuning below. Precision "after review" counts the kept facts that are not on the sheet as the builder judged them (`scripts/fixtures/canon-editor/dev/reviewed-<tier>.json`: true when the label and value hold of that entity in the text; wrong when they don't, or call one moment a habit); the evaluation lead may judge them otherwise. Held-out: not run (not seen by the builder).

| Engine / reader | Entities | Must facts | Weighted facts | Precision on sheet | Precision after review | Key points | Slips | False slips | Profiles (cited) | Model time |
|---|---|---|---|---|---|---|---|---|---|---|
| before: Careful (4B), per paragraph | 2/13 | 0/41 | 0% | — (0 kept) | — | 4/10 | 0/3 | 0 | 0/7 | 1,203 s |
| **after: Careful (4B), editor's reading** | 11/13 (90% weighted) | **29/41 (71%)** | 55% | 53/53 | **64/65 (98%)** | 5/10 (must 2/5) | **3/3** | **0** | 4/7 (4) | 1,899 s |
| after: Thorough (8B), CPU | 11/13 (90%) | **30/41 (73%)** | 56% | 52/52 | 60/70 (86%) | 4/10 (must 1/5) | **3/3** | **0** | 5/7 (5) | 3,601 s |
| after: fake reader (the e2e's answers) | 8/13 | 21/41 | 34% | 25/25 | — | 0/10 | 2/3 | 0 | 3/7 | — |

Acceptance (§10) on dev with Careful: M2 entity recall must 7/7 (the Weighhouse, named once, comes in as the setting; the valley and the scale, should and nice, are missed), weighted 90%; no pronoun or misspelt entry. M3 must recall 71% ≥ 65%, precision 98% ≥ 95%, 0 traps, 0 misquotes, hard traits 100% (Sex, Hair kept only by the rules). M4 profiles for 4 of the 7 `profile: true` entities, every sentence cited and verbatim; the warden's and the Weighhouse's were left out (the warden's sentences held words in no fact; the Weighhouse keeps one fact). M5 slips 3/3, 0 false, no decoy flagged. M6 UI and e2e: done; the owner's chapter and the held-out set are for the owner and the evaluation lead.

**Thorough on dev**: recall is the Careful reader's or a little more, but its verifier says yes to more of the dossiers' stray readings (the yard given the mountain's tip, the ledger "red" for its red ribbon, Coll's one glance kept as a habit): 86% after review, below the 95% bar. Its 0 false slips held. Before the Thorough tier is the 3080's default the owner should run it there (with `sequences: 4` it is also the first GPU measurement) and the review should be repeated; the gates added for its first run (a place's sentence about a person is the person's; an appearance never names another of the cast) took it from 41 facts to review to 18.

What the runs changed (each a commit): naming ties joined through the words the text used ("the weigher" ↔ "Brother Ink" ↔ "Anselm"); the setting only an institution or building, never a room, and only its routines and rules; polarity read beside the value's own words; a habit must be said to recur; a fact tied by a pronoun or a paragraph asked whether it is really someone else's, and a habit or state whether it lasts; a person called by a role has that role; the slip questions asked of each passage alone ("does the Long Room have windows?", "who gave the crust?"), because a small reader shown both took A's word for it, and a deed of no one kind (two people sitting) asked whether it is the same event; "wrote every number" and "could say it" are no reports; an owning "her" after "took" is not the subject's.

Still missed with Careful (dev): the Weighhouse's six routines (its sentences name no one and nothing of it; asked as the setting, the verifier says no), Hesper's membership of the Spared and the inked 41 (two sentences apart), her "getting less", the Long Room's smell, the Spared's custom, the two "friend" facts (kept as "nearest thing she had to a friend", which the sheet's matcher doesn't take for "friend"). Story so far is unchanged (5/10).
