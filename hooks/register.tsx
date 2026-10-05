import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { EngineInterface } from 'claude-code'

import { drawSegments } from './draw'
import { CELL_PX, DOT_THEME_ARGS, NOTE, RENDER_DIR, chartSpec, hash, pngSize, sliceLines } from './graph'
import type { Loaded, Rendered } from './graph'
import { holdViz } from './hold'
import { SNIPPET_MAX_LINES, hasViz, segment } from './parse'
import type { Chart, Graph, Snippet } from './parse'
import type { Drawing } from '../types'

const drawing = atom({ plugin: 'viz', key: 'drawing' } as const, null as Drawing)

// A code block's lines: inline source at once, a file's lines once read.
// Read once per module life, so an edit after the reply does not move them.
const snippets = new Map<string, Loaded>()

const snippetOf = ($: EngineInterface, block: Snippet): Loaded => {
  if (block.source !== undefined) {
    return sliceLines(block.source, 1, undefined, SNIPPET_MAX_LINES)
  }

  const path = block.path ?? ''
  const start = block.start ?? 1
  const id = `${path}:${start}:${block.end ?? ''}`
  const known = snippets.get(id)
  if (known !== undefined) return known

  snippets.set(id, { kind: 'pending' })
  void $.fs
    .read(path)
    .then(
      text => sliceLines(text, start, block.end, SNIPPET_MAX_LINES),
      (error: unknown): Loaded => ({ kind: 'failed', reason: error instanceof Error ? error.message : String(error) }),
    )
    .then(loaded => {
      snippets.set(id, loaded)
      $.ui.invalidate('ui.render')
    })

  return { kind: 'pending' }
}

// Each distinct picture source is rendered once for the module's life; a
// reload renders again, which is cheap.
const pictures = new Map<string, Rendered>()

const pictureOf = ($: EngineInterface, block: Graph | Chart): Rendered => {
  const source = block.type === 'graph' ? block.dot : JSON.stringify(chartSpec(block.spec))
  const id = `${block.type}-${hash(source)}`
  const known = pictures.get(id)
  if (known !== undefined) return known

  pictures.set(id, { kind: 'pending' })
  void renderPicture($, id, block.type, source).then(rendered => {
    pictures.set(id, rendered)
    $.ui.invalidate('ui.render')
  })

  return { kind: 'pending' }
}

// Why a renderer failed, in one line.
const failure = (tool: string, ran: { exitCode: number; stderr: string }): Rendered => ({
  kind: 'failed',
  reason: ran.stderr.trim().split('\n')[0] || `${tool} exited with ${ran.exitCode}`,
})

const renderPicture = async (
  $: EngineInterface,
  id: string,
  kind: 'graph' | 'chart',
  source: string,
): Promise<Rendered> => {
  const png = `${RENDER_DIR}/${id}.png`
  // A renderer's first warning: why a picture came out empty, say.
  let warning: string | undefined

  try {
    await $.process.run(['mkdir', '-p', RENDER_DIR])

    if (kind === 'graph') {
      const ran = await $.process.run(['dot', '-Tpng', '-Gdpi=144', '-Gpad=0.2', ...DOT_THEME_ARGS, '-o', png], {
        stdin: source,
        timeoutMs: 15_000,
      })
      if (ran.exitCode !== 0) return failure('dot', ran)
    } else {
      // Vega-Lite to SVG with the mod's own vega-cli, then SVG to a PNG at
      // twice the size, as dot's 144 dpi is.
      const spec = `${RENDER_DIR}/${id}.vl.json`
      const svg = `${RENDER_DIR}/${id}.svg`
      await $.fs.write(spec, source)
      const vl = await $.process.run([`${$.plugin.root}/renderers/node_modules/.bin/vl2svg`, spec, svg], {
        timeoutMs: 30_000,
      })
      if (vl.exitCode !== 0) return failure('vl2svg', vl)
      warning = vl.stderr
        .split('\n')
        .find(line => line.startsWith('WARN'))
        ?.replace(/^WARN\s*/, '')
      const rsvg = await $.process.run(['rsvg-convert', '-z', '2', svg, '-o', png], { timeoutMs: 15_000 })
      if (rsvg.exitCode !== 0) return failure('rsvg-convert', rsvg)
    }

    const { base64 } = await $.fs.read(png, { as: 'bytes' })
    const size = pngSize(base64)
    if (size !== undefined) lastPicture = png

    // Sent inline: a file path leaves the terminal to open it itself.
    return size === undefined
      ? { kind: 'failed', reason: 'no PNG was written' }
      : { kind: 'ready', png: base64, ...size, warning }
  } catch (error) {
    return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) }
  }
}

// Code-block note `n` as a picture `columns` cells wide: a numbered badge,
// then the text. Rendered once per number, text and width (a resize renders
// again, at the new width).
const noteOf = ($: EngineInterface, n: number, text: string, columns: number): Rendered => {
  const id = `note-${n}-${hash(text)}-${columns}`
  const known = pictures.get(id)
  if (known !== undefined) return known

  pictures.set(id, { kind: 'pending' })
  void renderNote($, id, n, text, columns).then(rendered => {
    pictures.set(id, rendered)
    $.ui.invalidate('ui.render')
  })

  return { kind: 'pending' }
}

