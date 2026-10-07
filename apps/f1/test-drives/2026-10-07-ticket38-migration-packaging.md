# Ticket 38: migration, queue recovery and packaged SDK boundaries

Runtime/session/capacity migration changes require relevant F1 coverage. These
focused drives supplement the earlier ticket-38 Codex report. They do not prove
four-target compatibility, authenticated Cursor execution or release licensing.

## Environment

Dirty worktree at base `03eb236570295fd047084b98a9a5a28851db4f9d`, macOS ARM64
26.6.2, Bun 1.4.2, prepared Codex 0.160.1 and isolated disposable state/worktrees.
Native ARM64 Debian bookworm Docker provided Linux ARM64 smoke with glibc 2.36.
All credentials stayed in their existing stores; no tracker mutation or PR occurred.

## Waiting checkpoint and native continuation

The fixture ran a completed script receipt, a Codex clarifier using factory-context,
and a final receipt. Its frozen recipe retained a custom Cyrus display name.
After it waited, the test worker stopped. A disposable relocated checkout resumed
Codex session `01a113b1-e200-7122-aa6f-0bb3c7b7c848`, remembered `WAIT38` and left
checkout contents unchanged. Its verified record was supplied to preview/apply.

Apply retained the question, original checkpoint/native ID, history and completed
receipt, and repaired real Git worktree backlinks. Restarting at the new home and
answering eventually completed the frozen workflow through fresh MCP tools.
Receipt count was one; visit counts were receipt=1, clarify=3, finish=1. Ordinary
answer-driven graph visits start a new agent conversation; the pre-cutover provider
conversation remains preserved. This is not proof that every answer visit uses one ID.

The first clarifier fixture incorrectly banned MCP tools and was abandoned. A
subsequent older binary reported unavailable MCP tools on one answer visit. A retry
with the current development binary called list_context/read_context and finished.
The failed attempt remains a limitation; its cause was not isolated. Direct native
app-server probes could read the packaged server's /answers; no guessed readiness
barrier or backend change was added.

The test worker stopped before restore. Restore returned original Git registrations
and retained the new completed state under the backup's destination-recovery path.
Source state and native credential stores remained intact. Older abandoned fixture
state is retained, inactive, rather than deleting its evidence.

## Durable queued work

A source MachineCapacity coordinator with one slot created two real queued,
recoverable requests behind a holder. Shutdown parked both requests. Preview/apply
validated the actual persisted schema and relocated identities for factory-run and
native-session leaves, including an OS path alias. This exposed and fixed an earlier
path-prefix bug that a simplified fixture had missed.

A relocated coordinator held its slot while reattaching the two requests in reverse
order. After releasing the holder, execution order remained first, second. Queue
metadata and IDs survived; restore passed. Cutover uses the exact canonical home
printed in the manifest. A corrupt incomplete coordinator fixture is rejected before
creating any destination or backup. The same schema now serves runtime and migration.

A separate persisted unapproved human-review fixture retained the original head SHA,
waiting checkpoint, empty decision array, accepted recipe, history and ticket receipts.
This is targeted preservation evidence, not a real remote PR approval/merge drive.

## Packaging and limits

Four development artifacts compiled with matching target-native Cursor packages.
Native Darwin/Linux ARM64 installation and smoke passed: no factory Node/Bun/npm on
PATH, local SDK create/resume, executable permission hook, startup/assets/API/MCP,
shutdown/restart. Those runtime artifacts precede the final queue/schema source fix;
final refresh remains pending the Cursor packaging rights decision.

Prepared Claude reached its native protocol but the isolated account lacked login.
Using the host account encountered the expected live legacy-capacity barrier; no
operator worker was stopped and no barrier bypass was used. Cursor authenticated
turns require an unavailable CURSOR_API_KEY. Intel Mac/Linux x64 native execution,
minimum OS/libc/CPU evidence, final immutable CI and redistribution/source compliance
remain blocked or unverified. Cross-build and local SDK storage are not substitutes.

Latest source root build/typecheck passed, CLI 119 tests and capacity 10 tests passed.
Earlier Cursor/config-updater suites passed 44/52 tests. Earlier whole-package checks
passed 2,419 tests with two skipped. Biome has no errors, 27 warnings/seven infos.
The two existing high audit warnings are covered by the recorded human exception.

Redacted receipts and earlier website screenshots are in the run evidence directory
`manual-7f0c7c6e-cca1-4387-b7ee-7d81e06997ba`. Private homes, backups and full native
transcripts were not copied into that directory. No release or lifecycle mutation
was performed.
