# Caption timing validation correction

Date: 2026-10-07. Tested base revision: `d9b3f57fcd6a09494bd4b6d046120629f14f268b` with the caption fix uncommitted. SHA-256 of the tested diff for `Video.ts` and `Video.test.ts`: `922a1bbdfef6bdc191d82acb6b7cd8104dc9a8acbc517d46523fac753d7aff21`.

## Scope and execution

Finding `video-caption-timing` failed required criterion `video-media-invalid`. This correction changes Factory runtime evidence acceptance, so F1 applies. Deterministic runners are injected with `F1_AGENT_MODE=mock`; no live agent calls or provider credits were used. Real media probing, decoding, caption validation, runtime retry, evidence gates, persistence and loopback streaming run normally.

```sh
F1_AGENT_MODE=mock FIX_EVIDENCE=/path/to/run/evidence bun node_modules/.cache/f1-caption-fix/drive.ts
F1_AGENT_MODE=mock pnpm --filter cyrus-edge-worker test:run test/Video.test.ts test/FactoryPipeline.test.ts test/Guide.test.ts test/WorkflowRuntime.test.ts
```

The driver is retained as `caption-fix-f1-drive.ts` in the run evidence directory. To replay, copy it to the documented cache path; its relative imports use repository sources and it reads `qa-20261007-authentic-save.mp4` from FIX_EVIDENCE. Disposable fixture home: `/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/f1-caption-fix-WOTG1G`. F1's in-memory tracker created and fetched `issue-1`.

## Assertions and results

- All 124 focused tests passed, including existing media, reuse and retention regressions. Four valid caption variants and fourteen invalid variants exercise audio finalization. Every malformed cue is checked, including a malformed cue after a valid cue and missing block separators. Timestamp ranges, positive intervals and nondecreasing start times are enforced. Valid overlaps, equal starts, cue identifiers/settings, multiline text, BOM/CRLF, comments/styles and long hour forms remain accepted.
- Mocked capture rejects `00:99.000 --> 00:99.500`, reversed `00:04.000 --> 00:01.000`, mixed valid/invalid cues and out-of-order starts. Failed captures expose `/videos/0` correction details, publish no capture and never reach review.
- Correcting the track and retrying completes capture → mocked review → real gate. Each successful capture is stored once. Restart preserves all completed history without replay.
- Strict-index guards were added after the first build caught unchecked indexing. All 14 video tests and the mocked F1 drive passed again; edge-worker build and typecheck passed.
- Validated loopback captions return HTTP 200, exact bytes and `text/vtt; charset=utf-8`.
- A fresh explicitly headless named agent-browser session loaded the validated audio/track. Chromium parsed both cues, reported mode=showing and no media error, and displayed both overlapping cues at 3.5 seconds. The session was closed. The server was stopped after verification.
- The failed criterion has a targeted passing retest receipt in `caption-fix-retest.json`. Fresh pipeline QA, review and gate still assess the committed revision before the human guide.

Timestamp and cue-order rules follow the [WebVTT syntax specification](https://www.w3.org/TR/webvtt1/#webvtt-cue-timings).

## Evidence and limitations

Run evidence includes `caption-fix-f1-results.json`, `caption-fix-browser-cues.json`, `caption-fix-browser.png` and `caption-fix-retest.json`. The browser screenshot depicts a validator fixture using the historical authentic Save clip with a synthetic audio tone; this drive does not claim a new demonstration recording. Workflow playback acceptance was mocked; browser cue parsing/display was executed separately.

No frontend rendering changed and accepted review screenshots were preserved. Native Safari/iOS, Playwright fallback and live production ticket synchronization remain unverified. No production tracker writes, human approval, PR readiness or merge occurred.
