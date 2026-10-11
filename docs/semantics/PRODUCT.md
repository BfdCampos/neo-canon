# Canon — NEO's continuity engine

Product spec for the `semantics` fork. Engineering name: **semantics**. Writer-facing name: **Canon**.

George R.R. Martin changed a horse's sex between books and a fan had to tell him. Canon is the fan who has read everything you wrote, never forgets which horse is a mare, and taps you on the shoulder only when you have stopped writing.

---

## 1. Pillars

1. **You are the writer.** Canon reads; it never writes story. It keeps the facts your words establish and tells you when two of them disagree.
2. **Canon is the product.** A living, distilled record of a world, with every fact tied to the passage that established it. Not a copy of the text, not a summary, not a chat log.
3. **Accuracy over speed.** A wrong flag is worse than a missed one. A fact with no source passage is never shown as fact. Slow, careful passes are acceptable.
4. **Seamless.** No terminal, no model hunting, no "RAG". One button downloads the reader; after that it just works.
5. **Offline-first.** Once the reader is downloaded, nothing leaves the computer. NEO without Canon remains the whole of NEO.

### Non-goals (MVP and forever, unless the owner says otherwise)

- **No prose generation.** No "continue", "rewrite", "describe", "brainstorm", "expand".
- **No autocomplete**, inline suggestions, or ghost text from the model.
- **No chat that writes.** There is no chat box. The writer cannot ask Canon to produce text.
- **No summaries written by the model** into entries. An entry holds facts with quotes, and **Story so far**: one short line per key point ("John reached through a red vortex in his room"), each with its verbatim quote and labelled *Canon's note*, an index like a chapter's line on an index card (STORY.md). Prose about a character is the writer's own; nothing the reader writes ever goes into a book.
- **No marks while typing.** No live squiggles, no toasts, no badges that change under the caret.
- **No silent edits.** Canon never changes a manuscript word without the writer confirming that exact change.
- **No cross-world sharing** in the MVP. Each Canon belongs to one shelf.
- **No cloud** in the MVP: no API keys, no accounts, no telemetry.

The only text the model may propose for the manuscript is a **minimal substitution** inside one cited sentence (e.g. `he → she`, `stallion → mare`), always shown as a before/after for the writer to apply or skip.

---

## 2. Concepts and names

| Concept | Writer sees | Notes |
|---|---|---|
| The semantics of a world | **Canon** | "The Canon of *The Ashfall Road*". Short, already means "what's true in this world" to fans. Avoids "Codex"/"Story Bible", which competitors use. |
| An entity | **Entry** | One person, creature, place, thing or group. Kinds: *Person, Creature, Place, Thing, Group, Other*. |
| A fact | **Fact** | One attribute or relationship: `Sex: mare`, `Eyes: grey`, `Sister of: Oren`. |
| A citation | **Source** | Book, chapter (or note) and a short verbatim quote. Every model-made fact has at least one. |
| A continuity flag | **Slip** | "Possible slip" in the popover. Gentle, not "error". |
| The model | **the reader** | "Canon's reader". Never "AI", "LLM" or "model" in primary copy (Settings may name the file). |
| Build | **Read the Shelf** | First full pass. Later passes are incremental and quiet. |
| Verify | **Checking** | The second, independent pass every extracted fact and every slip must survive. |
| On-demand pass | **Continuity Pass** | Twin of Spellcheck Pass, in the Edit menu. |
| A notes-only book | **Notebook** | A book with `"format": "notebook"`. |

### Mapping onto NEO

