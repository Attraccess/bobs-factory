# Chat activity timeline and follow-latest scrolling

Date: 2026-10-04. Tested `be5f49f` plus Taskbot #18 UI changes.

## Scenario

A fresh CLI tracker/repository routes a label-selected workflow through a real
Codex clarification role, a real inspection role, and a script that waits for
four controlled update markers. Verify rendered conversations through the local
factory dashboard while updates arrive. Production agents remain untouched.

## Execution and assertions

- Fresh repository `/tmp/factory-chat-drive`; worker home
  `/tmp/factory-chat-fixture`; UI 3483 / F1 CLI RPC 3484.
- `CYRUS_PORT=3484 apps/f1/f1 create-issue --title 'Chat timeline live updates'
  --description 'Read and answer clarification once, then verify activity scrolling.'
  --labels 'workflow:chat-drive'` created DEF-2 / issue-2.
- `start-session --issue-id issue-2` created session-2. `view-session` confirmed
  timestamped thought/action activities, including factory context MCP calls.
- In the T3 collaborative browser, answered the clarification form. The form
  remained in Activity, the answer appeared exactly once in a right-aligned human
  bubble, and the next clarification pass accepted the answer.
- The inspection role read context, ran `pwd`, read README and ran `git status`.
  Agent prose rendered as chat messages; consecutive context/command activities
  shared expandable summaries. Tool rows retained original command/result data.
- Opening Activity followed the bottom. `update-1` produced a new script message;
  the scroll gap stayed within one pixel and the latest button stayed hidden.
- Scrolled upward 700 pixels. `update-2` arrived; `scrollTop` stayed exactly
  1290.5 and the floating latest button remained visible.
- Expanded a tool group and its first row. `update-3` arrived; both stayed open
  and `scrollTop` stayed exactly 1165.5. Switching to Artifacts and back retained
  that position and expansion.
- Clicking Scroll to latest restored following while agent messages streamed.
  A manual bottom return racing a live update on mobile exposed a queued-scroll
  event race; checking the actual bottom position before replacing the timeline
  fixes it. A second F1 script-only DEF-3/session-3 drive supplies 150 history
  entries plus controlled updates to recheck both scroll directions and pagination.
- Final mobile race drive: manually scrolled away, then `update-7` arrived with
  scrollTop retained exactly at 6076.5 and the latest button visible. Returned
  manually to the bottom before `update-8` and completion; following resumed,
  the gap stayed within one pixel and the button was hidden. There was no
  horizontal overflow at 390×844.
- Loaded 32 earlier rows while reading: the visible message anchor retained its
  exact offset of -10.953125 pixels despite the prepended history. The pagination
  button disappeared when all available rows were loaded.
- A native T3 browser recording was captured and a frame inspected visually.
  The snapshot endpoint repeatedly returned an automation error; recording and
  DOM/geometry assertions worked. No alternate browser automation was used.

An initial fixture always returned `ready: false`, so it repeated clarification;
that fixture was stopped and replaced by the conditional-answer DEF-2 scenario.
Browser checks exposed and fixed a new data attribute colliding with run-row
click handlers before the final passing checks. The fixture worker was stopped
following validation.

## Other verification

Nine focused activity/API tests passed, including tool grouping across role/user
boundaries, retained human replies, paired tool failures, escaped content and
protected routes. JS syntax, targeted Biome, diff checks and required workspace
build/typecheck hooks passed. UI assets are read on every request, allowing local
rollout without terminating or restarting active production sessions.

This validates presentation and scrolling, not a new runner integration or an
entire software-factory delivery pipeline.
