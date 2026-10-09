# Factory operator MCP

External coding agents can inspect and recover workflow runs using the independent
`bobs-factory-operator` MCP server. It works with CLI/manual installations without
Linear. The running worker starts a separate authenticated loopback listener; the
stdio client connects to that worker and never starts another instance.

Operator grants are separate from dashboard passkeys. They cannot approve reviews,
merge deliveries, reset passkeys, modify arbitrary run state, or directly mark a
coding ticket Done. Dashboard APIs continue to require a passkey session.

## Local owner setup

Start the worker with `bobs-factory local` or `bobs-factory start`. Use the same
Factory home for the worker, owner commands and MCP client. The default home is
`~/.bobs-factory`.

```sh
bobs-factory --home ~/.bobs-factory operator grant \
  --label 'Coding agent' --scopes inspect,operate,configure
bobs-factory --home ~/.bobs-factory operator list
bobs-factory --home ~/.bobs-factory operator revoke GRANT_ID
```

Grant output contains metadata and `credentialFile`, not a bearer token. The
verification store retains hashes; the client credential file is private (0600)
and its directory is private (0700). Do not paste the file contents into tickets,
client tool arguments or logs. Grant issuance and revocation require local file
ownership. Revocation affects existing connections on their next call and survives
restart. It does not change dashboard authentication.

Capabilities are independent:

| Capability | Operations |
| --- | --- |
| `inspect` | List/inspect runs, read workflow activity, inspect/check MCP connections |
| `operate` | Retry, resume, stop, answer, steer, retry ticket synchronization |
| `configure` | Update owned MCP connections and matching permissions |

Grant only the needed capabilities. For recovery, `inspect,operate,configure`
provides all three. Discovery lists only tools permitted by the grant.

Configure a stdio MCP client using the returned private file path:

```json
{
  "mcpServers": {
    "bobs-factory-operator": {
      "command": "/absolute/path/to/bobs-factory",
      "args": [
        "operator-mcp", "--home", "/absolute/path/to/.bobs-factory",
        "--credential-file", "/absolute/path/to/.bobs-factory/factory/operator/client-GRANT_ID.json"
      ]
    }
  }
}
```

For checkout development, use `node apps/cli/dist/src/app.js operator-mcp ...`
after building the CLI and its workspace dependencies. The compiled executable
supports the same commands. `operator-mcp` must be the first command argument;
its `--home` selects the instance without loading the worker's environment file.
Stdout carries only MCP protocol traffic. Remote clients need an explicitly
configured host-side stdio bridge; this interface does not bind a public listener.

An absent worker returns `instance_unavailable`. A credential from another home
returns `wrong_instance` or `unauthorized`. Select the correct home or issue a new
grant there; copying another instance's grant does not authorize access.

## Tools and state context

Discover the exact input schemas and descriptions with MCP `tools/list`. Calls
return structured `{ok: true, result: ...}` results or
`{ok: false, error: {code, message}}`. Run results identify the instance and run.

| Tool | Behavior |
| --- | --- |
| `list_runs` | Filter by status/repository; `offset` and `limit` (1–50) page summaries |
| `inspect_run` | Failure, pending questions, execution/connection diagnosis, progress and action eligibility |
| `read_run_activity` | Page sanitized workflow events; agent payloads are excluded |
| `retry_run` | Retry a failed run through its existing checkpoint |
| `resume_run` | Resume an interrupted run with saved progress |
| `retry_ticket_sync` | Retry tracker synchronization only |
| `stop_run` | Stop an active/waiting/interrupted run and retain work |
| `answer_run` | Answer current questions or request an explanation with `kind: "explanation"` |
| `steer_run` | Send a message through enabled and currently available workflow chat |
| `inspect_mcp_connections` | Actual runner, source provenance, endpoint, permission decision, authentication mechanism and configuration revision |
| `update_mcp_connection` | Revision-checked HTTP/SSE connection plus explicit exact tool permissions |
| `check_mcp_connection` | Read the originating Taskbot ticket, or select `server` for read-only tool discovery through the run's actual transport |

Follow `nextOffset` until null to read all pages. Activity, error and question text
is sanitized and bounded. Inspection does not expose snapshots, environments,
provider bodies or credentials. Ticket synchronization includes the most recent
25 receipt summaries and retains errors/limitations.

Run mutations require `expectedRevision` from a fresh `inspect_run` result.
`answer_run` additionally requires its complete `questionContext` as `context`.
Changed questions, batches or steps reject without answering. An explanation
request remains an explanation; it does not count as an answer or approval.
Parallel mutations are serialized per run, and stale requests reject without
replaying work. Accepted action receipts distinguish accepted recovery from
completed recovery; inspect again to observe progress.