- **Series / world = a shelf.** Shelves already group series. A shelf *keeps a Canon* only when the writer opts in (right-click the shelf's name → **Keep a Canon for This Shelf**). Shelves organised by status ("Drafts", "Querying") never get one by accident. A standalone novel gets its own shelf.
- **Books on that shelf** feed Canon from their **Manuscript** and their **Notes** tab (`notes.html`).
- **Notebook** (new, but built from an existing kind): the world-building notebook. Create it from the shelf's + right-click menu: **New Book / New Script / New Notebook**. Internally it is an ordinary book folder with `"format": "notebook"`; each *chapter* is a *page* with a free title ("Horses", "House Varr", "The Salt Laws"). Reuses the editor wholesale.
  - Inside: the Manuscript tab reads **Pages**; pages are not numbered, no drop caps, no word goal or progress bar; Outline and Notes tabs hidden (a notebook *is* notes). Darlings, Find, Snapshots, spellcheck work as usual.
  - On the shelf: a cloth-bound field notebook — slightly shorter and narrower than a book, dark cloth, an elastic band down the right edge, a ribbon at the foot, the title on a small paper label. Distinct from books (cover art) and scripts (card stock with brads) at a glance. No cover art, no progress bar.
  - Binding a shelf leaves notebooks out of the bound book; exports offer HTML, Markdown, Word and plain text only.
- **What does not feed Canon:** Darlings (cut on purpose), stickies and placeholders (to-dos), outline card notes (plans), snapshots (history). Rationale: Canon is what the world *is*, not what the writer considered.
- **"Leave Out of Canon"**: right-click a notebook page's title in the nav pane (or a book's Notes tab label) to exclude an exploration that isn't true yet. Excluded pages show a small hollow ring beside their title on hover. Re-including re-reads the page.
- **Reading order** for a world = shelf order of books, then chapter order; notebooks and Notes tabs have no position in time.

### New surfaces, and why each earns its place

