# Video and refinement base integration

Date: 2026-10-07. Tested `e646b775a26cf4c508ae358c46fd4bc795ae1f73`
plus the staged merge of `b9974c8b121468e2075d82fd70a3ffa75d5cb757` and
video-contract forwarding correction. Edge-worker diff SHA-256:
`055e59390a8709ce1bb0bed79e8661e13a2b2225337ac3c60792c0107a750d66`. Dashboard build: `749d3f4a23525902af0ea133`.

## Applicability and scenario

The base introduces question normalization and restart handling beside video
capture validation. F1 applies to their integrated runtime behavior. Replayed
the existing isolated fixtures with injected deterministic runners and
`F1_AGENT_MODE=mock`; no live provider or production tracker calls occurred.

## Commands and results

```sh
pnpm build
F1_AGENT_MODE=mock F1_EVIDENCE_DIR=<evidence>/ci-base-integration node apps/f1/test-drives/assets/refinement-recommendations-mock.mjs
F1_AGENT_MODE=mock F1_EVIDENCE_DIR=<evidence>/ci-base-integration bun apps/f1/test-drives/assets/qa-question-restart.mjs
```

- Build passed after preserving the video-contract argument through the new
  question-result normalization wrapper. The initial build caught the missing
  argument introduced by automatic merging.
- Mocked issue/session execution produced recommendations and waited without
  accepting them. Real headless dashboard submission and an existing-session
  ticket reply each resumed exactly one mocked agent turn and one receipt.
- Restart preserved an unchanged QA wait and its question batch identity.
  Changed recommendations and subsequent batches rejected stale contextual
  answers with HTTP 409. Explicit answers alone resumed capture and QA.
- The eight affected suites passed 201 tests. The additional contract-forwarding
  regression passed: opted-in scope/capture reject missing video contracts,
  valid video captures and legacy captures remain accepted. All prior 14 video
  tests also passed. The regression fixture includes the schema's default empty
  unavailable list.
- Inspected the generated desktop screenshot: both recommendations and reasons
  are readable, with an explicit Send answers button. The owned browser session
  and fixture servers closed successfully.

## Evidence and limitations

Receipts are retained in the supplied evidence directory under
`ci-base-integration/`: `qa83-mock-path.json`, `qa83-mock-commands.json`,
`qa-question-restart.json` and `qa83-mock-defaults.png`.

This drive validates orchestration with mocked agent output. Existing authentic
video and caption evidence remains historical; no new recording, native
Safari/iOS playback or Playwright fallback is claimed. Live ticket synchronization
was not independently checked and remains runtime-owned.
