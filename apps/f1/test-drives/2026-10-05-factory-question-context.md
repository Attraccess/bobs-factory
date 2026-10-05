# Self-contained factory questions

Date: 2026-10-05. Tested `fb3abd2b` plus this change's working tree.

## Applicability and scenario

F1 applies because runtime-generated instructions and the human-question renderer
change. A real Codex clarifier receives a fictional dependency-policy blocker
through the CLI issue tracker. The question must state the relevant facts,
source, uncertainty and consequences beside the answer box. A request to explain
must leave the decision unresolved; only an explicit decision may advance the
two-step fixture to its answer receipt.

The fresh repository is `/tmp/factory-question-context-drive`, worker home
`/tmp/factory-question-context-home`, dashboard port 3529 and F1 RPC port 3600.
The isolated worker uses the built EdgeWorker, CLI tracker, activity sink,
worktrees, actual factory-context MCP and Codex / `gpt-6.1-sol`. Its custom
`question-context` recipe contains the real clarifier and a receipt script;
no GitHub publication or product implementation is attempted. The fixture
wrapper appends a fenced text flow and a previously inspected dashboard image
to the native question to exercise optional visual presentation. These appended
visuals are fixture inputs, not agent-generated security evidence.

## Execution and assertions

```sh
apps/f1/f1 init-test-repo --path /tmp/factory-question-context-drive
node /tmp/factory-question-context-worker.mjs
CYRUS_PORT=3600 apps/f1/f1 ping
CYRUS_PORT=3600 apps/f1/f1 create-issue --title 'Choose whether existing warnings block delivery' --description '<fictional existing warnings and zero-warning rule>' --labels 'workflow:question-context,codex'
CYRUS_PORT=3600 apps/f1/f1 start-session --issue-id issue-1
CYRUS_PORT=3600 apps/f1/f1 view-session --session-id session-1 --limit 12
CYRUS_PORT=3600 apps/f1/f1 prompt-session --session-id session-1 --message 'Please explain this more simply. I have not chosen either option and am not approving an exception.'
```

- DEF-1 / session-1 routed to the custom recipe and real worktree. The initial
  question identified the existing warnings, policy source and missing risk
  evidence, and distinguished proceeding from waiting. It was too wordy, so
  guidance was tightened to short sentences, plain terms and usually fewer than
  100 words. No source-text assertions were added for wording.
- The worker shut down gracefully and restarted with the final guidance. Its
  unanswered question, frozen recipe, history and empty answer list survived.
- The F1 explanation request reran only clarification. The native result still
  contained one question and no accepted decision. The receipt script did not
  execute. The new question used shorter phrasing and included the facts and
  consequences in its own text.
- T3 preview loaded the actual built dashboard. Markdown paragraphs, links and
  two bullet choices rendered beside the answer box; the fenced diagram
  rendered as text. The served image loaded at its actual 1440-pixel source
  width and shrank to its container. At 1280px and 390px viewport widths there
  was no page overflow; at 390px the image and diagram fit within 286px.
  The textarea retained an accessible label referencing the question.
- The explicit fixture-only choice, “Keep delivery paused. I do not authorize
  an exception,” was typed and submitted through the actual question form.
  The API saved the full question plus answer and reran the native clarifier.
  It returned empty questions and a decision explicitly rejecting an exception.
  The receipt script then completed with both human messages retained. Only
  this clarification fixture completed; no delivery workflow was executed.

The preview initially could not reach the loopback listener. A temporary
host/origin-validating proxy on the environment's private LAN address forwarded
only to the isolated fixture. The T3 environment-port navigation then worked.
T3 screenshot/snapshot calls failed; browser checks used its DOM evaluation and
interaction tools. No newly captured screenshot evidence is claimed.

## Checks and limits

- Four focused suites passed: FactoryServer, FactoryPipeline, WorkflowRuntime
  and FactoryWebClient, 72 tests total. The new API regression checks exact PNG
  bytes and content type, run isolation, missing images, traversal, external
  symlinks and non-image content.
- Root `pnpm build` and `pnpm typecheck` passed. The final wording adjustment
  also passed the edge-worker build. Biome passed with 11 existing CSS warnings;
  `git diff --check` passed. Dependencies and lockfile were unchanged.

Temporary fixture code, logs and runtime receipts remain under
`/tmp/factory-question-context-*` for inspection. The policy and warning names
are fictional. The image illustrates dashboard rendering only. This drive
does not establish exploitability, real dependency safety, native-device
behavior or remote PR delivery.
The completed fixture worker and its temporary preview proxy were stopped
gracefully after saving the final run receipt.
