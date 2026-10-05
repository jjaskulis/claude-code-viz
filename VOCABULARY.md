# Visual blocks

This interface draws fenced ```viz blocks as real layouts. When content is a comparison, a sequence of steps, or a set of files, put that part in one ```viz block holding a single JSON object (no comments, no trailing commas) instead of a markdown table or list. Keep the surrounding explanation as normal prose; a block replaces only the part that is structure. Use a block only when it reads better than prose: never for a one-line answer, and at most two or three per reply.

Types:

compare: options side by side against criteria. "best" is the index of the strongest value in that row; "pick" is the index of the recommended option, with "why" in one short sentence. Values stay short (a few words).
```viz
{"type":"compare","title":"Queue backends","options":["Redis","SQS","Postgres"],"criteria":[{"name":"Latency","values":["<1 ms","~20 ms","~5 ms"],"best":0},{"name":"Ops cost","values":["self-hosted","managed","already run"],"best":2}],"pick":2,"why":"No new infrastructure, and latency is fine at our volume."}
```

timeline: ordered steps of a plan or a process. "status" is one of done, active, todo, blocked; "detail" is optional and short.
```viz
{"type":"timeline","title":"Migration","steps":[{"label":"Add column","status":"done"},{"label":"Backfill","detail":"40% of rows","status":"active"},{"label":"Switch reads","status":"todo"}]}
```

tree: files or modules as a directory tree, from flat paths. "change" is one of add, edit, del; "note" is optional and short.
```viz
{"type":"tree","title":"Changes","items":[{"path":"src/api/routes.ts","change":"edit","note":"new endpoint"},{"path":"src/api/auth.ts","change":"add"},{"path":"src/legacy.ts","change":"del"}]}
```

graph: how things connect (an architecture, a flow, dependencies) as Graphviz source in "dot", drawn as a picture where the terminal can show one. Keep it small (about 12 nodes at most) with short labels; use rankdir=LR for flows. Leave colors and fills to the renderer, which matches the terminal's dark theme. Escape quotes inside the JSON string.
```viz
{"type":"graph","title":"Request path","dot":"digraph { rankdir=LR; node [shape=box, style=rounded]; client -> api -> queue -> worker; api -> db; worker -> db; }"}
```

chart: numbers as a picture (bars, lines, points, areas, heat maps) as a Vega-Lite spec in "spec", with the data inline in "data": {"values": [...]} (never a url). Use it only for numbers actually in the conversation; keep the rows few. Leave background, text and axis colors to the renderer. On a log scale, bars need an explicit start above zero ("x2": {"datum": 1}, and the scale's "domainMin" to match), or they draw empty.
```viz
{"type":"chart","title":"p95 latency","spec":{"data":{"values":[{"service":"api","ms":120},{"service":"search","ms":310},{"service":"auth","ms":45}]},"mark":"bar","encoding":{"x":{"field":"service","type":"nominal","sort":"-y"},"y":{"field":"ms","type":"quantitative","title":"p95 (ms)"}}}}
```

code: explain code by pinning numbered notes to its lines. Give "path" (relative to the project root, or absolute), "start" and "end" for code in a file: the lines are read from disk, so cite only lines you have actually read, and make each note's "line" the real line number. Use "source" only for code that is in no file. At most 80 lines; a few precise notes beat many.
```viz
{"type":"code","title":"Why the retry loop can spin","path":"src/queue/worker.ts","start":40,"end":52,"notes":[{"line":44,"text":"the error is swallowed here, so the loop never sees it"},{"line":49,"text":"no backoff: retries run back to back"}]}
```
