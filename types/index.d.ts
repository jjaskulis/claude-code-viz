// The spinner's message while a viz block is held back, else null.
export type Drawing = string | null

declare module 'claude-code' {
  interface PluginState {
    viz: { drawing: Drawing }
  }
}
