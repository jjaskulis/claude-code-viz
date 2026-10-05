// Splits an assistant text block into markdown and ```viz segments, and
// checks each viz block's JSON against the vocabulary the prompt teaches.

export type Status = 'done' | 'active' | 'todo' | 'blocked'
export type Change = 'add' | 'edit' | 'del'

export type Compare = {
  type: 'compare'
  title?: string
  options: string[]
  criteria: { name: string; values: string[]; best?: number }[]
  pick?: number
  why?: string
}

export type Timeline = {
  type: 'timeline'
  title?: string
  steps: { label: string; detail?: string; status: Status }[]
}

export type Tree = {
  type: 'tree'
  title?: string
  items: { path: string; note?: string; change?: Change }[]
}

// graph: Graphviz source, laid out and drawn by the host's `dot`.
export type Graph = {
  type: 'graph'
  title?: string
  dot: string
}

// chart: a Vega-Lite spec with its data inline, drawn by vl2svg.
export type Chart = {
  type: 'chart'
  title?: string
  spec: Record<string, unknown>
}

// code: a snippet with numbered callouts pinned to its lines. Given `path`
// and `start` (and `end`), the lines are read from disk, so what shows is
// the file itself; `source` is for code that is in no file.
export type Snippet = {
  type: 'code'
  title?: string
  path?: string
  start?: number
  end?: number
  source?: string
  language?: string
  notes?: { line: number; text: string }[]
}

// trace: an execution path, step by step: where (`file:line`, and the
// function or class it is in), what happens there, what kind of step it is, how deep in the calls, optionally a few of
// its lines read from disk, and a `phase` that starts a new stretch of time
// (a later callback, a second pass).
export type TraceKind = 'call' | 'async' | 'effect' | 'return'

export type Trace = {
  type: 'trace'
  title?: string
  steps: {
    at: string
    what: string
    fn?: string
    kind?: TraceKind
    depth?: number
    show?: number
    phase?: string
  }[]
}

export type Viz = Compare | Timeline | Tree | Graph | Chart | Snippet | Trace

// `path:line` as a trace step names its place; undefined when it does not.
export const parseAt = (at: string): { path: string; line: number } | undefined => {
  const match = /^(.+):(\d+)$/.exec(at.trim())
  const line = Number(match?.[2])
  return match?.[1] !== undefined && line >= 1 ? { path: match[1], line } : undefined
}

// The most lines one trace step may show.
export const TRACE_MAX_SHOW = 8

// The most lines a code block shows, read from disk or given inline.
export const SNIPPET_MAX_LINES = 80

export type Segment =
  | { kind: 'markdown'; text: string }
  | { kind: 'viz'; viz: Viz }
  | { kind: 'pending'; hint: string }
  | { kind: 'broken'; source: string; reason: string }

const FENCE = /```viz[^\S\n]*\n([\s\S]*?)\n?```/g
const OPEN_FENCE = /```viz[^\S\n]*(\n[\s\S]*)?$/

export const hasViz = (text: string): boolean => text.includes('```viz')

export const segment = (text: string): Segment[] => {
  const out: Segment[] = []
  let at = 0

  for (const match of text.matchAll(FENCE)) {
    pushMarkdown(out, text.slice(at, match.index))
    out.push(toSegment(match[1] ?? '', match[0]))
    at = match.index + match[0].length
  }

  const rest = text.slice(at)
  const open = OPEN_FENCE.exec(rest)

  if (open) {
    // An unclosed fence: the reply is still streaming in.
    pushMarkdown(out, rest.slice(0, open.index))
    const type = /"type"\s*:\s*"(\w+)"/.exec(open[1] ?? '')?.[1]
    out.push({ kind: 'pending', hint: type ?? 'visual' })
  } else {
    pushMarkdown(out, rest)
  }

  return out
}

const pushMarkdown = (out: Segment[], text: string) => {
  if (text.trim() !== '') out.push({ kind: 'markdown', text: text.trim() })
}

