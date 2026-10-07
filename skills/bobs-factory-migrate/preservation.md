# Native conversations and external backups

Use this branch after discovery finds saved agent sessions, external service files,
conversation stores or a capacity directory outside the source home. Keep this
plan and all proofs private, mode 0600; they contain paths and identifiers.

Pass `--preservation-plan PRIVATE_PLAN.json` to `migration inspect` and `preview`.
The strict version-1 format is:

```json
{
  "version": 1,
  "backupPaths": ["/absolute/service-definition", "/absolute/native-transcript"],
  "restorePaths": ["/absolute/service-definition"],
  "nativeCopies": [{"source": "/absolute/conversation-only-directory", "destination": "/absolute/absent-new-project-directory"}],
  "continuations": [{
    "runner": "codex",
    "sessionId": "original-provider-id",
    "workspace": "/absolute/old-home/worktrees/ISSUE",
    "evidencePath": "/absolute/private-continuation-proof.json",
    "evidenceSha256": "64-lowercase-hex-digits"
  }]
}
```

Every collection defaults to empty. Paths must be absolute and disjoint from both
state homes; external backup paths must not overlap each other. The helper already
backs up affected external Git worktree administration. Native copy destinations
must be absent and outside state homes. Select transcripts only; credential files
are refused. A provider with global session lookup may need no native copy.

`backupPaths` are copied and verified without modifying the originals. Only paths
also named in `restorePaths` are restored automatically. Use that list for approved
service-definition changes. Leave host credential stores out of `restorePaths`:
restoring them can overwrite authentication refreshed after migration. The helper
preserves current files under `external-recovery` before restoring approved files.

For every saved operational native session, perform an actual continuation using
the original ID and the planned relocated workspace. Confirm remembered context,
correct workspace, tool permission boundaries and unchanged identity. Provider
storage formats differ; use documented behavior and preserve original stores.
For path-based lookup, first back up, then test a disposable mapping at the planned
path. Verify all trial changes and remove only the owned disposable trial before
preview, because apply requires an absent destination. Never test inside an existing
destination or allow old and new workers to run together.

Only after that check passes, create a proof with these fields:

```json
{
  "runner": "codex",
  "sessionId": "original-provider-id",
  "originalWorkspace": "/absolute/old-home/worktrees/ISSUE",
  "relocatedWorkspace": "/absolute/new-home/worktrees/ISSUE",
  "verifiedAt": "ISO-8601 timestamp",
  "command": "redacted exact continuation command and observed assertion",
  "outcome": "passed"
}
```

Hash its exact bytes and enter the SHA-256 in the plan. The helper checks identity,
paths, timestamp and digest; it cannot establish provider success from a record.
The assistant must produce proof from observed execution, never an assumed result.
Missing session IDs, inaccessible stores or failed continuation block cutover.
Keep full provider transcripts private; share redacted assertions only.

Apply rechecks all source/external snapshots, copies from verified backups, marks
owned native-copy destinations and repairs registered Git worktree links. Restore
retains new destination and native-copy work in recovery directories, restores
Git backlinks and the explicitly approved external paths, and leaves original
native stores intact. Read the journal after any interruption; a partial recovery
requires reconciliation before retry. Helpers never enable or disable services.
