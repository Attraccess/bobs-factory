# Video evidence with proxy connection recovery

Date: 2026-10-08. PR #33 head before integration: `45141d9c707961080957d92145de8d98d86bab09`. Fetched base: `eebe4d14` (PR #45). The merged working tree was tested before committing. Only the changelog conflicted; both entries were retained.

## Applicability and scenario

F1 applies to the inherited dashboard connection behavior and protected video workflow. Validation used isolated homes, an in-memory CLI issue tracker, injected simulated agents, and an isolated authentication session. No production credentials, tracker mutations or provider calls were used.

## Executed checks

- 236 focused tests passed across FactoryServer, FactoryWebClient, FactoryPwa, FactoryAuth, FactoryAccess, Video, WorkflowRuntime and capture recovery. Edge-worker build, type checking, Biome and diff checks passed.
- With `F1_AGENT_MODE=mock`, replayed the existing execution-profile video fixture. Four linked scenario mutations rejected old evidence; an unrelated story reused it and passed the video gate. Identity and tool settings survived failure and restart. Cleanup deleted 200 assets on the first startup and six remaining assets on the second; expired media returned 410 while history and metadata remained.
- Started a fresh isolated FactoryServer using existing authentic recorded media. Unsigned media requests returned 401. An authenticated byte range returned 206 with exactly the first ten media bytes.
- Used `agent-browser --headed false --session ci-proxy-919d6148` against `http://localhost:46932`. Saved capacity 6 through Settings. Replaced the owned page's capacity-write fetch with an HTML 403 response lacking a Factory build header. The UI showed Retry connection and disabled Save, retaining draft 5. Restoring fetch and retrying enabled Save; resubmission stored 5 without an update prompt.
- Opened the review guide, activated its lazy video, observed playback advancement and sought near the end. The guide's approval remained pending. Inspected a 390-by-844 screenshot showing native controls, transcript and representative screenshot.

## Evidence and cleanup

Drivers and screenshots are in `/Users/jappy/.cyrus/factory/evidence/manual-30032642-7584-4d54-9ff6-0baa919d6148/ci-proxy-integration/`. Replay driver: sibling `ci-execution-integration/video-replay-drive.ts`; receipt: `ci-execution-integration/video-replay-receipt.json`. Browser session and fixture server were stopped.

Initial fixture setup omitted the capacity subscription hook; adding that fixture-only hook allowed startup. Readback assertions were corrected to use `/api/config`, and a browser assertion was rerun in a scoped function after a duplicate declaration. These were validation-driver errors; product code needed no additional correction.

This validates simulated orchestration and replay of authentic historical media, not fresh capture or real-model behavior. The browser uses an isolated pre-created session, not a physical passkey ceremony. Native Safari/iOS and live ticket synchronization remain unverified.
