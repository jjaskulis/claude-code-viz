import { describe, expect, test } from 'claude-code/testing'

import { typesToDot } from '../hooks/graph'

describe('types to Graphviz source', () => {
  test('names are escaped and reach the source only inside labels', () => {
    const dot = typesToDot({
      shapes: [{ name: 'a<b>', fields: [{ name: 'x"y', type: 'numeric <&>' }] }],
    })

    expect(dot).toContain('a&lt;b&gt;')
    expect(dot).toContain('x&quot;y')
    expect(dot).toContain('numeric &lt;&amp;&gt;')
    expect(dot).not.toContain('a<b>')
  })

  test('a link is a plain arrow unless its kind is a table relation', () => {
    const dot = typesToDot({
      shapes: [
        { name: 'users', fields: [{ name: 'id' }] },
        { name: 'orders', fields: [{ name: 'id' }, { name: 'user_id' }] },
      ],
      links: [
        { from: 'orders.user_id', to: 'users' },
        { from: 'orders.id', to: 'users.id', kind: 'many-to-one' },
      ],
    })

    expect(dot).toContain('s1:f1 -> s0 [arrowhead=normal]')
    expect(dot).toContain('s1:f0 -> s0:f0 [dir=both, arrowtail=crow, arrowhead=tee]')
  })
})
