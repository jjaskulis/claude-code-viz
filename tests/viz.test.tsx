import { describe, expect, test } from 'claude-code/testing'

const fence = (json: object) => '```viz\n' + JSON.stringify(json) + '\n```'

const COMPARE = fence({
  type: 'compare',
  title: 'Queue backends',
  options: ['Redis', 'SQS', 'Postgres'],
  criteria: [
    { name: 'Latency', values: ['<1 ms', '~20 ms', '~5 ms'], best: 0 },
    { name: 'Ops cost', values: ['self-hosted', 'managed', 'already run'], best: 2 },
  ],
  pick: 2,
  why: 'No new infrastructure.',
})

const TIMELINE = fence({
  type: 'timeline',
  steps: [
    { label: 'Add column', status: 'done' },
    { label: 'Backfill', detail: '40% of rows', status: 'active' },
    { label: 'Switch reads', status: 'todo' },
  ],
})

const TREE = fence({
  type: 'tree',
  items: [
    { path: 'src/api/routes.ts', change: 'edit', note: 'new endpoint' },
    { path: 'src/api/auth.ts', change: 'add' },
    { path: 'src/legacy.ts', change: 'del' },
  ],
})

const mount = ($: any, surface: 'terminal' | 'desktop' | 'vscode' | 'mobile', text: string, columns = 100) =>
  $.ui.mount({
    plugin: 'viz',
    surface,
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
    viewport: { columns, rows: 40 },
  })

