# CI watch output stays out of chat

Date: 2026-10-05. Tested `4256f03` plus Taskbot #19 changes.

## Scenario and result

A fresh CLI issue runs a script providing a fixture draft PR, then calls an
internal shared workflow containing the built-in CI tool under a custom step
ID (`pipeline/check-builds`). Git is real; a local `gh` fixture reports the
current Git head, prints 30 repeated refresh banners/check tables in separate
stdout chunks, waits for an explicit gate, then returns successful check JSON.
This exercises the actual CI command/runtime/event path without network changes.

- Worker home `/tmp/factory-ci-chat-fixture`, repository
  `/tmp/factory-ci-chat-drive`; UI 3485 / F1 RPC 3486.
- `CYRUS_PORT=3486 apps/f1/f1 create-issue --title 'CI polling stays out of chat'
  --description 'Wait for fixture checks and show one compact CI status.'
  --labels 'workflow:ci-chat'` created DEF-1 / issue-1.
- `start-session --issue-id issue-1` created session-1. `view-session` confirmed
  issue routing activities. The run retained 67 events while checks waited.
- T3 browser showed exactly one `Waiting for PR checks…` entry, stable key
  `ci/pipeline/check-builds`; no refresh banner, table fragments or job URLs
  appeared in the conversation. The scroll stayed at the latest message.
- Creating `allow-ci` released the real CI-tool invocation. The same entry
  changed to `PR checks passed.` and retained the structured check/head details;
  no repeated watch receipt appeared in chat. Run completed normally.
- Read-only check of the operator's existing ATT-1127 run confirmed one
  `Waiting for PR checks…` entry, no polling noise, agent messages retained,
  no UI error and latest position preserved.

The fixture worker was stopped after verification. GitHub responses are stubbed;
this drive validates activity presentation rather than actual GitHub CI.

## Other verification

Ten focused activity/API tests passed. CI cases cover 200 fragmented messages,
shared/custom IDs, stable status keys, completed success, failure diagnostics,
needs-attention status and retained agent repair messages. JavaScript syntax,
Biome/diff checks and required workspace build/typecheck hooks passed.

CI command output and receipts remain stored on the run. Consolidation happens
before history pagination and does not change command execution or persisted
sessions. Static UI rollout did not restart or stop the production service.
