import { describe, expect, test } from 'claude-code/testing'

import { schemaToDot } from '../hooks/graph'

describe('schema to Graphviz source', () => {
  test('names are escaped and reach the source only inside labels', () => {
    const dot = schemaToDot({
      entities: [{ name: 'a<b>', fields: [{ name: 'x"y', type: 'numeric <&>' }] }],
    })

    expect(dot).toContain('a&lt;b&gt;')
    expect(dot).toContain('x&quot;y')
    expect(dot).toContain('numeric &lt;&amp;&gt;')
    expect(dot).not.toContain('a<b>')
  })

  test('a relation links field ports with ends for its kind', () => {
    const dot = schemaToDot({
      entities: [
        { name: 'users', fields: [{ name: 'id' }] },
        { name: 'orders', fields: [{ name: 'id' }, { name: 'user_id' }] },
      ],
      relations: [
        { from: 'orders.user_id', to: 'users.id' },
        { from: 'orders.id', to: 'users.id', kind: 'one-to-one' },
      ],
    })

    expect(dot).toContain('e1:f1 -> e0:f0 [dir=both, arrowtail=crow, arrowhead=tee]')
    expect(dot).toContain('e1:f0 -> e0:f0 [dir=both, arrowtail=tee, arrowhead=tee]')
  })
})
