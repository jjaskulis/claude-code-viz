# viz

A Claude Code mod that draws structure in the model's replies instead of
leaving it as text. The model writes a fenced ```viz block holding one JSON
object; the mod draws it in place of the block.

| Type | What it draws | How |
| --- | --- | --- |
| `compare` | options side by side against criteria, best values and a pick marked | Box and Text |
| `timeline` | ordered steps with done / active / todo / blocked | Box and Text |
| `tree` | flat file paths as a directory tree with change marks | Box and Text |
| `graph` | Graphviz `dot` source as a diagram | `dot` → PNG → Image |
| `chart` | a Vega-Lite spec with inline data | `vl2svg` → `rsvg-convert` → PNG → Image |

While a block streams in, the mod holds it back so raw JSON never shows, and the
spinner says what it is drawing. Pictures use the terminal's dark colors on a
transparent background (`THEME` in `hooks/graph.ts`). Where a surface cannot
show a picture, a graph shows its dot source and a chart its data as a table.

## Requirements

- Claude Code with mods (function hooks); built against 2.1.289
- Graphviz (`dot`) and librsvg (`rsvg-convert`) on the PATH, e.g. `brew install graphviz librsvg`
- Node.js, for the chart renderer
- For pictures: a terminal with the kitty graphics protocol (Ghostty, kitty)

## Install

```sh
git clone <this repo> ~/Dev/personal/viz-mod
cd ~/Dev/personal/viz-mod/renderers && npm install
```

Load it in every session through the `env` block of `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/Dev/personal/viz-mod" } }
```

Teach the model the blocks by importing the vocabulary from `~/.claude/CLAUDE.md`
(a mod's own system-prompt hooks can be blocked by managed policy):

```
@~/Dev/personal/viz-mod/VOCABULARY.md
```

## Known quirks

- Claude Code keeps images off until the terminal confirms kitty graphics, which
  did not happen in Ghostty here. The undocumented `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1`
  turns them on; set it only for Ghostty (`env = CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1`
  in the Ghostty config). A session handed out by Claude Code's background daemon
  keeps the daemon's environment, so start `claude` directly in the terminal.
- The engine follows `$` only into functions of the hooks module's own file, so
  everything that calls `$` lives in `hooks/register.tsx`.

## Develop

```sh
claude plugin validate .
claude plugin test .
npx -p typescript@5 tsc -p .
```
