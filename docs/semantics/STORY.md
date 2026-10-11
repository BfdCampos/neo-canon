# Story so far — Canon's notes on what happens

Canon kept what the world *is* (eyes, kin, the mare). Writers also lose track of what *happened*: who opened the door, who touched the vortex, who has the letter. The owner, after a real chapter: "it should've generated a small 'John touched the red vortex in his room' — notes of key points as the story is being written … if one day I randomly say it wasn't John, it was Dave — that is wrong."

Story so far is that, kept small: a few lines per entry, each citing its passage, and one more check on a pause.

## 1. What the writer sees

- **On an entry page**, under the facts: **Story so far**, one line per key point in reading order, each with its source and quote like a fact. Folded after eight. A line Canon wrote is marked *Canon's note* (faint); a line the writer typed or changed is theirs. Hover → **Edit**. With no reader the heading says *Canon needs the reader to keep the story's key points.*
- **In this chapter** (right-hand pane while writing): after who and what the chapter names, a small heading **Key points** and the chapter's lines in page order. Clicking one opens its entry.
- **⌘K**: "vortex" finds *John · John reached through a red vortex in his room*; Enter opens John's page.
- **A slip** when a later sentence gives the deed to someone else ("It was Dave who touched the vortex"). The mark sits on "Dave". The popover:

  > **Canon has John doing this.**
  > Canon's note from *The Door*, Ch 1 · "He reached his hand through the swirling red vortex in front of him"
  > Here, “Dave” seems to have done it.
  > [ **Dave → John** ] [ **Not a slip** ]

  The swap is offered only when it is a plain name swap in that sentence (one name, written once); otherwise the popover says nothing can be swapped and the writer edits. Nothing changes until the button is pressed; ⌘Z undoes it.
- Unsure (the reader said *unclear*, or the Quick reader, which isn't asked): **Worth a look**, the fainter mark, asking "Did John do this?" with **Yes — make it John** / **Yes, but leave it** / **No, someone else**.

## 2. What it is not

- Not prose for the book, and never written into a chapter. It is an index, like a chapter's summary line on an index card: this is the one place the reader writes words, and they are labelled as Canon's note.
- Not a summary of a character, not a plot outline, not a chat. Two lines at most per paragraph, fourteen words each.
- Not asked of the writer. Lines appear and change as the books do; the writer edits them only if they want to.

## 3. Reading (Read the Shelf, quiet reads)

For each changed paragraph that names someone (the same `cueful` test as facts), the reader is asked once (cached per paragraph and the one before, like proposals) for 0–2 events:

`{ w: [names], d: "what they did, past tense, ≤ 14 words, the paragraph's own words", p: "where (optional)", q: "the words that say it, copied exactly" }`

Gates, all deterministic; an event failing any is dropped quietly (logged in the cache, never asked):

1. **Quote**: verbatim in the chapter (`gateQuote`), ≤ 30 words, not inside speech or reported speech, not a plan or question.
2. **Who**: every name is an entry (or becomes one by the usual name rules: capitalised, written that way in the paragraph, not a pronoun, not a misspelling). Each must be named in the quote, or be what a pronoun in the quote means by the paragraph rule of `referent()` (strong only: the one person named before, close by, the pronoun's sex not against the entry's).
3. **No invented words**: every capitalised word of the line is in the paragraph or is a who's name; every other content word shares its stem with a word of the quote ("reached", "vortex", "room"). A line that needs a word the writer didn't write is dropped.
4. **Length**: ≤ 14 words. The *where*, if grounded in the quote and not already in the line, is added to it.

## 4. On disk

In the entry's Markdown, between Facts and Set aside:

```markdown
## Story so far
- John reached through a red vortex in his room · Canon's note
  - The Door, Ch 1: "He reached his hand through the swirling red vortex in front of him" {book:door-k2, ch:c1, note:1x9ka2}
- John hid the key under the stairs · yours
  - The Door, Ch 2: "John pushed the key under the bottom stair" {book:door-k2, ch:c2}
```

- The source line is a fact's source line; `note:` is a short hash of the words Canon wrote. If the words no longer match it, the writer changed them: the line is theirs from then on.
- A line with no marker (typed in a text editor) is the writer's. Canon never rewrites or removes a writer's line; if its passage is edited away it is marked *This passage has changed*, like a fact.
- A Canon's note is re-derived whenever its chapter is read again: a passage that changed gets the new line (or none). An event naming two people is written in both entries.
- Lines are kept in reading order (book, chapter, paragraph); a line without a source stays after the one before it.
- `canon.json` gains `story: { "<book>/<ch>": textHash }`, the chapters whose key points are current, so a Canon read before this feature gains them on its next read without asking the facts again.

## 5. The contradiction check (with the Continuity Pass and quiet checks)

For each sentence checked, not in speech, reported speech or a plan:

1. **Retrieve** the stored events from *earlier* in reading order that share a distinctive word with it: a content word of four letters or more, not a name, and rare on the shelf (in at most 8 paragraphs, or 5% of them on a long shelf). "vortex" is; "hand", "room", "door" are on most shelves. A lexical index, built from the files on each pass; no embeddings (measured: the owner's case and the fixture decoys need none).
2. **Credit**: the sentence names an entry (outside speech) that is not among the event's who.
3. **Ask** the reader one question with both passages: *Does B say that someone other than John did what A says John did?* — yes / no / unclear.
   - **yes** → a slip, on the name.
   - **unclear**, or the Quick reader → Worth a look.
   - **no** → nothing. With no reader → nothing (events come from the reader).
4. The Quick reader is not asked; a sentence that also names the event's own who ("Dave remembered John reaching into the vortex") is left alone for it.

Decoys the fixture holds: the same object in a different deed ("Dave kicked the vortex shut"), memory ("Dave remembered John reaching into the vortex"), a flashback naming John, and a lie in dialogue ("“I did it,” Dave said" / "Dave said he'd done it").

**Not a slip** is remembered against the sentence (`not-slips.json`, fact `<entry>/event/<hash>`), as for facts.

## 6. Code

- `canon.js`: `parseEntry`/`serialiseEntry` (the section), `gateEvent`, `storyMerge` (re-derive by chapter), `contradictions` inside `checkSources`, `localReader.events` and `.contradicts`, `fakeReader` answers `events` and `contradicts`.
- `main.js`: the reader wrappers pass `events` and `contradicts` through; nothing else (the files are the entries').
- `app.js`: the entry page section, Key points in In this chapter, the ⌘K items, the event popover.
- Tests: `scripts/canon-story.test.js` (fake reader; gates, round trip, re-derivation, the contradiction and its decoys); `scripts/canon.e2e.js` (the owner's text).
