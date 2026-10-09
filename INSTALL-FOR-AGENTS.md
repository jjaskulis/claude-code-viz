# Installing viz (for coding agents)

Follow these steps in order. Stop and report if a check fails. Do not
overwrite the user's existing settings: every edit below merges.

Pick the install folder once and use it everywhere. Default: `~/.claude/viz`.

## 1. Check the tools

```sh
node --version && command -v dot rsvg-convert
```

- `node` is required for all steps.
- `dot` (Graphviz) and `rsvg-convert` (librsvg) are needed only for `graph`,
  `types` and `chart` blocks. If missing, ask the user before installing
  (`brew install graphviz librsvg`, or `sudo apt install graphviz librsvg2-bin`).
  Text blocks work without them.

## 2. Clone and install

```sh
git clone https://github.com/jjaskulis/claude-code-viz ~/.claude/viz
cd ~/.claude/viz/renderers && npm install
```

`npm install` prints a warning that `canvas` has a pending install script. It
is safe to ignore: charts render without it. Do not run `npm approve-scripts`.

## 3. Verify the install

```sh
cd ~/.claude/viz
claude plugin validate .      # passes; a "no marketplace install line" warning is expected
claude plugin test .          # expect: 35 pass, 0 fail
echo '{"data":{"values":[{"a":"x","b":1}]},"mark":"bar","encoding":{"x":{"field":"a","type":"nominal"},"y":{"field":"b","type":"quantitative"}}}' > /tmp/viz-smoke.vl.json
renderers/node_modules/.bin/vl2svg /tmp/viz-smoke.vl.json /tmp/viz-smoke.svg && echo chart-ok
```

## 4. Load the mod in every session

Merge this key into `~/.claude/settings.json`, keeping everything else. Create
the file as `{}` first if it does not exist.

```sh
node -e '
const fs=require("fs"),p=require("os").homedir()+"/.claude/settings.json";
let s={};try{s=JSON.parse(fs.readFileSync(p,"utf8"))}catch(e){if(e.code!=="ENOENT")throw e}
s.env=s.env||{};
if(s.env.CLAUDE_CODE_PLUGIN_DIRS&&s.env.CLAUDE_CODE_PLUGIN_DIRS!=="~/.claude/viz"){
  console.error("CLAUDE_CODE_PLUGIN_DIRS is already set to "+s.env.CLAUDE_CODE_PLUGIN_DIRS+": ask the user how to combine them");process.exit(1)}
s.env.CLAUDE_CODE_PLUGIN_DIRS="~/.claude/viz";
fs.writeFileSync(p,JSON.stringify(s,null,2)+"\n")'
```

If the script exits with the "already set" message, do not change the value:
ask the user how to combine the folders.

## 5. Teach Claude the language

Without this, Claude never writes `viz` blocks. Append this line to
`~/.claude/CLAUDE.md` if it is not already there (create the file if needed):

```sh
grep -qxF '@~/.claude/viz/VOCABULARY.md' ~/.claude/CLAUDE.md 2>/dev/null || printf '\n@~/.claude/viz/VOCABULARY.md\n' >> ~/.claude/CLAUDE.md
```

To teach one project only, put the same line in that project's `CLAUDE.md`.

## 6. Tell the user what is left

Both settings take effect in a **new** Claude Code session, so you cannot
verify them from this one. Tell the user to start a new session and ask:
"compare Redis and Postgres as a queue". A drawn comparison means it works; raw
JSON means the `CLAUDE.md` import loaded but the mod did not (recheck step 4).

Pictures (`graph`, `chart`, `types`) also need a terminal with the kitty
graphics protocol, such as Ghostty or kitty. In Ghostty, see "Known quirks" in
the README. Elsewhere they fall back to dot source and a data table.