1. **Canon tab** (Manuscript / Notes / Outline / **Canon** / Darlings). On a shelf that keeps a Canon it opens with both panes pinned, the entries on the left and Needs You on the right (a first-time writer couldn't find the facts); either can be unpinned, and the choice stays on that computer. A quiet line at the top of every page says where the reader stands: *No reader yet — Download (2.5 GB)*, *Downloading the reader… 43% · Pause*, or *Reader ready · Apple M2 GPU*, with **Reader settings**. An entry's page holds its facts, its **Story so far** (STORY.md) and *In my words*. Shown on every book (a user test showed that a tab hidden until opt-in was never found). On a shelf without a Canon it says what Canon is in two sentences and offers one button, **Keep a Canon for “{shelf}”** (with the status-shelf warning and **Move…**), and a link to **Open the Tutorial**. Without a tab, hand-editing — a core entry point — has nowhere to live. It reuses the existing layout: left nav pane lists entries, the page shows one entry, the right-hand pane holds the review queue.
2. **Slip marks + popover** on the page. The whole point; built on the CSS Highlight API like spellcheck, never saved into chapter HTML.
3. **Continuity results in the right-hand pane** during a pass, the same pane Find already uses.
4. **The reader's setup page**, shown inside the Canon tab. The only thing shown at launch is the **welcome** (once per computer, on the shelf, never over a page): what Canon is, **Open the Tutorial**, **Set Up the Reader** (the recommended reader and its size; the download shows in the sheet and the Canon tab) and **Later**. Any answer, Esc included, is for good; Help → Welcome to NEO Canon… shows it again.
5. **The Tutorial shelf** (Help → Open the Tutorial): a shelf that keeps a Canon, holding *Across the Saltings* (three seeded slips: Juniper the mare called “his”, Wren’s grey eyes turned brown, Marrowby spelt Marowby; and decoys) and the *Start Here* notebook (eleven lessons, left out of Canon). The lessons pace the story: read Chapter 1 (lesson 2), Chapter 2 before the Canon tab (lesson 4), Chapter 3 before the Continuity Pass (lesson 5), so the slips are found in chapters already read and nothing is spoilt. Lesson 3, *Get the Reader*, says what the reader does, that it runs on the computer, and what to expect, with a **Download the reader** button in the page; lesson 6's Try this (*Juniper shook his mane.*) is caught by the rules with no reader, after the pause or at once with ⌘'. Its entries ship pre-built, every checked fact verified by rule from a quote in the story, so every lesson works without the reader; Needs You holds one question, what Hesketh says of Juniper ("more mule than horse"), and Wren and Hesketh have a few lines of Story so far. Opened again, it is the same shelf with the writer's changes; **Start the Tutorial Afresh…** takes the old one's books off the shelves whole (File → Reshelve a Book… brings them back). The files are `tutorial/` in the app, copied by `tutorial:open`.

No new window, toolbar, sidebar, status-bar widget or notification beyond the one-time welcome (and the small Canon Reader window, which opens only when the writer asks for it).

---

## 3. On disk

- `NEO Library/canon-<slug>-<shelfId>/` (library.json's shelf gains `canonId`; all names through `libName()`):
  - `entries/<entry-slug>.md` — **one Markdown file per entry**, human-readable and hand-editable in any text editor.
  - `canon.json` — shelf id, member books, per-chapter `textHash` last read, reader version, settings.
  - `not-slips.json` — dismissed slips (fact id + hash of the sentence).
  - `set-aside/` — removed entries and facts. Nothing is deleted.
- Rebuildable cache (index, embeddings, mention lists) lives in **`userData/canon-cache/<canonId>/`, not the library**, so iCloud/Syncthing never carry it and two devices never fight over it. Deleting it costs only a re-index.
- Reader weights live in `userData/models/`, never in the library (a 5 GB file must not sync).
- Writes follow NEO's rules: `writeFileDurable`, an entry file is written only when it changed, no interval timer.

Entry file shape (the engine's contract; engineering may refine syntax, not substance):

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
  - Ember and Thorn, Ch 2: "Bramble, the grey mare, would not cross the ford." {book:ember-k3, ch:c7}
- Sex: female (mare) · yours
  - Field Notes, Horses: "Bramble — mare, eleven, bad-tempered with strangers." {book:notes-a9, ch:p2}
- Owner: Tamsin Hale · unverified
  - Ember and Thorn, Ch 4: "Tamsin led her own horse, Bramble, up the bank." {book:ember-k3, ch:c9}

## In my words
(Free text, written only by the writer. Canon never writes here.)
```

Quotes are verbatim and capped at 30 words. Citations anchor by quote, not offset: if the quote can no longer be found in that chapter, the source shows **"This passage has changed"** and the fact drops back to *unverified* until re-read.

---

## 4. Journeys and copy

All strings go through `t()`. Menu items are new entries in existing menus.

### 4.1 Opting in and first run (reader download)

1. The **Canon** tab of any book → **Keep a Canon for “{shelf}”** (or right-click a shelf's name → **Keep a Canon for This Shelf**).
2. The shelf's books keep the Canon. NEO opens the current book on its Canon tab.
3. If the reader is not on this computer, the tab shows the setup page:

   > **Canon needs a reader**
   > Canon reads your books and notes to keep track of who and what is in your world. The reader runs on this computer. Nothing you write is sent anywhere.
   >
   > **Recommended for this computer:** Careful reader · 5.2 GB
   > [ **Download** ]
   > *Other choices* (hidden disclosure: **Quick reader · 2.4 GB** — "Faster, misses more. For computers with 8 GB of memory.")
   >
   > You can keep writing while it downloads.

   The recommendation is picked from the graphics card and memory (a GPU with 6 GB of its own, or Apple silicon with 16 GB → careful; otherwise 16 GB+ → careful; 8 GB → quick; under 8 GB → "This computer is short on memory for the reader. You can still keep a Canon by hand."). The reader runs on the best hardware there is (Metal, CUDA or Vulkan, else the processor) without asking; **Reader settings** (Help → Canon Reader…, or the link on the reader line) lets an advanced writer choose *Automatic* or *CPU only*, *Careful* or *Quick* (a reader not on the computer is downloaded), and shows the speed measured here. A small embedding model is part of the same download; the writer never sees it as a separate item.
4. Download: a thin bar in the setup page only — "Downloading the reader · 1.8 of 5.2 GB · about 6 minutes". Resumable; checksum-verified; **Pause**/**Resume**. Leaving the tab doesn't stop it. No notification on completion — the page simply reads "The reader is ready." when next opened.
5. Offline at download time: "NEO can't reach the download right now. Try again when you're online — everything else keeps working." with **Try Again**.
6. Failed checksum: "The download arrived damaged. NEO threw it away. [Download Again]".
7. Model licence: the page links "Licence" under the choice; NEO never bundles weights.

### 4.2 Building Canon for existing books

1. Canon tab with no entries: "**Read the Shelf** — Canon will read 3 books and 1 notebook (112,400 words). On this computer that takes about 40 minutes. You can keep writing; Canon steps aside whenever you type." [ **Read the Shelf** ]
2. Progress (Canon tab only): "Reading *Ember and Thorn* · chapter 7 of 22" then "Checking 214 facts · 96 done". The reader **pauses within a second of any keystroke** and resumes after 10 s of quiet, so typing never stutters.
3. Done: "Canon found 38 entries and 214 facts. 209 checked out; 5 need you." The first thing the books or notes say of anyone is kept without asking (§5, *First said, first kept*); the **5** are the writer's notes disagreeing with the story and what characters only say, listed under **Needs You**. The reader also keeps each entry's **Story so far** (STORY.md).
4. Afterwards Canon stays current on its own: when the writer pauses (§4.8), changed chapters (by `textHash`) are re-read. There is no "rebuild" button in normal use; Settings has **Read Everything Again** for after a reader upgrade.

### 4.3 Writing notes that feed the world

1. New Notebook "Field Notes" on the shelf; page "Horses": *"Bramble — mare, eleven, bad-tempered with strangers."*
2. After the next pause the page is read. The Canon entry **Bramble** gains `Sex: female (mare)` with source "Field Notes, Horses".
3. A book's **Notes** tab feeds Canon the same way; its source label is "*Ember and Thorn*, Notes".
4. Notes and prose disagree (notes say grey eyes, Chapter 1 first says brown)? Needs You asks "**Ilsa Varr · Eyes: which is right?**" with both passages and one button per value; until then neither raises a slip. Canon never picks a winner silently. If the prose first agrees with the notes and only a later chapter says brown, that later line is simply a slip.

### 4.4 Editing an entry by hand

1. Canon tab → left pane lists entries by kind, with a filter field ("Find an entry"). Click **Bramble**.
2. The page shows the entry set like a NEO page: name, kind, aliases, facts, sources, *In my words*. Controls appear on hover only.
3. Hover a fact → **Edit**, **That's right** (makes it *yours*), **Set Aside**. Click a source → opens that chapter with the quote highlighted (Highlight API).
4. **+ Add a fact** (on hover at the end of Facts): type `Sex: mare`. It is saved as *yours*, source "Written in Canon".
5. Rename / aliases: click the name or "Also called". Right-click an entry → **Merge Into…** (for "the grey" split from Bramble) and **Set Aside Entry** (moves the file to `set-aside/`; "Bramble is set aside. Restore it from Set Aside at the foot of the list.").
6. **+ New Entry** at the foot of the list: name and kind only.
7. Hand edits made in a text editor on disk are picked up on focus, like chapters (`refreshFromDisk` rules).

### 4.5 Continuity Pass

1. **Edit → Continuity Pass** (⌘' / Ctrl+'), beside Spellcheck Pass. Toggle, like spellcheck.
2. Scope: the open book against its shelf's Canon. The right-hand pane offers "This book · Whole shelf".
3. Progress line in the right-hand pane: "Checking chapter 4 of 22…". Marks appear chapter by chapter.
4. Right-hand pane lists slips: "**Bramble** · Ch 9 · 'he tossed his head'". Click jumps there.
5. None found: "No slips found against 214 facts." (Never "Everything is consistent" — absence of evidence isn't proof.)
6. Toggling off removes every mark.
7. No reader: the menu item is enabled and opens the Canon tab's setup page with "The Continuity Pass needs Canon's reader."

### 4.6 The mark and the popover

- Mark: a **dotted underline in muted gold**, distinct from spellcheck's red, painted with the Highlight API on the smallest span (the word "he", not the sentence). Never saved.
- Hover (or right-click, or ⌥Enter with the caret in the mark) shows the popover. Never opens from the caret alone while typing.

> **Bramble is a mare.**
> Established in *Ember and Thorn*, Ch 2 · Field Notes, Horses · 4 more
> Here, "he" seems to mean Bramble.
>
> [ **Keep: mare** ]  [ **Bramble is now a stallion…** ]  [ **Not a slip** ]

- "4 more" expands a list of every mention; each opens its passage.
- **Keep: mare** shows the substitution in place — "~~he~~ **she**" — with **Apply** / **Cancel**. Apply is one undoable edit (⌘Z).
- **Not a slip** → "Got it. Canon won't flag this line again." Stored in `not-slips.json` against the sentence hash; editing the sentence brings it back under review.
- The popover's quote of the established fact is always the verbatim source quote, never a paraphrase.

### 4.7 Changing the canonical fact across the series

1. **Bramble is now a stallion…** opens a short confirmation in the popover: "Make Bramble a stallion everywhere? Canon will find every passage that says otherwise and show you each change. Nothing changes until you apply it." [ **Find Passages** ] [ Cancel ]
2. The fact in Canon becomes `Sex: male (stallion) · yours`; the old fact moves to the entry's *Set aside* with its sources.
3. The right-hand pane becomes **Review Changes · 7 passages in 2 books**. Each item:
   > *Ember and Thorn*, Ch 2
   > "Bramble, the grey ~~mare~~ **stallion**, would not cross the ford."
   > [ **Apply** ] [ **Skip** ] [ **Edit…** ]
   Edit… lets the writer type their own wording for that sentence only. Items that need more than a word swap (e.g. "she was in foal") are listed with no proposal: "Needs your words — open the passage."
4. **Apply All Shown** exists but only after the writer has scrolled the full list.
5. Before the first apply in each book, NEO takes a Snapshot (kind `r`) and a `snapshotStructure`, so ⌘Z (open book) or Snapshots → Restore (any book) brings everything back. The pane says so: "A snapshot of each book was taken first."
6. Books not open are changed through the existing chapter write path, only for chapters that actually change.
7. Finish: "6 passages changed, 1 skipped. Bramble is a stallion."

### 4.8 Quiet checking on a pause

- Setting: **Edit → Check Continuity When I Pause** (on by default once the reader is installed; per device, in `DEVICE_LOOK`).
- Trigger: **90 seconds with no keystroke** in the editor. Canon then (a) re-reads changed chapters into Canon and (b) checks the paragraphs changed since the last check, in the current chapter only.
- Never checked: the paragraph holding the caret if it doesn't end in sentence punctuation; ghosts, placeholders, scene breaks.
- Marks appear only if the writer is still paused when results arrive. The first keystroke clears marks in the caret's paragraph; others stay until fixed, dismissed, or the chapter is left.
- No sound, no badge, no tab glow. A writer who never looks sees nothing but a faint underline.

### 4.9 Offline, and with no reader

- Offline with the reader installed: everything works. Canon makes no network calls.
- No reader: NEO is fully NEO. The Canon tab still opens and is a **hand-kept world bible**: entries, facts (all *yours*), aliases, merges. Read the Shelf, Continuity Pass and quiet checking show "Needs Canon's reader · Download (5.2 GB)".
- Shelf without a Canon: the Canon tab explains and offers **Keep a Canon for “{shelf}”**; Edit → Continuity Pass explains and offers the same.
- **Stop Keeping a Canon** (shelf right-click) returns the tab to its offer; files stay on disk; "The Canon's files are kept in your library. Keep a Canon again to bring it back."
- Pocket (MVP): shows no Canon tab, preserves `canon-*` folders untouched.

---

## 5. Accuracy UX

### Pipeline (what the writer must be able to trust)

1. **Read** — the reader proposes facts, each with a verbatim quote from the passage.
2. **Quote gate (no model)** — the quote must be found in the cited chapter after normalising quotes and whitespace. If not, the fact is discarded. This single deterministic step removes most hallucinations.
3. **Checking** — a second, independent prompt sees only the quote (plus its paragraph) and the claimed fact, and answers *supported / not supported / unclear*.
4. Slips go through the same two gates: the flagged span must exist verbatim, the fact it conflicts with must be *verified* or *yours*, and Checking must agree that the sentence contradicts it given its paragraph.

### Fact states

| State | Mark (beside the fact) | Meaning | Can raise slips? |
|---|---|---|---|
| **unverified** | hollow dot ○ | Only said or planned, or its passage has changed | No |
| **verified** | filled dot ● | Through the gates, and the first value said | Yes |
| **yours** | small pen nib | Written or confirmed by the writer | Yes, and wins over the rest |
| **sources disagree** | split dot ◐ | The writer's notes and the story say different things | Raises a slip on the newer passage only after the writer picks |

No percentages, no "confidence 0.83". Hover the dot: "Checked against *Ember and Thorn*, Ch 2" / "Not checked yet" / "You wrote this".

### First said, first kept

The owner, after writing "John has green eyes" in Notes and being asked to confirm it: "It was THE FIRST thing I wrote about him… assume that's true. It should only catch my attention on conflicts, first come first serve."

- A proposal that gets through the gates (quote verbatim, value word in it, the entity tied to it by rule or by the reader's double answer) is **checked without asking**. Of the values for one attribute, the first said in reading order is kept; the writer's Notes and notebook pages count first, as the writer's own word.
- A later passage that says otherwise is a **slip** on that passage, never a question.
- A proposal that fails a gate is left out quietly (the cache keeps why). It is never turned into a question.

### Needs You

Right-hand pane on the Canon tab. Only what Canon cannot settle itself:

> **Ilsa Varr · Eyes: which is right?**
> *Field Notes*, House Varr: "Ilsa: brown eyes"
> *Ember and Thorn*, Ch 1: "Captain Varr's eyes were the grey of wet slate."
> [ **brown** ] [ **grey** ] [ **Skip** ]

- *Which is right?*: the writer's notes against the story (or two notes against each other). The value picked becomes the writer's; the other goes to *Set aside*, and the slips follow.
- What a character only says, or a plan: "The horse-trader says Bramble is a gelding" [It's true] [Only what's said] [Skip].

The queue is optional; ignoring it only means fewer slips.

### What the MVP flags (deliberately narrow)

Fixed traits and ties that don't change in a story's timeline: sex and pronouns, eye/hair colour, species, kinship (sister of, son of), birthplace, and **name spelling** (Corwick vs Corwyk). Changing states (alive/dead, injuries, titles, location) are *recorded* with "from" sources but **do not raise slips in the MVP**.

Speech is evidence of what a character says, not of the world: facts sourced only from dialogue are stored as "said by …" and never raise slips.

### Not a slip

Remembered per sentence hash in `not-slips.json` (synced, plain JSON). A dismissed slip never returns unless the sentence changes. The Canon tab's right-hand pane has **Dismissed (12)** at its foot to review and restore them.

---

## 6. MVP acceptance checklist (priority order)

**P0 — must hold or the feature does not ship**

1. With no reader installed and no Canon on any shelf, every existing NEO test passes and the UI is visually unchanged.
2. No network request is made by Canon except the reader download, and only after the writer presses **Download**.
3. The reader download is a single button, shows progress, resumes after quitting NEO, and verifies a checksum.
4. Reader weights are stored outside the library folder; the library gains no file larger than 1 MB from Canon.
5. **Keep a Canon for This Shelf** creates `canon-<slug>-<shelfId>/` with `canon.json` and an `entries/` folder; every entry is one `.md` file in the format of §3.
6. Every model-made fact in every entry file has at least one source whose quote occurs verbatim in the cited chapter or note.
7. A fact whose quote is not found in its source is never written as verified, and never raises a slip.
8. No slip mark appears while a key was pressed in the last 90 seconds, except during a Continuity Pass the writer started.
9. Slip marks never appear in saved chapter HTML (`captureBody` output and files on disk contain no slip markup).
10. Canon never changes manuscript text without an explicit Apply on that exact change.
11. Change-across-series takes a snapshot of each affected book before its first change; restoring it returns every chapter byte-identical.
12. Typing latency with Canon reading in the background stays within 10% of NEO with Canon off (keystroke-to-paint, measured on the fixture).
13. On the fixture (§7), the Continuity Pass flags every P0 seeded slip and raises **no** slip on any decoy.

**P1**

14. Creating a Notebook from the shelf + menu shows a notebook tile distinct from book and script tiles; it has no progress bar and no numbered chapters.
15. Notes tab text and notebook pages feed Canon; Darlings, stickies, placeholders and outline card notes do not.
16. A page marked **Leave Out of Canon** contributes no facts; un-marking it restores them after the next pause.
17. Hand-added facts are saved as *yours* and survive **Read Everything Again** unchanged.
18. Dismissing a slip with **Not a slip** prevents it on the next pass; editing that sentence brings it back under review.
19. Editing a cited passage so its quote disappears marks the source "This passage has changed" and the fact *unverified*.
20. Only chapters whose text changed are re-read; an idle NEO with Canon writes no files (no timer writes).
21. Deleting the cache folder and reopening rebuilds the index without changing any entry file.
22. Set aside entries and facts are restorable from the Canon tab.
23. All new strings pass `node scripts/i18n.js template` and appear in the template.

**P2**

24. Merge Into… combines aliases and sources and leaves the merged file in `set-aside/`.
25. An entry file edited in an external editor is picked up on focus.
26. Two devices syncing the library never produce conflicting writes to the same entry from an idle state.

### Stage 2

- Ollama, OpenAI and Anthropic as alternative readers (API keys in `secrets.json`, never the library), with a clear "your text leaves this computer" line.
- Slips for changing states along reading order (the dead don't speak in chapter 12; the hand lost in Book 1 stays lost).
- Canon tab on Pocket (read and hand-edit; checking stays on the desktop).
- Timeline view of an entry's facts by reading order; per-book Canons for standalone novels.
- Manuscripts in languages other than English promoted from "Early" once each language passes the fixture translated.

### Stage 3

- Hosted web NEO with login; a cheap hosted reader with a monthly word allowance; paid tiers for larger allowances and careful readers.
- Shared worlds (several writers, one Canon) and a read-only "series bible" export for editors and fan wikis.

---

## 7. Test fixture: *The Ashfall Road*

A shelf named **The Ashfall Road** keeping a Canon, holding two short books and one notebook, 300–600 words per chapter, English. Lives in `scripts/fixtures/canon/` as a ready-made library folder so QA can point File → Library Folder… at it.

**Book 1 — *Ember and Thorn*** (3 chapters)
- Ch 1: Captain **Ilsa Varr** introduced: "Captain Varr's eyes were the grey of wet slate." **Tamsin Hale** is "Oren's younger sister". The town is **Corwick**.
- Ch 2: "Bramble, the grey mare, would not cross the ford." Tamsin rides her. A second horse, **Rook**, "a black stallion", belongs to Oren.
- Ch 3: Oren loses his left hand in an ambush at the ford.

**Book 2 — *The Salt Crown*** (3 chapters)
- Ch 1: **[slip P0]** "Bramble tossed his head and pulled at the reins." **[slip P0]** "Ilsa's brown eyes narrowed."
- Ch 2: **[slip P0]** "Tamsin, the elder of the two Hales, …" **[slip P0]** "the road back to Corwyck". **[slip, with the reader]** "He still wore the belt that Ilsa had bound round the stump at the ford" (Book 1 Ch 3: *Tamsin* bound the stump with her own belt; STORY.md).
- Ch 3: **[slip P0]** "Tamsin swung down from the stallion" where context makes the horse Bramble.

**Notebook — *Field Notes*** (3 pages)
- "Horses": "Bramble — mare, eleven, bad-tempered with strangers. Rook — stallion, Oren's."
- "House Varr": "Ilsa: grey eyes, born in Saltmere."
- "Maybe": marked **Leave Out of Canon** — "What if Ilsa had green eyes and was born in Corwick?"
- Book 2's Notes tab: "Bramble is in foal by the end of book 2?" (a plan that also feeds Canon, testing that a question mark isn't taken as fact).

**Decoys — must NOT be flagged**
1. "Rook shook his mane" right after a Bramble sentence (the pronoun is Rook's).
2. A horse-trader says, "That's no mare, that's a gelding, I'd swear it" — dialogue, a lie.
3. Oren fights one-handed in Book 2 (a change established in Book 1 Ch 3 — consistent).
4. "The sky went the grey of a mare's flank" — a simile, no entity.
5. The "Maybe" page's green eyes and Corwick birthplace (left out of Canon).
6. A slip pre-dismissed in `not-slips.json` ("Ilsa's eyes looked almost brown in the firelight", Book 2 Ch 3).
7. "Oren cut the old belt into a strap for his shield" — the same belt, another deed.
8. "Oren remembered Tamsin binding the stump with her belt" — memory, the doer named.
9. "“Ilsa bound it, not my sister,” he told the riders" — a lie in dialogue.

**Expected results.** Read the Shelf yields entries for Ilsa Varr, Tamsin Hale, Oren Hale, Bramble, Rook and Corwick (Saltmere optional), each fact cited with a verbatim quote. The Continuity Pass on *The Salt Crown* flags exactly the five P0 slips, no decoys. Choosing **Bramble is now a stallion…** lists the Book 1 Ch 2 "grey mare" line and the Field Notes line for review, and leaves the Book 2 lines alone (they already agree). "Bramble is in foal" is stored as *unverified* at most, never verified.
