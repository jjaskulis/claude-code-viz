// Holds a streaming reply back from the moment a ```viz fence opens in a
// text block until that block ends, so the person never watches raw JSON
// stream in; the block then arrives whole and the render hook draws it.
// `onHold` hears the held block's type, or undefined once nothing is held.
//
// Nothing is rewritten: every chunk leaves in the order it came, engine
// chunks (a block's start and end) included, only later. A block ends when
// a chunk of another block, or the stop, arrives; the stream's end flushes.

import type { TurnStepChunk } from 'claude-code'

export async function* holdViz(
  stream: AsyncIterable<TurnStepChunk>,
  onHold: (type: string | undefined) => void,
): AsyncGenerator<TurnStepChunk, void> {
  let held: TurnStepChunk[] = []
  let holding: number | undefined
  let block: number | undefined
  let text = ''
  let hint: string | undefined

  const say = (next: string | undefined) => {
    if (next !== hint) onHold((hint = next))
  }

  try {
    for await (const chunk of stream) {
      const index = 'index' in chunk ? chunk.index : undefined
      const endsHeld = holding !== undefined && (chunk.kind === 'stop' || (index !== undefined && index !== holding))

      if (endsHeld) {
        yield* held
        held = []
        holding = undefined
        say(undefined)
      }

      if (chunk.kind === 'text') {
        if (chunk.index !== block) {
          block = chunk.index
          text = ''
        }
        text += chunk.text
        if (holding === undefined && text.includes('```viz')) holding = chunk.index
      }

      if (holding === undefined) {
        yield chunk
        continue
      }

      held.push(chunk)
      const type = /"type"\s*:\s*"(\w+)"/.exec(text.slice(text.lastIndexOf('```viz')))?.[1]
      say(type ?? 'visual')
    }

    yield* held
  } finally {
    say(undefined)
  }
}
