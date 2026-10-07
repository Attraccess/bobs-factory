# Bob's Factory — marketing site

Published at [jappyjan.github.io/bobs-factory](https://jappyjan.github.io/bobs-factory/)
from [jappyjan/bobs-factory](https://github.com/jappyjan/bobs-factory) by the
Website GitHub Actions workflow on `main`. The project path remains `/bobs-factory/`.

Vite + React + Tailwind v4 + Motion + Lenis. Every product image and video on the
page is the **real Bob's Factory UI**, captured from the actual factory runtime,
HTTP server and web app running against a demo repository with scripted agents.

```sh
cd website
pnpm install
pnpm dev            # http://localhost:5180
pnpm build          # static site in dist/
```

This folder is its own pnpm workspace root; it does not touch the monorepo lockfile.

## Regenerating product assets

```sh
pnpm --dir .. install && pnpm --dir .. --filter 'cyrus-edge-worker...' build  # once
node demo/prepare.mjs   # screenshots of the mock "Pancake Palace" app (QA evidence)
bun demo/server.ts      # real factory on http://127.0.0.1:3700 with seeded runs
# wait ~60 s so the live "checkout" run is mid-implementation, then:
node demo/capture.mjs   # → public/shots/*.webp, public/video/*.{mp4,webm,jpg}
node demo/og.mjs        # → public/og.png
```

`demo/server.ts` boots `WorkflowRuntime` + `FactoryServer` from
`packages/edge-worker/dist` in an isolated home (`/tmp/bobs-factory-demo`). Only
agents and GitHub/CI tools are scripted; it creates a real Git repo so the review
guide's diff viewer shows a genuine snapshot. Seeded runs: a review-ready guide with
screenshots, an open clarification question, a live streaming run, a failed CI run,
merged runs and a Simple chat. Launching from the demo UI starts a new scripted run.

`node demo/capture.mjs <name…>` captures a subset (e.g. `review`, `mobile`, `live-run`).
`node demo/site-peek.mjs [url] [width] [height]` and `node demo/site-interact.mjs`
are visual QA helpers for the site itself.
