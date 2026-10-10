# NEO Canon — UX review by the product lead

Branch `semantics`, M0–M15. I reviewed it in a copy (`/tmp/claude-0/ux`). I went through it as a first-time writer, starting from a fresh library with the real reader catalogue (`scripts/ux-journey.js`, screenshots in `shots/fresh/`). I then ran it again on the Ashfall Road fixture with the fake reader (`canon.e2e.js` with `CANON_SHOTS_DIR=shots/e2e`, 26/26 pass). I also read all 16 screenshots in `docs/semantics/screens/` and every `t()` string in the GO TO ANYTHING and CANON sections of `app.js`.

**Overall.** The engine keeps the promise. Even with **no reader**, a single hand-written `Sex: mare` flagged "Bramble tossed **his** head", "the old **stallion**" and "a **gelding**". The popover quotes the source word for word, and the change across the series is careful and can be undone. The weakest part is *getting there*. A first-time writer will not find Canon. If they do find it, it gets attached to the wrong shelf, and they then face three stacked messages and two separate buttons. The work in this review is mostly copy and a few small behaviour changes, not engine work.

---

## 1. Verdict per pillar

| Pillar | Verdict | Why |
|---|---|---|
| **You are the writer** | **Pass, strongly** | Canon has no generation surface, chat or ghost text. The model's only edits are one-word substitutions shown as before and after (`~~mare~~ **stallion**`). Edit… takes the writer's own wording, and passages that need more than a swap say "Needs your words — open the passage." The *In my words* placeholder ("Canon never writes here.") states the pillar in four words. |
| **Semantics: the horse** | **Pass on the fixture, unproven at scale** | Hand-kept facts already catch the explicit cues, and the fake reader finds all five P0 slips and none of the decoys. The real reader has only been run with the *quick* model on 3 chapters (ARCH note 27). The *careful* model, which we recommend to most writers, has never been run on the fixture. PROBE.md says it "missed sex:female". The UI also leaks some bad semantics, described in the next row and in items 5, 6 and 14. |
| **Accuracy over speed** | **Gates excellent, surface leaks** | The quote gate, Checking, "said by…" and "a plan, not yet true" are exactly right, and so is "No slips found against N facts" (never "all consistent"). But Needs You asks the writer to answer **That's right** to a horse-trader's lie ("Sex: male (gelding)?"). After the stallion change, the new `Sex: male (stallion)` fact cites the *gelding* line as its source (`canon-map-widget.png`). The entry list also shows `Sex: female (mare)` and `Sex: male (gelding)` side by side as peers. |
| **Seamless, one button** | **Fail as it stands, close to a pass** | The only ways in are a right-click on a shelf *name* or Edit → Continuity Pass. ⌘K "canon" finds nothing useful, and the Keyboard Shortcuts sheet doesn't mention Canon. A fresh library's only shelf is "Works in Progress", so the first Canon a writer keeps is on a status shelf, which the spec explicitly forbids. Download and Read the Shelf are two presses with a "The reader is ready." stop in between. The setup page piles up an empty-state line, the setup copy, a licence and a hand-keeping note. |
| **Offline-first** | **Pass** | Nothing is fetched before Download, and the weights live in userData. The copy is clear: "The reader runs on this computer. Nothing you write is sent anywhere." The resumable, checksummed download and the offline message are good. |
| **IDE for writers** | **Pass in substance, weak on discoverability** | `[[links]]`, Linked from, Mentioned in (reading order), *In this chapter*, ⌘K ("grey mare" → Bramble) and the 2D map all work and look good. The problems: ⌘K, ⌘', ⌘⇧M and ⌥Enter are missing from the shortcuts sheet, ⌘K's fuzzy match returns junk ("canon" → *Română · Spellcheck Language*), and there are no Canon commands to find. |

---

## 2. Prioritised changes

Effort: S = under half a day, M = 1–2 days, L = more.

### Must fix before calling it seamless