describe('viz blocks', () => {
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    test(`all three types draw on ${surface}`, async $ => {
      const text = `Here is the plan.\n\n${COMPARE}\n\nThen:\n\n${TIMELINE}\n\n${TREE}\n\nDone.`
      const ui = await mount($, surface, text)

      expect(await ui.find({ type: 'Text', text: /Queue backends/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /→ Postgres/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /1\/3 done/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /routes\.ts/ })).toBeDefined()
      expect(await ui.find({ type: 'Markdown', text: /Here is the plan/ })).toBeDefined()
      await ui.unmount()
    })
  }

  test('a graph block shows its dot source where the surface has no Image', async $ => {
    const ui = await mount($, 'desktop', fence({ type: 'graph', title: 'Flow', dot: 'digraph { a -> b }' }))

    expect(await ui.find({ type: 'Code' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Flow/ })).toBeDefined()
    await ui.unmount()
  })

  test('a graph block without dot source is refused', async $ => {
    const ui = await mount($, 'terminal', fence({ type: 'graph', dot: 'a -> b' }))

    expect(await ui.find({ type: 'Text', text: /graph needs "dot"/ })).toBeDefined()
    await ui.unmount()
  })

  const latency = {
    data: { values: [{ service: 'api', ms: 120 }, { service: 'search', ms: 310 }] },
    mark: 'bar',
    encoding: { x: { field: 'service', type: 'nominal' }, y: { field: 'ms', type: 'quantitative' } },
  }

  test('a chart block lists its data where the surface has no Image', async $ => {
    const ui = await mount($, 'desktop', fence({ type: 'chart', title: 'Latency', spec: latency }))

    expect(await ui.find({ type: 'Text', text: 'service' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'search' })).toBeDefined()
    await ui.unmount()
  })

  test('a chart that would fetch its data is refused', async $ => {
    const spec = { ...latency, data: { url: 'https://example.com/data.json' } }
    const ui = await mount($, 'terminal', fence({ type: 'chart', spec }))

    expect(await ui.find({ type: 'Text', text: /must be inline/ })).toBeDefined()
    await ui.unmount()
  })

  test('a chart spec without a mark is refused', async $ => {
    const ui = await mount($, 'terminal', fence({ type: 'chart', spec: { data: latency.data } }))

    expect(await ui.find({ type: 'Text', text: /needs a mark/ })).toBeDefined()
    await ui.unmount()
  })

  const snippet = {
    type: 'code',
    language: 'ts',
    source: 'const a = 1\nconst b = a + 1\nexport { b }',
    notes: [
      { line: 2, text: 'b depends on a' },
      { line: 9, text: 'nowhere near' },
    ],
  }

  for (const surface of ['terminal', 'mobile'] as const) {
    test(`a code block pins its notes under their lines on ${surface}`, async $ => {
      const ui = await mount($, surface, fence(snippet))

      const codes = await ui.findAll({ type: 'Code' })
      expect(codes.length).toBe(2)
      expect(codes[0]?.props.startLine).toBe(1)
      expect(codes[1]?.props.startLine).toBe(3)
      expect(await ui.find({ type: 'Text', text: /b depends on a/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /line 9 is outside the snippet/ })).toBeDefined()
      await ui.unmount()
    })
  }

  test('a code block that cannot read its file says why', async $ => {
    const ui = await mount($, 'terminal', fence({ type: 'code', path: 'no/such/file.ts', start: 1, end: 5 }))

    expect(await ui.find({ type: 'Text', text: /no\/such\/file\.ts:1–5/ })).toBeDefined()
    await ui.unmount()
  })

  test('a code block without a file or source is refused', async $ => {
    const ui = await mount($, 'terminal', fence({ type: 'code', path: 'a.ts' }))

    expect(await ui.find({ type: 'Text', text: /needs "path" and "start"/ })).toBeDefined()
    await ui.unmount()
  })

  const trace = {
    type: 'trace',
    title: 'Saving an order',
    steps: [
      { at: 'src/api/orders.ts:14', what: 'route handler validates the body' },
      { at: 'src/orders/service.ts:31', what: 'service prices the order', fn: 'priceOrder', depth: 1 },
      { at: 'src/db/orders.ts:8', what: 'row is inserted', kind: 'effect', depth: 2 },
      { at: 'src/api/orders.ts:22', what: 'responds 201', kind: 'return' },
    ],
  }

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`a trace draws its steps with places and kinds on ${surface}`, async $ => {
      const ui = await mount($, surface, fence(trace))

      expect(await ui.find({ type: 'Text', text: /service prices the order/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'in src/' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'db/orders.ts:8' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /side effect/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'priceOrder' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '   └─ ' })).toBeDefined()
      await ui.unmount()
    })
  }

  test('a trace phase heads a new stretch and restarts the tree', async $ => {
    const steps = [
      { at: 'a.ts:1', what: 'first' },
      { at: 'a.ts:2', what: 'child', depth: 1 },
      { at: 'a.ts:3', what: 'later', phase: 'when the timer fires' },
      { at: 'a.ts:4', what: 'later child', depth: 1 },
    ]
    const ui = await mount($, 'terminal', fence({ type: 'trace', steps }))

    expect(await ui.find({ type: 'Text', text: /── when the timer fires ──/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Text', text: '└─ ' })).length).toBe(2)
    await ui.unmount()
  })

  test('a trace step without a path:line place is refused', async $ => {
    const ui = await mount($, 'terminal', fence({ type: 'trace', steps: [{ at: 'somewhere', what: 'x' }] }))

    expect(await ui.find({ type: 'Text', text: /"at" as path:line/ })).toBeDefined()
    await ui.unmount()
  })

  const sequence = {
    type: 'sequence',
    participants: ['client', 'api', 'db'],
    messages: [
      { from: 'client', to: 'api', text: 'POST /orders' },
      { from: 'api', to: 'db', text: 'insert row' },
      { from: 'db', to: 'api', text: 'id', kind: 'reply' },
      { from: 'api', to: 'api', text: 'emit event', kind: 'async' },
      { from: 'api', to: 'client', text: '201 Created', kind: 'reply' },
    ],
  }

  for (const surface of ['terminal', 'mobile'] as const) {
    test(`a sequence draws lifelines, numbered messages and arrows on ${surface}`, async $ => {
      const ui = await mount($, surface, fence(sequence))

      expect(await ui.find({ type: 'Text', text: 'client' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /POST \/orders/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /─+▶/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /◀╌+/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /↺ 4\./ })).toBeDefined()
      await ui.unmount()
    })
  }

  test('a sequence on a narrow terminal is listed', async $ => {
    const ui = await mount($, 'terminal', fence(sequence), 24)

    expect(await ui.find({ type: 'Text', text: /^1\. $/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '⇠' })).toBeDefined()
    await ui.unmount()
  })

  test('a sequence message from an unknown participant is refused', async $ => {
    const bad = { ...sequence, messages: [{ from: 'cache', to: 'api', text: 'x' }] }
    const ui = await mount($, 'terminal', fence(bad))

    expect(await ui.find({ type: 'Text', text: /among the participants/ })).toBeDefined()
    await ui.unmount()
  })

  const types = {
    type: 'types',
    shapes: [
      { name: 'EditParams', kind: 'interface', fields: [{ name: 'pages', type: 'Page[]' }, { name: 'codegen?', type: 'CodegenParams' }] },
      { name: 'CodegenParams', kind: 'type', fields: [{ name: 'resources', type: 'Resources' }] },
    ],
    links: [{ from: 'EditParams.codegen?', to: 'CodegenParams', label: 'optional' }],
  }

  test('types lists its shapes where the surface has no Image', async $ => {
    const ui = await mount($, 'desktop', fence(types))

    expect(await ui.find({ type: 'Text', text: 'EditParams' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /EditParams\.codegen\? → CodegenParams: optional/ })).toBeDefined()
    await ui.unmount()
  })

  test('a types link to an unknown field is refused', async $ => {
    const bad = { ...types, links: [{ from: 'EditParams.nope', to: 'CodegenParams' }] }
    const ui = await mount($, 'terminal', fence(bad))

    expect(await ui.find({ type: 'Text', text: /naming a shape or Shape\.field/ })).toBeDefined()
    await ui.unmount()
  })

  test('a narrow terminal stacks the comparison', async $ => {
    const ui = await mount($, 'terminal', COMPARE, 40)

    expect(await ui.find({ type: 'Text', text: /Ops cost: / })).toBeDefined()
    await ui.unmount()
  })

  test('an unclosed fence shows a placeholder while streaming', async $ => {
    const ui = await mount($, 'terminal', 'Comparing:\n\n```viz\n{"type":"compare","options":["A"')

    expect(await ui.find({ type: 'Text', text: /drawing compare/ })).toBeDefined()
    await ui.unmount()
  })

  test('a broken block falls back to its source', async $ => {
    const ui = await mount($, 'terminal', '```viz\n{"type":"pie"}\n```')

    expect(await ui.find({ type: 'Text', text: /unknown type "pie"/ })).toBeDefined()
    await ui.unmount()
  })

  test('a reply without blocks is left to the engine', async ($, on) => {
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })
    const ui = await mount($, 'terminal', 'Plain answer.')

    expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
    await ui.unmount()
  })
})