Completed, stopped, active and pending-human-review runs are not resumable merely
because they have a checkpoint. Retry/resume retains completed outputs, publication
receipts, evidence and decisions. Steering follows the accepted recipe and actual
runner availability. Human review remains a dashboard/human decision.

## Other connection checks

Call `check_mcp_connection` with `{ "runId": "...", "server": "server-name" }`
using a server returned by `inspect_mcp_connections`. This performs MCP `tools/list`
through the run's effective transport, including native Codex authentication for
HTTP connections. It invokes no provider tools and returns no catalog or provider
contents. The check confirms connectivity and discovery, not permission to execute
any particular tool. Effective allow/deny rules still govern every tool call.

Without `server`, Taskbot runs keep reading their originating ticket. Other runs
select their sole configured server, or return `ambiguous_transport` when a server
must be selected. Checks have a 15-second deadline and close their transport.
Local restarts persist the selected `--agent` and `--model` alongside retained
connection repairs so later configuration reloads use the same launch settings.
Omitting `--model` restores provider defaults.

## Taskbot recovery walkthrough

1. Call `inspect_run` with the failed run ID. Read its status, failure and eligibility.
2. Call `inspect_mcp_connections`. Confirm the actual runner, retained Taskbot
   instance/server, matching connection count and effective tool permissions.
   A failed initial setup can use its original exact Taskbot URL for a constrained
   read check; ticket data is verified by the existing tracker adapter.
3. Call `update_mcp_connection` using `configRevision` from that inspection:

   ```json
   {
     "runId": "FAILED_RUN_ID",
     "expectedConfigRevision": "INSPECTED_REVISION",
     "server": "taskbot",
     "connection": { "type": "http", "url": "https://taskbot.example/mcp" },
     "permissions": ["get_ticket", "set_status", "comment", "add_attachment"]
   }
   ```

   The server name must match the retained ticket identity. The endpoint must
   not embed credentials or query parameters. Headers accept environment
   references, for example `"headers": {"Authorization": {"env": "TASKBOT_AUTHORIZATION"}}`.
   The referenced value includes any required `Bearer ` prefix and must already
   exist in the worker's accepted execution environment. No secret value is stored
   in the repair request or managed connection file.
4. Read both `persisted` and `applied`. The legacy repair creates an immutable
   owned overlay, then atomically commits the connection source and exact
   permissions in the configuration file. Other sources/settings remain intact.
   Worker reload must be observed and effective connection/permissions must be
   rechecked before `applied: true` is returned. A reload failure means the repair
   is saved but is not yet confirmed effective; inspect again before retrying.
5. Call `check_mcp_connection`. This invokes only `get_ticket` for the originating
   project and ticket ID, with a 15-second transport deadline, and returns
   diagnostic evidence without ticket contents. It cannot invoke arbitrary tools.
   Other trackers/connections currently return `unsupported_probe`.
6. Obtain a new run revision and call `retry_run`. Initial Taskbot setup retries
   check connectivity before acceptance. If authentication is missing, recovery
   remains failed instead of queueing another setup attempt. Inspect again to
   confirm setup advanced and the same run continued.
7. If only ticket updates failed, use `retry_ticket_sync` to retry tracking without
   replaying implementation. Runtime remains responsible for lifecycle comments,
   links and provider-confirmed completion.

Adding an endpoint does not supply another runner's authentication. Codex HTTP
calls use native Codex MCP authentication. Other runners use direct transport and
configured headers. A direct HTTP `unauthorized` response is an authentication
blocker, even if a Codex check succeeds. The operator never copies native credentials
or silently switches the accepted runner.

Legacy repository repairs require a regular configuration file inside the selected
Factory home. External/native files remain read-only; an owned overlay can preserve
external sources while repairing their selected server. Local launches retain
repairs in `local-config.json`. A local home retains its repository identity;
select the same repository on restart, or use a separate home for a different repository. Deny permissions take precedence and are never
removed automatically. Reserved `factory-context` and operator server identities
cannot be updated through this tool.

For explicit profiles, supply `profileId` to update a saved tool profile using its
existing schema/store. Matching exact permissions are retained in `allowTools`;
`denyTools` still wins. This affects future launches. The result says
`scope: "future_launches", applied: false`; existing runs keep their frozen profile
and runner. A legacy repair on a frozen profile returns `frozen_configuration`.
Choose the updated profile in a new launch rather than rewriting the run snapshot.

Stable error categories include `not_found`, `unauthorized`, `insufficient_scope`,
`invalid_request`, `stale_state`, `stale_configuration`, `invalid_state`,
`workflow_restriction`, `unsupported_source`, `frozen_configuration`,
`missing_transport`, `ambiguous_transport`, `denied_tool`, `missing_authentication`,
`connectivity_failure`, `unsupported_probe`, and `reload_failure`. Provider error
bodies are suppressed. A stale owner lock requires inspecting the owning process
before removing it; grant/configuration operations do not silently break locks.