1. **Name the shelf, and stop a Canon from landing on a status shelf.** (M)
   *Why:* On a fresh library, ⌘' offers "Keep a Canon for This Shelf" with no shelf named, and the shelf is "Works in Progress". The first unrelated book added later shares Bramble's world.
   *Do:* Name the shelf in every offer: **Keep a Canon for “Works in Progress”**. When the shelf is the default one, or holds more than one book with no shared words in their titles, add the line *"Canon treats every book on this shelf as one world. If this book is its own story, give it a shelf first."* Add a second choice: **Move “{book}” to a New Shelf and Keep a Canon There**. This uses the existing shelf creation and needs no new surface.

2. **One button: Download and read.** (M)
   *Why:* The owner's test is one-button setup. Today it takes Download, then waiting, then a "The reader is ready." page, then **Read the Shelf**.
   *Do:* Label the button **Download and Read the Shelf**, and start reading as soon as the checksum passes, if the shelf has words. Stop Reading is still there. Line: *"When it's here, Canon starts reading — you can keep writing."* "The reader is ready." only appears if the shelf is empty.

3. **Make Canon findable without a right-click.** (S)
   - ⌘K: add commands that aren't in a menu: **Keep a Canon for This Shelf…**, **Read the Shelf**, **New Notebook**, and **Canon** (opens the tab). On a shelf without a Canon, **Continuity Pass** and **World Map** should still appear and explain themselves, as they do now.
   - Keyboard Shortcuts sheet (`bookShortcutSections`): add ⌘K *Go to anything*, ⌘' *Toggle continuity pass*, ⌘⇧M *World Map* and ⌥Enter *Open the slip under the caret*. The tab-cycling line still reads "Manuscript, Notes, Outline, Darlings"; it should include Canon when the tab is shown.
   - This keeps NEO minimal: no new UI, only the two existing reference surfaces made complete.

4. **Rewrite the setup page as one calm stack.** (S)
   *Now* (`shots/fresh/07-canon-tab-first.png`): "Nothing in this Canon yet. Add an entry with + New Entry in the list…", then CANON NEEDS A READER, then the copy, Download, Other choices, "You can keep writing…", "Licence: Apache-2.0", then "Until it's here, keep the Canon by hand…". The "list" it points to is collapsed and can't be seen.
   *Proposed:*
   > **Canon needs a reader**
   > Canon reads your books and notes and keeps track of who and what is in your world — every fact tied to the line that says it. The reader runs on this computer. Nothing you write is sent anywhere.
   > **Careful reader · 2.5 GB** — recommended for this computer
   > [ **Download and Read the Shelf** ]
   > You can keep writing while it downloads. *Other choices*
   > —
   > *No reader yet? Keep it by hand:* [ + New Entry ]
   Move "Licence: Apache-2.0" inside *Other choices*. Drop the "Nothing in this Canon yet" line while the setup page is showing.

