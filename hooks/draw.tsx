// Draws each viz block from Box and Text, which every surface has; a graph
// or chart block is a picture where the surface has Image (the terminal),
// and elsewhere its dot source as code or its data as a table.

import type { ElementTable, RenderElement } from 'claude-code'

import { CELL_PX, NOTE, schemaToDot } from './graph'
import type { Loaded, Rendered } from './graph'
import { nest, parseAt } from './parse'
import type {
  Chart,
  Compare,
  Graph,
  Node,
  Schema,
  Segment,
  Sequence,
  SequenceKind,
  Snippet,
  Status,
  Timeline,
  Trace,
  TraceKind,
  Tree,
} from './parse'

type Els = Pick<ElementTable, 'Box' | 'Text' | 'Markdown' | 'Code'> & {
  Image?: ElementTable<'terminal'>['Image']
}

// What the render hook fetches for a block: a graph or chart's picture, a
// code block's lines; each pending, ready or failed.
export type Lookups = {
  picture: (block: Graph | Chart) => Rendered
  snippet: (block: Snippet) => Loaded
  note: (n: number, text: string, columns: number) => Rendered
}

const ACCENT = 'cyan'
const GOOD = 'green'

export const drawSegments = (els: Els, segments: Segment[], columns: number, lookups: Lookups): RenderElement => {
  const { Box } = els

  return (
    <Box flexDirection="column" gap={1}>
      {segments.map((s, i) => drawSegment(els, s, columns, lookups, `seg:${i}`))}
    </Box>
  )
}

const drawSegment = (els: Els, s: Segment, columns: number, lookups: Lookups, key: string): RenderElement => {
  const { Box, Text, Markdown } = els

  if (s.kind === 'markdown') return <Markdown key={key} text={s.text} />

  if (s.kind === 'pending') {
    return (
      <Text dimColor italic>
        ◌ drawing {s.hint}…
      </Text>
    )
  }

  if (s.kind === 'broken') {
    return (
      <Box flexDirection="column">
        <Markdown key={key} text={s.source} />
        <Text dimColor>viz: {s.reason}, shown as text</Text>
      </Box>
    )
  }

  // Inside the frame: two border columns and one of padding each side.
  const inner = Math.max(20, columns - 4)
  const body =
    s.viz.type === 'compare'
      ? drawCompare(els, s.viz, inner)
      : s.viz.type === 'timeline'
        ? drawTimeline(els, s.viz, inner)
        : s.viz.type === 'graph' || s.viz.type === 'chart'
          ? drawPicture(els, s.viz, inner, lookups.picture(s.viz))
          : s.viz.type === 'code'
            ? drawSnippet(els, s.viz, lookups.snippet(s.viz), inner, lookups.note)
            : s.viz.type === 'trace'
              ? drawTrace(els, s.viz, inner, lookups.snippet)
              : s.viz.type === 'sequence'
                ? drawSequence(els, s.viz, inner)
                : s.viz.type === 'schema'
                  ? drawSchema(els, s.viz, inner, lookups.picture)
                  : drawTree(els, s.viz)

  return (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      {s.viz.title !== undefined && (
        <Box marginBottom={1}>
          <Text bold color={ACCENT}>
            {s.viz.title}
          </Text>
        </Box>
      )}
      {body}
    </Box>
  )
}

