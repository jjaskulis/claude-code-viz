# Readability check

Does a reply with viz blocks help a developer understand faster than the
same reply in plain text? This file records the method and the scores only:
the questions are about a private work codebase, so neither its code nor the
answers are kept here.

## Method

- Four real questions about a codebase the reader knows well, one per kind of
  understanding: explain a function, follow a flow, relate parts, choose an
  option for a change.
- Each answered twice from the same research: plain text and with viz blocks.
  Same facts; only the form differs. Shown in random order (A/B), the reader
  not told which is which.
- Per pair, the reader rates each version 1-5 for how quickly it made sense,
  picks the one understood faster, and answers one factual check question.

## Runs

### 2026-10-05 (viz-mod at the commit that added `trace` phases)

| # | Kind | Blocks used | A was | Rating A | Rating B | Faster | Check right? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | explain a function | code (5 notes) | plain | 1 | 4 | B (viz) | no, but the question was unclear (its scenario lived in code outside the codebase) | plain: "I need to really concentrate trying to read that" |
| 2 | follow a flow | trace (15 steps, 2 phases) | plain | not rated ("really hard to parse") | 3-4 | B (viz) | yes | viz helps through less text, a visible shape of the process, and file names; asked for function or class names per step |
| 3 | relate parts | graph (9 nodes) + tree | plain | 2 | 3 | B (viz), narrowly | partly (got where parts register, missed what hides them per run) | the plain version's explanation helped; the diagram showed the shape but not containment (a helper drawn as a separate box though it is defined inside the factory next to it) |
| 4 | choose an option | compare + code (2 notes) | viz | 4 | 2 | A (viz) | yes | |

#### What it says

- The visual version was preferred on all four: ratings 4, 3-4, 3, 4 against 1, unrated ("really hard to parse"), 2, 2 for plain.
- What helped, in the reader's words: less text, a structure that shows the shape of the process, and file names showing where things happen.
- `code` with pinned notes and `compare` scored highest (4). The relation diagram scored lowest (3): it showed the flow between parts but not what is nested in what, and a few sentences of prose carried insight the diagram did not.
- Check questions: 2 right, 1 partly, 1 wrong (an unclear question). With both versions read, they show the reader took the answer in, not which version did it.

#### Caveats

One reader, one codebase, not blind (the visual version is obvious at a glance), both versions written by the same model, and the plain versions were dense. Read as direction, not proof.

#### Changes it suggests

1. Relation diagrams: draw containment with clusters (package, file, function) and pair the diagram with two or three sentences.
2. `trace`: an optional function or class name per step, shown beside its place.
3. Even plain answers should be shorter: the dense numbered paragraphs were the hardest to read.

