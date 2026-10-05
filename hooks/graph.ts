// What a graph or chart block's picture is while register.tsx renders it
// (Graphviz, or Vega-Lite through the mod's own vega-cli), and the pure
// pieces of that: where files go, what they are named, a chart's defaults,
// and how big the PNG is. (The engine follows `$` only into functions of the
// hooks module's own file, so the rendering lives there.)

export type Rendered =
  | { kind: 'pending' }
  | { kind: 'ready'; png: string; width: number; height: number; warning?: string }
  | { kind: 'failed'; reason: string }

export const RENDER_DIR = '/tmp/claude-viz-renders'

// The terminal's colors (Ghostty: black at 0.76 opacity, #c4c4c4 text).
// Pictures are transparent so the terminal's own background shows through.
export const THEME = {
  text: '#c4c4c4',
  muted: '#9e9e9e',
  grid: '#3a3a3a',
  frame: '#5a5a5a',
  font: 'Helvetica',
} as const

// Graphviz defaults for the theme; a graph's own attributes still win.
// `color` and `style` are what a cluster's frame takes: what lives inside
// what (package, file, function) is drawn as rounded grey frames.
export const DOT_THEME_ARGS = [
  '-Gbgcolor=transparent',
  `-Gcolor=${THEME.frame}`,
  '-Gstyle=rounded',
  `-Gfontcolor=${THEME.text}`,
  `-Gfontname=${THEME.font}`,
  `-Ncolor=${THEME.muted}`,
  `-Nfontcolor=${THEME.text}`,
  `-Nfontname=${THEME.font}`,
  `-Ecolor=${THEME.muted}`,
  `-Efontcolor=${THEME.text}`,
  `-Efontname=${THEME.font}`,
]

const objectOr = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

// Text sizes, about a third over Vega's defaults (10 for labels, 11 for
// axis titles, 13 for the chart title), so they read at terminal size.
const LABEL_SIZE = 13
const AXIS_TITLE_SIZE = 14
const TITLE_SIZE = 17

// Vega-Lite config for the theme: light text, grey axes and grid.
const CHART_THEME = {
  axis: {
    domainColor: THEME.muted,
    tickColor: THEME.muted,
    gridColor: THEME.grid,
    labelColor: THEME.text,
    titleColor: THEME.text,
    labelFontSize: LABEL_SIZE,
    titleFontSize: AXIS_TITLE_SIZE,
  },
  title: { color: THEME.text, subtitleColor: THEME.muted, fontSize: TITLE_SIZE, subtitleFontSize: LABEL_SIZE },
  legend: { labelColor: THEME.text, titleColor: THEME.text, labelFontSize: LABEL_SIZE, titleFontSize: LABEL_SIZE },
  header: { labelColor: THEME.text, titleColor: THEME.text, labelFontSize: LABEL_SIZE, titleFontSize: AXIS_TITLE_SIZE },
  text: { color: THEME.text, fontSize: LABEL_SIZE },
}

// A chart's spec as rendered: the theme, a transparent background, and a
// wide default view (Vega-Lite otherwise gives each bar a fixed step, tall
// and narrow on a terminal). The spec's own settings win over all of these.
export const chartSpec = (spec: Record<string, unknown>): Record<string, unknown> => {
  const config = objectOr(spec.config)

  return {
    ...spec,
    background: spec.background ?? 'transparent',
    padding: spec.padding ?? 12,
    config: {
      ...CHART_THEME,
      ...config,
      view: {
        stroke: THEME.grid,
        continuousWidth: 480,
        continuousHeight: 240,
        discreteWidth: 480,
        ...objectOr(config.view),
      },
    },
  }
}

// FNV-1a, enough to name a file by its source.
export const hash = (text: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// The first bytes of standard base64, decoded: enough for a PNG header.
const decodeHead = (base64: string, count: number): Uint8Array => {
  const out = new Uint8Array(count)
  let bits = 0
  let value = 0
  let at = 0
  for (const char of base64) {
    if (at === count) break
    const digit = ALPHABET.indexOf(char)
    if (digit < 0) break
    value = (value << 6) | digit
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[at++] = (value >> bits) & 0xff
    }
  }
  return out.subarray(0, at)
}