// compare: options as columns, criteria as rows, the best cell of each row
// and the picked option marked; stacked cards when the columns would be too
// narrow to read.
const drawCompare = (els: Els, c: Compare, width: number): RenderElement => {
  const { Box, Text } = els
  const labelWidth = Math.min(22, Math.max(...c.criteria.map(r => r.name.length)) + 2)
  const optionWidth = Math.floor((width - labelWidth) / c.options.length)
  const isPick = (i: number) => c.pick === i

  const verdict = c.pick !== undefined && c.options[c.pick] !== undefined && (
    <Box marginTop={1}>
      <Text>
        <Text bold color={GOOD}>
          → {c.options[c.pick]}
        </Text>
        {c.why !== undefined && <Text>  {c.why}</Text>}
      </Text>
    </Box>
  )

  if (optionWidth < 14) {
    return (
      <Box flexDirection="column" gap={1}>
        {c.options.map((option, i) => (
          <Box flexDirection="column">
            <Text bold color={isPick(i) ? GOOD : undefined}>
              {isPick(i) ? '✓ ' : '  '}
              {option}
            </Text>
            {c.criteria.map(row => (
              <Text>
                <Text dimColor>  {row.name}: </Text>
                <Text color={row.best === i ? GOOD : undefined} bold={row.best === i}>
                  {row.values[i]}
                </Text>
              </Text>
            ))}
          </Box>
        ))}
        {verdict}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Box width={labelWidth}>
          <Text> </Text>
        </Box>
        {c.options.map((option, i) => (
          <Box width={optionWidth} paddingRight={1}>
            <Text bold color={isPick(i) ? GOOD : undefined}>
              {isPick(i) ? '✓ ' : ''}
              {option}
            </Text>
          </Box>
        ))}
      </Box>
      <Text dimColor>{'─'.repeat(Math.max(1, labelWidth + optionWidth * c.options.length - 1))}</Text>
      {c.criteria.map(row => (
        <Box flexDirection="row">
          <Box width={labelWidth}>
            <Text dimColor>
              {row.name}
            </Text>
          </Box>
          {row.values.map((value, i) => (
            <Box width={optionWidth} paddingRight={1}>
              <Text color={row.best === i ? GOOD : undefined} bold={row.best === i}>
                {row.best === i ? '▲ ' : ''}
                {value}
              </Text>
            </Box>
          ))}
        </Box>
      ))}
      {verdict}
    </Box>
  )
}

const GLYPH: Record<Status, { mark: string; color: string; strip: string }> = {
  done: { mark: '✔', color: GOOD, strip: '■' },
  active: { mark: '▶', color: ACCENT, strip: '■' },
  blocked: { mark: '✖', color: 'red', strip: '■' },
  todo: { mark: '○', color: 'gray', strip: '□' },
}

// timeline: a one-line progress strip, then the steps on a rail.
const drawTimeline = (els: Els, t: Timeline, width: number): RenderElement => {
  const { Box, Text } = els
  const done = t.steps.filter(s => s.status === 'done').length

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text>
          {t.steps.map(s => (
            <Text color={GLYPH[s.status].color}>{GLYPH[s.status].strip} </Text>
          ))}
          <Text dimColor>
            {' '}
            {done}/{t.steps.length} done
          </Text>
        </Text>
      </Box>
      {t.steps.map((s, i) => {
        const g = GLYPH[s.status]
        const isLast = i === t.steps.length - 1

        return (
          <Box flexDirection="row">
            <Box flexDirection="column" width={2}>
              <Text color={g.color} bold>
                {g.mark}
              </Text>
              {!isLast && <Text dimColor>│</Text>}
            </Box>
            <Box flexDirection="column" width={Math.max(10, width - 2)}>
              <Text
                bold={s.status === 'active'}
                dimColor={s.status === 'todo'}
                color={s.status === 'blocked' ? 'red' : undefined}
              >
                {s.label}
              </Text>
              {s.detail !== undefined && <Text dimColor>{s.detail}</Text>}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

const CHANGE = {
  add: { mark: '+', color: GOOD },
  edit: { mark: '~', color: 'yellow' },
  del: { mark: '-', color: 'red' },
} as const

// tree: flat paths drawn as a directory tree with change marks and notes.
const drawTree = (els: Els, t: Tree): RenderElement => {
  const { Box, Text } = els
  const count = (change: keyof typeof CHANGE) => t.items.filter(i => i.change === change).length
  const lines: RenderElement[] = []

  const walk = (nodes: Node[], prefix: string) => {
    nodes.forEach((node, i) => {
      const isLast = i === nodes.length - 1
      const isDir = node.children.length > 0
      const change = node.change !== undefined ? CHANGE[node.change] : undefined

      lines.push(
        <Text>
          <Text dimColor>
            {prefix}
            {isLast ? '└─ ' : '├─ '}
          </Text>
          {change !== undefined && (
            <Text color={change.color} bold>
              {change.mark}{' '}
            </Text>
          )}
          <Text
            bold={isDir}
            color={isDir ? 'blue' : change?.color}
            strikethrough={node.change === 'del'}
          >
            {node.name}
            {isDir ? '/' : ''}
          </Text>
          {node.note !== undefined && <Text dimColor>  {node.note}</Text>}
        </Text>,
      )
      walk(node.children, prefix + (isLast ? '   ' : '│  '))
    })
  }
  walk(nest(t.items), '')

  const tally = (['add', 'edit', 'del'] as const)
    .filter(c => count(c) > 0)
    .map(c => (
      <Text color={CHANGE[c].color}>
        {CHANGE[c].mark}
        {count(c)}{' '}
      </Text>
    ))

  return (
    <Box flexDirection="column">
      {lines}
      {tally.length > 0 && (
        <Box marginTop={1}>
          <Text>{tally}</Text>
        </Box>
      )}
    </Box>
  )
}

// A terminal cell is about half as wide as it is tall; at 144 dpi a cell
// spans about 14 pixels of the picture.
const CELL_ASPECT = 0.5
const PIXELS_PER_COLUMN = 14
const MAX_ROWS = 40

// graph and chart: the rendered picture, sized to its own aspect within the
// room; where there is no picture, what the block holds as text.
const drawPicture = (
  els: Els,
  block: Graph | Chart,
  width: number,
  rendered: Rendered,
  fallback?: RenderElement,
): RenderElement => {
  const { Box, Text, Code, Image } = els
  const noun = block.type === 'graph' ? 'diagram' : 'chart'

  if (rendered.kind === 'pending') {
    return (
      <Text dimColor italic>
        ◌ rendering {noun}…
      </Text>
    )
  }

  if (rendered.kind === 'failed' || Image === undefined) {
    return (
      <Box flexDirection="column">
        {fallback ?? (block.type === 'graph' ? <Code source={block.dot} language="dot" /> : drawChartData(els, block))}
        {rendered.kind === 'failed' && (
          <Text dimColor>
            {block.type}: {rendered.reason}
          </Text>
        )}
      </Box>
    )
  }

  const ratio = rendered.height / rendered.width
  let columns = Math.max(10, Math.min(width, Math.ceil(rendered.width / PIXELS_PER_COLUMN)))
  let rows = Math.max(1, Math.round(columns * ratio * CELL_ASPECT))
  if (rows > MAX_ROWS) {
    rows = MAX_ROWS
    columns = Math.max(10, Math.round(rows / ratio / CELL_ASPECT))
  }

  return (
    <Box flexDirection="column">
      <Image
        source={{ png: rendered.png }}
        columns={columns}
        rows={rows}
        alt={`[${noun}${block.title !== undefined ? `: ${block.title}` : ''}: this terminal shows no images]`}
      />
      {rendered.warning !== undefined && (
        <Text dimColor>
          {block.type}: {rendered.warning}
        </Text>
      )}
    </Box>
  )
}

const TABLE_COLUMNS = 5
const TABLE_ROWS = 10
const CELL_WIDTH = 16

// A chart without its picture: the first rows of its inline data.
const drawChartData = (els: Els, chart: Chart): RenderElement => {
  const { Box, Text } = els
  const data = chart.spec.data
  const values =
    typeof data === 'object' && data !== null && 'values' in data && Array.isArray(data.values)
      ? data.values.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
      : []

  if (values.length === 0) return <Text dimColor>chart: no picture on this surface, and no inline rows to list</Text>

  const fields = Object.keys(values[0] ?? {}).slice(0, TABLE_COLUMNS)
  const cell = (value: unknown) => String(value ?? '').slice(0, CELL_WIDTH - 1)

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        {fields.map(field => (
          <Box width={CELL_WIDTH}>
            <Text bold>{cell(field)}</Text>
          </Box>
        ))}
      </Box>
      {values.slice(0, TABLE_ROWS).map(row => (
        <Box flexDirection="row">
          {fields.map(field => (
            <Box width={CELL_WIDTH}>
              <Text>{cell(row[field])}</Text>
            </Box>
          ))}
        </Box>
      ))}
      {values.length > TABLE_ROWS && <Text dimColor>… {values.length - TABLE_ROWS} more rows</Text>}
    </Box>
  )
}

// ① to ⑳, then (21) and on.
const mark = (n: number): string => (n >= 1 && n <= 20 ? String.fromCodePoint(0x245f + n) : `(${n})`)

// A note's indent under the code; where a text note's marker ends and its
// text begins ("  ↳ ① ").
const NOTE_LEFT = 2
const NOTE_INDENT = 6
const NOTE_TINT = '#2a2418'

// code: the lines with the engine's highlighter, cut after each line a note
// points at so the note sits right under it; numbering runs on across cuts.
// A note is prose in a reading font where the terminal shows pictures, and
// tinted italic text elsewhere (and until its picture is ready).
const drawSnippet = (
  els: Els,
  s: Snippet,
  loaded: Loaded,
  width: number,
  noteLookup: Lookups['note'],
): RenderElement => {
  const { Box, Text, Code, Image } = els
  const imageColumns = Math.max(20, width - NOTE_LEFT)
  const textColumns = Math.max(20, width - NOTE_INDENT)

  const drawNote = (n: number, text: string): RenderElement => {
    const rendered = Image !== undefined ? noteLookup(n, text, imageColumns) : undefined

    // The picture carries its own numbered badge.
    if (Image !== undefined && rendered?.kind === 'ready') {
      return (
        <Box paddingLeft={NOTE_LEFT}>
          <Image
            source={{ png: rendered.png }}
            columns={imageColumns}
            rows={rendered.height / CELL_PX.height}
            alt={`${n}. ${text}`}
          />
        </Box>
      )
    }

    return (
      <Box flexDirection="row">
        <Box width={NOTE_INDENT}>
          <Text color={NOTE.color} bold>
            {'  '}↳ {mark(n)}
          </Text>
        </Box>
        <Box width={textColumns} backgroundColor={NOTE_TINT} paddingX={1}>
          <Text italic color={NOTE.color}>
            {text}
          </Text>
        </Box>
      </Box>
    )
  }
  const where =
    s.path !== undefined ? `${s.path}:${s.start ?? 1}${s.end !== undefined ? `–${s.end}` : ''}` : undefined

  const header = where !== undefined && (
    <Text dimColor>
      {where}
      {s.source === undefined ? '  (read from disk)' : ''}
    </Text>
  )

  if (loaded.kind === 'pending') {
    return (
      <Box flexDirection="column">
        {header}
        <Text dimColor italic>
          ◌ reading {s.path}…
        </Text>
      </Box>
    )
  }

  if (loaded.kind === 'failed') {
    return (
      <Box flexDirection="column">
        {header}
        <Text color="red">code: {loaded.reason}</Text>
      </Box>
    )
  }

  const lines = loaded.text.split('\n')
  const first = loaded.start
  const last = first + lines.length - 1
  const notes = (s.notes ?? []).map((note, i) => ({ ...note, n: i + 1 })).sort((a, b) => a.line - b.line)
  const shown = notes.filter(note => note.line >= first && note.line <= last)
  const outside = notes.filter(note => note.line < first || note.line > last)

  const parts: RenderElement[] = []
  let at = first
  const code = (from: number, to: number) => (
    <Code
      source={lines.slice(from - first, to - first + 1).join('\n')}
      startLine={from}
      language={s.language}
      path={s.path}
    />
  )

  for (const line of [...new Set(shown.map(note => note.line))]) {
    if (line >= at) parts.push(code(at, line))
    at = Math.max(at, line + 1)
    for (const note of shown.filter(n => n.line === line)) parts.push(drawNote(note.n, note.text))
  }
  if (at <= last) parts.push(code(at, last))

  return (
    <Box flexDirection="column">
      {header}
      {parts}
      {loaded.isCut && <Text dimColor>… cut at {lines.length} lines</Text>}
      {outside.map(note => (
        <Text dimColor>
          {mark(note.n)} line {note.line} is outside the snippet: {note.text}
        </Text>
      ))}
    </Box>
  )
}

const STEP: Record<TraceKind, { mark: string; color: string; label?: string }> = {
  call: { mark: '●', color: ACCENT },
  async: { mark: '◌', color: ACCENT, label: 'async' },
  effect: { mark: '◆', color: NOTE.color, label: 'effect' },
  return: { mark: '↩', color: 'gray' },
}

// Below this many columns a step's place goes under its text, not beside it.
const TRACE_SIDE_BY_SIDE = 72

const STEP_KEY: Record<TraceKind, string> = {
  call: 'call',
  async: 'runs later',
  effect: 'side effect',
  return: 'returns',
}

// The folder every path shares, as whole segments ("" when none).
const sharedFolder = (paths: string[]): string => {
  const split = paths.map(path => path.split('/').slice(0, -1))
  const first = split[0] ?? []
  let n = 0
  while (n < first.length && split.every(parts => parts[n] === first[n])) n += 1
  return first.slice(0, n).join('/')
}

// Lines with their shared leading whitespace taken off.
const dedent = (text: string): string => {
  const lines = text.split('\n')
  const indents = lines.filter(line => line.trim() !== '').map(line => /^[ \t]*/.exec(line)?.[0].length ?? 0)
  const cut = indents.length > 0 ? Math.min(...indents) : 0
  return lines.map(line => line.slice(cut)).join('\n')
}

// The call-tree guides before each step, as `tree` draws them: for each
// level above the step a bar where that level goes on below, then the
// step's own branch. A phase starts a fresh tree.
const treeGuides = (depths: number[], phaseStarts: boolean[]): { branch: string; under: string }[] => {
  const goesOn = (i: number, depth: number): boolean => {
    for (let j = i + 1; j < depths.length; j += 1) {
      if (phaseStarts[j]) return false
      const d = depths[j] ?? 0
      if (d < depth) return false
      if (d === depth) return true
    }
    return false
  }
  const ancestor = (i: number, depth: number): number => {
    for (let j = i - 1; j >= 0; j -= 1) {
      if ((depths[j] ?? 0) === depth) return j
      if (phaseStarts[j]) break
    }
    return -1
  }

  return depths.map((depth, i) => {
    let lead = ''
    for (let level = 1; level < depth; level += 1) {
      const a = ancestor(i, level)
      lead += a >= 0 && goesOn(a, level) ? '│  ' : '   '
    }
    if (depth === 0) return { branch: '', under: '' }
    const more = goesOn(i, depth)
    return { branch: lead + (more ? '├─ ' : '└─ '), under: lead + (more ? '│  ' : '   ') }
  })
}

// trace: one line per step: its number, call-tree guides, its kind, what
// happens, and where: the function, then the place (the folder all steps
// share said once, above). A phase
// heading marks a new stretch of time; a step's own lines from disk sit
// under it, dedented, behind a thin bar; a key names the marks in use.
const drawTrace = (els: Els, t: Trace, width: number, snippet: Lookups['snippet']): RenderElement => {
  const { Box, Text, Code } = els
  const places = t.steps.map(step => parseAt(step.at))
  const folder = sharedFolder(places.flatMap(place => (place !== undefined ? [place.path] : [])))
  const short = (path: string) => (folder !== '' ? path.slice(folder.length + 1) : path)
  const isSideBySide = width >= TRACE_SIDE_BY_SIDE
  const numberWidth = String(t.steps.length).length + 1
  const depths = t.steps.map(step => Math.min(step.depth ?? 0, 6))
  const guides = treeGuides(
    depths,
    t.steps.map((step, i) => i > 0 && step.phase !== undefined),
  )
  const kindsUsed = (['async', 'effect', 'return'] as const).filter(kind => t.steps.some(step => step.kind === kind))

  return (
    <Box flexDirection="column">
      {(folder !== '' || kindsUsed.length > 0) && (
        <Box marginBottom={1} flexDirection="row" justifyContent="space-between">
          <Text dimColor>{folder !== '' ? `in ${folder}/` : ''}</Text>
          {kindsUsed.length > 0 && (
            <Text>
              {kindsUsed.map(kind => (
                <Text>
                  <Text color={STEP[kind].color}>{STEP[kind].mark}</Text>
                  <Text dimColor> {STEP_KEY[kind]}  </Text>
                </Text>
              ))}
            </Text>
          )}
        </Box>
      )}
      {t.steps.map((step, i) => {
        const kind = STEP[step.kind ?? 'call']
        const place = places[i]
        const guide = guides[i] ?? { branch: '', under: '' }
        const where = place !== undefined ? `${short(place.path)}:${place.line}` : step.at
        const placeText = (
          <Text>
            {step.fn !== undefined && <Text color={ACCENT}>{step.fn}</Text>}
            <Text dimColor>
              {step.fn !== undefined ? ' · ' : ''}
              {where}
            </Text>
          </Text>
        )
        const shown =
          place !== undefined && (step.show ?? 0) > 0
            ? snippet({ type: 'code', path: place.path, start: place.line, end: place.line + (step.show ?? 1) - 1 })
            : undefined

        return (
          <Box flexDirection="column">
            {step.phase !== undefined && (
              <Box marginTop={i > 0 ? 1 : 0}>
                <Text color={ACCENT}>── {step.phase} ──</Text>
              </Box>
            )}
            <Box flexDirection="row">
              <Box width={numberWidth} flexShrink={0}>
                <Text dimColor>{i + 1}</Text>
              </Box>
              <Box flexShrink={0}>
                <Text dimColor>{guide.branch}</Text>
              </Box>
              <Box width={2} flexShrink={0}>
                <Text color={kind.color} bold>
                  {kind.mark}
                </Text>
              </Box>
              <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                <Text bold={step.kind === 'effect'} color={step.kind === 'effect' ? NOTE.color : undefined}>
                  {step.what}
                </Text>
                {!isSideBySide && placeText}
              </Box>
              {isSideBySide && (
                <Box flexShrink={0} marginLeft={2}>
                  {placeText}
                </Box>
              )}
            </Box>
            {shown !== undefined && (
              <Box flexDirection="row">
                <Box width={numberWidth} flexShrink={0} />
                <Text dimColor>{guide.under}  ▏</Text>
                {shown.kind === 'ready' ? (
                  <Code source={dedent(shown.text)} path={place?.path} wrap="truncate-end" />
                ) : shown.kind === 'failed' ? (
                  <Text dimColor>
                    couldn't read {place !== undefined ? short(place.path) : step.at}: {shown.reason.replace(/^.*failed: /, '')}
                  </Text>
                ) : (
                  <Text dimColor italic>
                    reading…
                  </Text>
                )}
              </Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

// schema: tables linked field to field, laid out by Graphviz from the block
// (no dot written by the model); without a picture, entities as text.
const drawSchema = (els: Els, s: Schema, width: number, picture: Lookups['picture']): RenderElement => {
  const { Box, Text } = els
  const graph: Graph = { type: 'graph', title: s.title, dot: schemaToDot(s) }
  const asText = (
    <Box flexDirection="column">
      {s.entities.map(entity => (
        <Text>
          <Text bold>{entity.name}</Text>
          <Text dimColor>: </Text>
          {entity.fields.map((field, i) => (
            <Text>
              {i > 0 ? ', ' : ''}
              {field.key !== undefined && <Text color={NOTE.color}>{field.key.toUpperCase()} </Text>}
              {field.name}
              {field.type !== undefined && <Text dimColor> {field.type}</Text>}
            </Text>
          ))}
        </Text>
      ))}
      {(s.relations ?? []).map(relation => (
        <Text dimColor>
          {relation.from} → {relation.to}
          {relation.kind !== undefined ? ` (${relation.kind})` : ''}
          {relation.label !== undefined ? `: ${relation.label}` : ''}
        </Text>
      ))}
    </Box>
  )

  return drawPicture(els, graph, width, picture(graph), asText)
}

type CellStyle = 'space' | 'life' | 'name' | 'label' | 'num' | SequenceKind
type Cell = { ch: string; style: CellStyle }

const ARROW: Record<SequenceKind, { line: string; right: string; left: string }> = {
  call: { line: '─', right: '▶', left: '◀' },
  reply: { line: '╌', right: '▶', left: '◀' },
  async: { line: '─', right: '▷', left: '◁' },
}

// Below this many columns between lifelines a sequence is listed instead.
const SEQUENCE_MIN_SPACING = 8
const SEQUENCE_MAX_SPACING = 32

// sequence: lifelines in columns, one numbered message per two rows (its
// text, then its arrow), drawn from text so it copies and fits any surface.
const drawSequence = (els: Els, s: Sequence, width: number): RenderElement => {
  const { Box, Text } = els
  const n = s.participants.length
  const longest = Math.max(...s.participants.map(p => p.length))
  const margin = Math.ceil(longest / 2)
  const spacing = Math.min(SEQUENCE_MAX_SPACING, Math.floor((width - 1 - 2 * margin) / (n - 1)))

  if (spacing < SEQUENCE_MIN_SPACING || longest > spacing + 2) {
    return (
      <Box flexDirection="column">
        {s.messages.map((m, i) => (
          <Text>
            <Text dimColor>{i + 1}. </Text>
            {m.from} <Text color={m.kind === 'async' ? NOTE.color : ACCENT}>{m.kind === 'reply' ? '⇠' : '→'}</Text> {m.to}
            <Text dimColor>: </Text>
            {m.text}
          </Text>
        ))}
      </Box>
    )
  }

  const centers = s.participants.map((_, i) => margin + i * spacing)
  const total = (centers[n - 1] ?? 0) + margin + 1
  const column = (name: string) => centers[s.participants.indexOf(name)] ?? 0

  const blank = (): Cell[] => {
    const row: Cell[] = Array.from({ length: total }, () => ({ ch: ' ', style: 'space' }))
    for (const c of centers) row[c] = { ch: '│', style: 'life' }
    return row
  }
  const put = (row: Cell[], at: number, text: string, style: CellStyle, max = total - at) => {
    const fitted = text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text
    ;[...fitted].forEach((ch, i) => {
      if (at + i >= 0 && at + i < total) row[at + i] = { ch, style }
    })
  }

  const header: Cell[] = Array.from({ length: total }, () => ({ ch: ' ', style: 'space' }))
  s.participants.forEach((name, i) => {
    const start = Math.min(Math.max(0, (centers[i] ?? 0) - Math.floor(name.length / 2)), total - name.length)
    put(header, start, name, 'name')
  })

  const rows: Cell[][] = [header, blank()]
  s.messages.forEach((m, i) => {
    const kind = m.kind ?? 'call'
    const from = column(m.from)
    const to = column(m.to)
    const number = `${i + 1}. `
    const label = blank()

    if (from === to) {
      put(label, from + 2, `↺ ${number}`, 'num')
      put(label, from + 4 + number.length, m.text, 'label')
      rows.push(label)
      return
    }

    const left = Math.min(from, to)
    const right = Math.max(from, to)
    const room = right - left - 3
    put(label, left + 2, number, 'num', room)
    put(label, left + 2 + number.length, m.text, 'label', Math.max(0, room - number.length))

    const arrow = blank()
    for (let x = left + 1; x < right; x += 1) arrow[x] = { ch: ARROW[kind].line, style: kind }
    if (from < to) arrow[right - 1] = { ch: ARROW[kind].right, style: kind }
    else arrow[left + 1] = { ch: ARROW[kind].left, style: kind }
    rows.push(label, arrow)
  })

  const color: Record<CellStyle, { color?: string; dimColor?: boolean; bold?: boolean }> = {
    space: {},
    life: { dimColor: true },
    name: { bold: true },
    label: {},
    num: { dimColor: true },
    call: { color: ACCENT },
    reply: { color: 'gray' },
    async: { color: NOTE.color },
  }

  // Each row as runs of one style, so a row is a handful of Texts.
  const draw = (row: Cell[]) => {
    const runs: { style: CellStyle; text: string }[] = []
    for (const cell of row) {
      const last = runs[runs.length - 1]
      if (last !== undefined && last.style === cell.style) last.text += cell.ch
      else runs.push({ style: cell.style, text: cell.ch })
    }
    return (
      <Text wrap="truncate-end">
        {runs.map(run => (
          <Text {...color[run.style]}>{run.text}</Text>
        ))}
      </Text>
    )
  }

  return <Box flexDirection="column">{rows.map(draw)}</Box>
}