const renderNote = async (
  $: EngineInterface,
  id: string,
  n: number,
  text: string,
  columns: number,
): Promise<Rendered> => {
  const txt = `${RENDER_DIR}/${id}.txt`
  const textPng = `${RENDER_DIR}/${id}.text.png`
  const png = `${RENDER_DIR}/${id}.png`
  const width = columns * CELL_PX.width
  const textWidth = width - NOTE.badgeSlot

  try {
    await $.process.run(['mkdir', '-p', RENDER_DIR])
    await $.fs.write(txt, text)
    const drawn = await $.process.run(
      [
        'magick',
        '-background', 'none',
        '-fill', NOTE.color,
        '-font', NOTE.font,
        '-pointsize', String(NOTE.points),
        '-interline-spacing', String(NOTE.interline),
        '-size', `${textWidth}x`,
        `caption:@${txt}`,
        textPng,
      ],
      { timeoutMs: 15_000 },
    )
    if (drawn.exitCode !== 0) return failure('magick', drawn)

    const size = pngSize((await $.fs.read(textPng, { as: 'bytes' })).base64)
    if (size === undefined) return { kind: 'failed', reason: 'magick wrote no PNG' }

    // Whole rows, so the Image box holds the note unstretched; the badge
    // and the text are centred in them. `n` is the mod's own count, so it
    // is safe on the command line where the model's text is not.
    const height = Math.max(1, Math.ceil(size.height / CELL_PX.height)) * CELL_PX.height
    const b = NOTE.badge
    // The text is centred in its rows; the badge sits beside its first line.
    const textTop = Math.floor((height - size.height) / 2)
    const badgeLeft = Math.floor((NOTE.badgeSlot - b) / 2)
    const badgeTop = Math.max(0, textTop + Math.floor((NOTE.lineHeight - b) / 2))
    const joined = await $.process.run(
      [
        'magick',
        '(',
        '-size', `${b}x${b}`, 'xc:none',
        '-fill', NOTE.color,
        '-draw', `roundrectangle 0,0 ${b - 1},${b - 1} 10,10`,
        '-fill', NOTE.badgeText,
        '-font', NOTE.font,
        '-pointsize', String(NOTE.badgePoints),
        '-gravity', 'center',
        '-annotate', '+0+0', String(n),
        '-background', 'none',
        '-gravity', 'northwest',
        '-extent', `${NOTE.badgeSlot}x${height}-${badgeLeft}-${badgeTop}`,
        ')',
        '(',
        textPng,
        '-background', 'none',
        '-gravity', 'west',
        '-extent', `${textWidth}x${height}`,
        ')',
        '+append',
        '+repage',
        png,
      ],
      { timeoutMs: 15_000 },
    )
    if (joined.exitCode !== 0) return failure('magick', joined)

    const { base64 } = await $.fs.read(png, { as: 'bytes' })
    return { kind: 'ready', png: base64, width, height }
  } catch (error) {
    return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) }
  }
}

// The picture rendered last, for /viz-open; after a reload, the newest
// graph, chart or types picture on disk stands in.
let lastPicture: string | undefined

const latestPicture = async ($: EngineInterface): Promise<string | undefined> => {
  if (lastPicture !== undefined) return lastPicture
  const listed = await $.process.run(['ls', '-t', RENDER_DIR])
  const newest = listed.stdout.split('\n').find(name => /^(graph|chart)-[0-9a-f]+\.png$/.test(name))
  return newest !== undefined ? `${RENDER_DIR}/${newest}` : undefined
}

export const register: Register = on => {
  // /viz-open: the latest picture full size in Preview, to zoom and pan.
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'viz-open',
      description: 'Open the latest viz diagram or chart full size in Preview',
    })
    return next(e)
  })

  on('command.run', { command: 'viz-open' }, async $ => {
    const picture = await latestPicture($)
    if (picture === undefined) return { text: 'No viz diagram or chart has been drawn yet.' }

    const opened = await $.process.run(['open', '-a', 'Preview', picture])
    return {
      text: opened.exitCode === 0 ? `Opened ${picture} in Preview.` : `Could not open ${picture}: ${opened.stderr.trim()}`,
    }
  })

  // The live stream is drawn by the engine, not by ui.render, so a block is
  // held back until it is whole rather than shown as raw JSON.
  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    if (e.agentId !== undefined) return yield* stream

    // Writes are chained so a late one never lands before an earlier one.
    let writes = Promise.resolve()
    const show = (type: string | undefined) => {
      writes = writes.then(async () => {
        await update($, drawing, () => (type === undefined ? null : `Drawing ${type}`))
      })
    }

    yield* holdViz(stream, show)
    await writes

    return await stream.result
  })

  // While a block is held, the spinner says so in place of its word.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const message = await read($, drawing)

    return message === null ? next(e) : next({ ...e, props: { ...e.props, message } })
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!hasViz(e.props.text)) return next(e)

    // The row sits behind the reply's two-column bullet.
    const columns = (e.viewport?.columns ?? 80) - 2

    return drawSegments($.ui.resolve(e), segment(e.props.text), columns, {
      picture: block => pictureOf($, block),
      snippet: block => snippetOf($, block),
      note: (n, text, width) => noteOf($, n, text, width),
    })
  })
}
