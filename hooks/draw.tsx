// Draws each viz block from Box and Text, which every surface has; a graph
// or chart block is a picture where the surface has Image (the terminal),
// and elsewhere its dot source as code or its data as a table.

import type { ElementTable, RenderElement } from 'claude-code'

import type { Loaded, Rendered } from './graph'
import { nest } from './parse'
import type { Chart, Compare, Graph, Node, Segment, Snippet, Status, Timeline, Tree } from './parse'

type Els = Pick<ElementTable, 'Box' | 'Text' | 'Markdown' | 'Code'> & {
  Image?: ElementTable<'terminal'>['Image']
}

// What the render hook fetches for a block: a graph or chart's picture, a
// code block's lines; each pending, ready or failed.
export type Lookups = {
  picture: (block: Graph | Chart) => Rendered
  snippet: (block: Snippet) => Loaded
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
            ? drawSnippet(els, s.viz, lookups.snippet(s.viz))
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
const drawPicture = (els: Els, block: Graph | Chart, width: number, rendered: Rendered): RenderElement => {
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
        {block.type === 'graph' ? <Code source={block.dot} language="dot" /> : drawChartData(els, block)}
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

// code: the lines with the engine's highlighter, cut after each line a note
// points at so the note sits right under it; numbering runs on across cuts.
const drawSnippet = (els: Els, s: Snippet, loaded: Loaded): RenderElement => {
  const { Box, Text, Code } = els
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
    for (const note of shown.filter(n => n.line === line)) {
      parts.push(
        <Box paddingLeft={2}>
          <Text>
            <Text color={ACCENT} bold>
              ↳ {mark(note.n)}{' '}
            </Text>
            <Text color={ACCENT}>{note.text}</Text>
          </Text>
        </Box>,
      )
    }
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