5. **Needs You must not ask the writer to approve a liar or a plan.** (S)
   *Now:* "Bramble · Sex: male (gelding)?" with [That's right] [Not right] [Skip], and "Bramble · State: in foal?" with the same buttons.
   *Proposed:* For dialogue, show **"The horse-trader says Bramble is a gelding."** with [**It's true**] [**Only what he says**]. For a plan, show **"A plan: Bramble in foal by the end of book 2."** with [**It's happened**] [**Still a plan**]. The second button in each pair keeps the fact as "said by" or "plan", out of slips and out of the queue for good. Neither button leaves the writer guessing what "right" means.

6. **Keep "said by" and plan facts out of the real facts.** (M)
   *Why:* `canon-tab.png` lists Sex: female (mare) ◆ and Sex: male (gelding) ○ as equals. After the stallion change, `canon-map-widget.png` shows `Sex: male (stallion)` citing *"That's no mare, that's a gelding"*. That turns a lie into evidence, which is exactly what the pillar forbids.
   *Do:* Never merge a dialogue or plan source into a firm fact's sources. On the entry page, fold such facts under a quiet sub-head **What others say · Plans** below Facts. `replaceFact` should carry only the writer's own and checked sources across.

7. **Prove the careful reader before launch.** (L)
   *Why:* Pillar 3. The recommended reader has never been scored on the fixture, and the timing ("about 40 minutes" in the spec) has only been measured on the quick model at about 15 s per call.
   *Do:* Run `CANON_REAL=1` with Qwen3-4B on the full fixture and on one real 80–100k-word manuscript. Record precision and recall on the five P0 slips and six decoys, and wall-clock time on an 8 GB and a 16 GB laptop. Gate the release on P0 #13 *with the real reader*, not the fake one. If the careful reader is slower than about 2 h per 100k words, say so before the read (item 12).

### High impact, small

8. **Show the exact change on the popover's first button.** (S)
   *Now:* **Keep: mare** → then a preview "~~his~~ **her**" → **Apply**. "Keep: mare" reads as "keep the word mare".
   *Proposed:* Make the button **his → her**. Pressing it applies the change as one ⌘Z-able edit, and the popover closes with *"Changed. ⌘Z brings it back."* The button already shows the exact change, so the pillar ("confirming that exact change") still holds, and the writer saves a click on the most common action. If you want to keep two steps, label the button **Make it “her”…** instead.

9. **Don't guess "stallion" from a pronoun.** (S) On a "his" slip, "Bramble is now a stallion…" picks a specific word the text never used (a gelding is also "his"). For pronoun slips, offer **Bramble is now male…** and ask "Stallion, gelding, or just male?" inside the confirmation. Keep "Bramble is now a stallion…" for noun slips ("the old stallion").

10. **Platform-correct keys and a findable restore point.** (S) "Before the first change in each book, NEO takes a snapshot of it: ⌘Z or Snapshots → Restore brings it back." The ⌘ is hard-coded on Windows and Linux, and writers don't know where Snapshots live. Proposed: wrap it in `K()`, and use **"NEO snapshots each book before its first change. Undo with ⌘Z (Ctrl+Z), or restore from Darlings → Snapshots."**

11. **Tighten ⌘K fuzzy matching.** (S) "canon" currently returns *Română · Spellcheck Language* (a subsequence scattered across the menu path). Subsequence matches should only count within one word or label, never across the › path, and should only show when nothing better scores. Otherwise show "Nothing matches “canon”." honestly. Never let a stray subsequence be the top row.

12. **Say how long reading takes before the writer presses the button.** (S/M) The spec said: "On this computer that takes about 40 minutes." Today there is no estimate until three calls have run. Use a per-tier words-per-minute figure measured in item 7, refined after three calls: **"Canon will read 2 books and 1 notebook (112,400 words) — about 2 hours on this computer. You can keep writing; Canon steps aside whenever you type."**

13. **Say concretely what's checked without a reader.** (S) "Without Canon's reader, only the plainest slips are checked." is vague. Proposed: **"Without the reader, Canon catches what's spelt out — a name, “mare”, “grey eyes”. Who “he” or “she” means needs the reader."** Note that "his" was in fact caught in my no-reader run, so first confirm what the rule checker reliably covers and word it to match.

14. **Make relationship values say who is what.** (S/M)
   - `Sibling: Oren Hale (younger)` is ambiguous about who is younger. Proposed: **Sibling: Oren Hale · she's the younger**, or a label of **Older brother: Oren Hale**.
   - `Sex: female (sister)` is an odd as-written word. Show "(sister)" only when the word is a sex word for a creature ("mare"); for a person show **Sex: female**.
   - The *In this chapter* hover reads "horse · Tamsin Hale · stallion". Proposed: **"Horse · stallion · Tamsin Hale's"** (labels for relations only).

15. **Use one voice for "you".** (S) The same idea appears as "Written in Canon", "You wrote this in Canon.", "and by you", "You wrote this" and *yours*. Proposed: use **"You, in Canon"** as the source label, "You wrote this." as the dot tooltip, and in the popover **"Established in Ember and Thorn, Ch 2 · Field Notes, Horses · and in your Canon"**.

16. **Match the list name to the button.** (S) The button is **Not a slip**, but the list is **Dismissed (n)**. Rename the list **Not Slips (n)**, so the writer can see where the dismissed lines went (this follows NEO's rule that removed things say where they are).

17. **Fix the popover's manners.** (S) It opens over the lines below, so it covers the next two marks (`08c-popover-no-reader.png`), and its three buttons wrap onto two rows (`canon-slip-popover.png`). Place it above the line when more marks sit below. Set it 10–20 px wider, or use the shorter labels from items 8 and 9, so the buttons fit on one row.

18. **Land the pass on the writer's page.** (S) Starting a Continuity Pass from another tab opens the Manuscript at the **title page**, so no marks are visible (`08c` first attempt, `canon-review-changes.png`). Keep the last caret position. If the caret's chapter has no slips, scroll to the first slip and leave the caret alone.

19. **Empty Canon tab: make the action visible.** (S) "Add an entry with + New Entry in the list" points at a collapsed pane. Put an inline **+ New Entry** link in the sentence, or open the nav pane on the first visit to the tab only.

20. **Handle "a/an" in the generated sentences.** (S) `{name} is a {word}.` and `{name} is now a {word}…` are fixed strings. "Tamsin is now a aunt…" is reachable because `canonIsNow` uses `as` for any kind, and species lexicons will grow (elf, owl). Put the article in the translated value, or use a small `article(word)` helper in English only.

### Minimalism checks

21. **Hide Canon menu items until a shelf keeps a Canon.** (S) Every writer sees **Check Continuity When I Pause** in the Edit menu, even with no Canon anywhere, which goes against P0 #1 ("visually unchanged"). Keep **Continuity Pass**, because it explains and offers Canon. Hide the pause checkbox until a shelf keeps one.

22. **Keep the 3D map a toggle and never the default.** (S, decision) 2D answers "who is tied to whom". 3D is a delight, not a tool. It already sits behind a toggle; don't promote it in copy or in ⌘K.

23. **Rename to NEO Canon without overloading "Canon".** (S, decision) The app becomes *NEO Canon*, while each shelf *keeps a Canon*. Use "NEO Canon" only in the window title, About, installer and website. Inside the app, "Canon" stays the per-shelf record ("Keep a Canon for “The Ashfall Road”"). Avoid phrasing like "NEO Canon's Canon".

24. **Make notebooks findable.** (S) New Notebook only exists on the right-click of the shelf's +. Add it to ⌘K (item 3). When a shelf keeps a Canon, mention it once in the Canon tab's empty state: *"World-building notes? Right-click + on the shelf → New Notebook."*

25. **Remove the Canon tab's duplicate heading.** (S, polish) Every Canon page carries a small-caps **CANON** title above the entry name, even though the tab already says Canon. On an entry, drop it, or show the shelf instead ("THE ASHFALL ROAD").

---

## 3. Delightful: must not be lost

- **The hand-kept Canon catches the horse with no model.** One typed `Sex: mare` flagged *his*, *old stallion* and *gelding* offline, with no download. This is the strongest proof of pillars 1, 2 and 5. Lead the marketing with it.
- **The popover's grammar.** "**Bramble is a mare.** Established in *Ember and Thorn*, Ch 2 · Field Notes, Horses — “Bramble, the grey mare, would not cross the ford.” Here, “his” seems to mean Bramble." It is calm, cited and verbatim, and it never says "error".
- **Honest copy.** "No slips found against 214 facts." (not "consistent"); "said by the horse-trader"; "a plan, not yet true"; "This passage has changed"; "Paused while you write. Canon carries on after ten seconds of quiet."; "Got it. Canon won't flag this line again."
- **Review Changes.** The strikethrough-to-bold diff per passage, "Needs your words — open the passage.", one snapshot per book *before* the first change, ⌘Z returning an item to the list, and Apply All Shown appearing only once the writer has seen everything.
- **Nothing while typing.** Marks use the Highlight API, quiet checks wait 90 s, and the reader pauses on the first key. Keep P0 #8 sacred.
- **Entries as plain Markdown, one file each**, readable in any editor. *In my words* is the writer's alone.
- **The notebook tile**: the cloth, band and ribbon make it clear at a glance, and a notebook needs no new concept.
- **In this chapter** (who and what is here, with the caret's paragraph in the accent colour). **Mentioned in**, in reading order. **Linked from** with renames that keep links working.
- **The 2D map in light theme** (`canon-map-2d-light.png`): a calm, legible, real map of the world. It needs no three.js, works offline and isn't animated when idle.
- **British, warm, unbranded language**: "the reader", never "AI" or "model"; "spelt"; "Licence"; "Set aside", never "delete".
