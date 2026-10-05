import type { TurnStepChunk } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { holdViz } from '../hooks/hold'

const text = (index: number, t: string, ref?: number): TurnStepChunk => ({ kind: 'text', index, text: t, ref })
const engine = (ref: number): TurnStepChunk => ({ kind: 'engine', ref })

// Runs the chunks through holdViz and records, for each chunk that comes
// out, how many chunks had gone in by then, and every status line set.
const run = async (chunks: TurnStepChunk[]) => {
  let fed = 0
  const source = async function* () {
    for (const c of chunks) {
      fed += 1
      yield c
    }
  }
  const out: { chunk: TurnStepChunk; fedBy: number }[] = []
  const status: (string | undefined)[] = []
  for await (const chunk of holdViz(source(), s => status.push(s))) out.push({ chunk, fedBy: fed })
  return { out, status, chunks: out.map(o => o.chunk) }
}

describe('holding a viz block back while it streams', () => {
  test('prose with no block streams through as it comes', async () => {
    const chunks = [engine(1), text(0, 'Hello '), text(0, 'world'), engine(2), { kind: 'stop', stopReason: 'end_turn', usage: null } as TurnStepChunk]
    const { out, status } = await run(chunks)

    expect(out.map(o => o.chunk)).toEqual(chunks)
    expect(out.map(o => o.fedBy)).toEqual([1, 2, 3, 4, 5])
    expect(status).toEqual([])
  })

  test('a block is held from its fence to the end of its text block, order kept', async () => {
    const chunks = [
      engine(1),
      text(0, 'Intro.\n\n'),
      text(0, '```viz\n{"type":"time'),
      text(0, 'line","steps":[]}\n```\n'),
      text(0, 'After.'),
      engine(2), // block 0 ends
      engine(3), // block 1 starts
      { kind: 'tool', index: 1, id: 'toolu_1', name: 'Bash' } as TurnStepChunk,
      { kind: 'input', index: 1, json: '{}' } as TurnStepChunk,
      { kind: 'stop', stopReason: 'tool_use', usage: null } as TurnStepChunk,
    ]
    const { out, status, chunks: got } = await run(chunks)

    expect(got).toEqual(chunks)
    // The intro streams at once; the fence and everything up to the next
    // block's first chunk come out together when that chunk arrives (8th).
    expect(out.map(o => o.fedBy)).toEqual([1, 2, 8, 8, 8, 8, 8, 8, 9, 10])
    expect(status).toEqual(['visual', 'timeline', undefined])
  })

  test('a block still open when the stream ends is flushed', async () => {
    const chunks = [text(0, 'x ```viz\n{"type":"tree"'), engine(9)]
    const { chunks: got, status } = await run(chunks)

    expect(got).toEqual(chunks)
    expect(status.at(-1)).toBeUndefined()
  })

  test('through the engine, the step keeps its chunks in order', async ($, on) => {
    const result = { turnId: 't', index: 0, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null } as any
    // Engine chunks only come from the engine's own stream, so none here.
    const chunks = [text(0, 'See:\n```viz\n{"type":"tree","items":[]}\n```'), text(1, 'Next block.')]
    on('turn.step', async function* () {
      yield* chunks
      return result
    })

    const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
    const got: TurnStepChunk[] = []
    for await (const chunk of stream) got.push(chunk)

    // stream.result comes back undefined here even for a plain pass-through
    // hook (2.1.287's test kit), so only the chunks are checked.
    expect(got.map(c => (c.kind === 'text' ? c.text : c.kind))).toEqual(chunks.map(c => (c as { text: string }).text))
  })

  test('the spinner says what is being drawn while a block is held', async ($, on) => {
    let open = () => {}
    const gate = new Promise<void>(resolve => (open = resolve))
    on('turn.step', async function* () {
      yield text(0, '```viz\n{"type":"tree"')
      await gate
      yield text(1, 'next')
      return { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as any
    })
    const seen: (string | null)[] = []
    on('ui.render', ($, e) => {
      seen.push((e.props as { message: string | null }).message)
      return $.ui.resolve(e).Text({ children: 'spinner' })
    })
    const spinner = {
      surface: 'terminal',
      component: 'Spinner',
      props: { word: 'Baking', message: null, suffix: '…', mode: 'responding' },
    } as const

    const stream = $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 })
    const first = stream.next()
    for (let i = 0; i < 200; i++) await Promise.resolve()
    await (await $.ui.mount({ plugin: 'viz', ...spinner })).unmount()
    open()
    await first
    for await (const _ of stream) {
    }
    await (await $.ui.mount({ plugin: 'viz', ...spinner })).unmount()

    // The mounted spinner redraws by itself once the write lands, and the
    // message is gone once the stream is through.
    expect(seen).toContain('Drawing tree')
    expect(seen.at(-1)).toBeNull()
  })

  test('a fence split across chunks is still caught', async () => {
    const chunks = [text(0, 'a ``'), text(0, '`viz\n{}'), text(0, '\n```'), engine(2)]
    const { out } = await run(chunks)

    expect(out.map(o => o.fedBy)).toEqual([1, 4, 4, 4])
  })
})