const toSegment = (body: string, source: string): Segment => {
  let data: unknown

  try {
    data = JSON.parse(body)
  } catch (error) {
    return { kind: 'broken', source, reason: 'not valid JSON' }
  }

  const reason = check(data)

  return reason === undefined
    ? { kind: 'viz', viz: data as Viz }
    : { kind: 'broken', source, reason }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(s => typeof s === 'string')

// Whether `key` appears anywhere in a JSON value, however deep.
const hasKey = (value: unknown, key: string): boolean => {
  if (Array.isArray(value)) return value.some(item => hasKey(item, key))
  if (!isObject(value)) return false
  return Object.entries(value).some(([k, v]) => k === key || hasKey(v, key))
}

const STATUSES: readonly string[] = ['done', 'active', 'todo', 'blocked']
const CHANGES: readonly string[] = ['add', 'edit', 'del']

// Returns why `data` is not a viz block, or undefined when it is one.
export const check = (data: unknown): string | undefined => {
  if (!isObject(data)) return 'not an object'

  if (data.type === 'compare') {
    if (!isStrings(data.options) || data.options.length < 2) return 'compare needs 2+ options'
    const width = data.options.length
    if (!Array.isArray(data.criteria) || data.criteria.length === 0) return 'compare needs criteria'
    const isCriterion = (c: unknown) =>
      isObject(c) && typeof c.name === 'string' && isStrings(c.values) && c.values.length === width
    if (!data.criteria.every(isCriterion)) return `each criterion needs a name and ${width} values`
    return undefined
  }

  if (data.type === 'timeline') {
    const isStep = (s: unknown) =>
      isObject(s) && typeof s.label === 'string' && STATUSES.includes(String(s.status))
    if (!Array.isArray(data.steps) || !data.steps.every(isStep)) return 'each step needs a label and a status'
    return undefined
  }

  if (data.type === 'tree') {
    const isItem = (i: unknown) =>
      isObject(i) && typeof i.path === 'string' && (i.change === undefined || CHANGES.includes(String(i.change)))
    if (!Array.isArray(data.items) || !data.items.every(isItem)) return 'each item needs a path'
    return undefined
  }

  if (data.type === 'graph') {
    if (typeof data.dot !== 'string' || !/^\s*(strict\s+)?(di)?graph\b/.test(data.dot)) return 'graph needs "dot": a digraph { ... } or graph { ... }'
    return undefined
  }

  if (data.type === 'chart') {
    if (!isObject(data.spec)) return 'chart needs "spec": a Vega-Lite object'
    const views = ['mark', 'layer', 'concat', 'hconcat', 'vconcat', 'facet', 'repeat']
    if (!views.some(view => view in (data.spec as object))) return 'chart spec needs a mark (or layer, concat, facet, repeat)'
    // The renderer must not fetch anything: data rides in the spec.
    if (hasKey(data.spec, 'url')) return 'chart data must be inline ("data": {"values": [...]}), not a url'
    return undefined
  }

  if (data.type === 'code') {
    const isLine = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1
    const hasSource = typeof data.source === 'string'
    const hasFile = typeof data.path === 'string' && isLine(data.start)
    if (!hasSource && !hasFile) return 'code needs "path" and "start" (lines read from the file), or "source"'
    if (data.end !== undefined && !(isLine(data.end) && isLine(data.start) && data.end >= data.start)) {
      return 'code "end" must be a line number at or after "start"'
    }
    if (hasFile && isLine(data.end) && data.end - (data.start as number) + 1 > SNIPPET_MAX_LINES) {
      return `code shows at most ${SNIPPET_MAX_LINES} lines`
    }
    const isNote = (n: unknown) => isObject(n) && isLine(n.line) && typeof n.text === 'string'
    if (data.notes !== undefined && !(Array.isArray(data.notes) && data.notes.every(isNote))) {
      return 'each code note needs a "line" number and a "text"'
    }
    return undefined
  }

  if (data.type === 'trace') {
    const kinds: readonly unknown[] = ['call', 'async', 'effect', 'return']
    const isStep = (step: unknown) =>
      isObject(step) &&
      typeof step.at === 'string' &&
      parseAt(step.at) !== undefined &&
      typeof step.what === 'string' &&
      (step.kind === undefined || kinds.includes(step.kind)) &&
      (step.depth === undefined || (Number.isInteger(step.depth) && (step.depth as number) >= 0)) &&
      (step.phase === undefined || typeof step.phase === 'string') &&
      (step.fn === undefined || typeof step.fn === 'string') &&
      (step.show === undefined ||
        (Number.isInteger(step.show) && (step.show as number) >= 0 && (step.show as number) <= TRACE_MAX_SHOW))
    if (!Array.isArray(data.steps) || data.steps.length === 0) return 'trace needs steps'
    if (!data.steps.every(isStep)) {
      return `each trace step needs "at" as path:line and "what"; kind is call, async, effect or return; show at most ${TRACE_MAX_SHOW}`
    }
    return undefined
  }

  return `unknown type ${JSON.stringify(data.type)}`
}

// A tree block's flat paths as nested nodes, directories first.
export type Node = { name: string; note?: string; change?: Change; children: Node[] }

export const nest = (items: Tree['items']): Node[] => {
  const root: Node = { name: '', children: [] }

  for (const item of items) {
    let at = root
    for (const part of item.path.split('/').filter(Boolean)) {
      let child = at.children.find(c => c.name === part)
      if (!child) {
        child = { name: part, children: [] }
        at.children.push(child)
      }
      at = child
    }
    at.note = item.note
    at.change = item.change
  }

  const sort = (nodes: Node[]): Node[] =>
    nodes
      .map(n => ({ ...n, children: sort(n.children) }))
      .sort((a, b) => Number(b.children.length > 0) - Number(a.children.length > 0))

  return sort(root.children)
}