// A PNG's IHDR holds its width and height, big-endian, at bytes 16 and 20.
export const pngSize = (base64: string): { width: number; height: number } | undefined => {
  const head = decodeHead(base64, 24)
  const isPng = head.length === 24 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47
  if (!isPng) return undefined

  const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

// A code block's lines while register.tsx reads them from disk.
export type Loaded =
  | { kind: 'pending' }
  | { kind: 'ready'; text: string; start: number; isCut: boolean }
  | { kind: 'failed'; reason: string }

// Lines `start` to `end` (1-based, inclusive) of a file's text, at most
// `max` of them; `end` absent, from `start` for `max` lines.
export const sliceLines = (text: string, start: number, end: number | undefined, max: number): Loaded => {
  const lines = text.split('\n')
  if (start > lines.length) return { kind: 'failed', reason: `the file has ${lines.length} lines, fewer than ${start}` }

  const wanted = Math.min(end ?? start + max - 1, lines.length)
  const last = Math.min(wanted, start + max - 1)

  return { kind: 'ready', text: lines.slice(start - 1, last).join('\n'), start, isCut: last < wanted }
}

// Code-block notes drawn as pictures: prose in the system's reading font, a
// size over the terminal's, so a note reads as commentary rather than code.
// The text goes to ImageMagick through a file, where it stays literal (no
// `@file` reads, no `%` escapes, as a command-line `caption:` argument has).
export const NOTE = {
  font: '/System/Library/Fonts/SFNS.ttf',
  color: '#e5c07b',
  points: 32,
  interline: 6,
  // The numbered badge before the text: its square, the slot it is
  // centred in, and its digit.
  badge: 40,
  badgeSlot: 56,
  badgeText: '#1c1c1c',
  badgePoints: 26,
  // One line of text at `points`, measured: the badge lines up with it.
  lineHeight: 45,
} as const

// A terminal cell in picture pixels, as the 144 dpi pictures are drawn: a
// note is rendered at its columns' width and padded to whole rows, so the
// Image box holds it unstretched.
export const CELL_PX = { width: 14, height: 28 } as const

// Text for a Graphviz HTML-like label: its markup characters escaped.
const html = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

type TypesInput = {
  shapes: { name: string; kind?: string; fields: { name: string; type?: string; key?: 'pk' | 'fk' }[]; note?: string }[]
  links?: { from: string; to: string; kind?: 'ref' | 'many-to-one' | 'one-to-one' | 'many-to-many'; label?: string }[]
}

// The ends of each link kind, read from the `from` side: a plain arrow for
// "refers to"; crow's foot for many and a bar for one, for tables.
const LINK_ENDS = {
  ref: 'arrowhead=normal',
  'many-to-one': 'dir=both, arrowtail=crow, arrowhead=tee',
  'one-to-one': 'dir=both, arrowtail=tee, arrowhead=tee',
  'many-to-many': 'dir=both, arrowtail=crow, arrowhead=crow',
} as const

// A types block as Graphviz source: each shape a table (its name and kind,
// then a row per field with its key and type), each link an arrow from a
// field row to a shape or field. Nodes and ports get generated ids, so no
// name reaches the source outside an escaped label.
export const typesToDot = (types: TypesInput): string => {
  const ids = new Map<string, string>()
  const nodes = types.shapes.map((shape, n) => {
    ids.set(shape.name, `s${n}`)
    const rows = shape.fields.map((field, f) => {
      ids.set(`${shape.name}.${field.name}`, `s${n}:f${f}`)
      const key = field.key !== undefined ? `<font color="${NOTE.color}">${field.key.toUpperCase()}</font>  ` : ''
      const type = field.type !== undefined ? `  <font color="${THEME.muted}">${html(field.type)}</font>` : ''
      return `<tr><td port="f${f}" align="left">${key}${html(field.name)}${type}</td></tr>`
    })
    const kind = shape.kind !== undefined ? `  <font color="${THEME.muted}">${html(shape.kind)}</font>` : ''
    const note =
      shape.note !== undefined
        ? `<tr><td align="left"><i><font color="${THEME.muted}">${html(shape.note)}</font></i></td></tr>`
        : ''
    return (
      `s${n} [label=<<table border="0" cellborder="1" cellspacing="0" cellpadding="6" color="${THEME.muted}">` +
      `<tr><td bgcolor="#2b2b2b" align="left"><b>${html(shape.name)}</b>${kind}</td></tr>${rows.join('')}${note}</table>>];`
    )
  })
  const edges = (types.links ?? []).flatMap(link => {
    const from = ids.get(link.from)
    const to = ids.get(link.to)
    if (from === undefined || to === undefined) return []
    const label = link.label !== undefined ? `, label=<${html(link.label)}>` : ''
    return [`${from} -> ${to} [${LINK_ENDS[link.kind ?? 'ref']}${label}];`]
  })

  return `digraph { rankdir=LR; node [shape=plain]; ${nodes.join(' ')} ${edges.join(' ')} }`
}
