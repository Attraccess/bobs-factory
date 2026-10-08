# Factory Git providers

The Factory workflow uses one provider interface for publishing drafts, takeover,
CI and review discussions, handoff descriptions, and merge confirmation. Git
clone/fetch/commit/push remain ordinary Git operations. Git, SSH, signing and
native `gh`/`glab` credential stores stay host-owned.

GitHub.com and GitLab.com are detected from the repository's origin, including
SSH remotes. Existing `githubUrl` and `gitlabUrl` settings also select their
provider, including self-managed hosts. GitLab subgroup paths are supported.
For other hosts, set the repository's `gitProvider` explicitly in
`~/.bobs-factory/config.json`:

```json
{
  "gitlabUrl": "https://gitlab.example/group/subgroup/repository",
  "gitProvider": { "type": "gitlab" }
}
```

Use `{ "type": "github" }` for GitHub Enterprise. If both URL fields are set,
an explicit selection is required. Unknown hosts never fall back to GitHub.
An accepted run retains its provider and repository coordinates through retry,
restart and merge recovery. Older runs resolve once from current repository
configuration or their existing published request. Retry the failed publication
step after installing this update; completed implementation steps stay retained.

GitLab uses `glab api` with the explicit hostname and encoded project path.
Authenticate that host with `glab auth login --hostname gitlab.example`.
Readiness collects every discussion/comment/job page, approvals, the current
pipeline revision and target branch revision. Failed checks, unresolved discussions,
conflicts and unknown merge rules remain blocking. Missing approval/API evidence
fails closed. Merge sends the explicitly human-approved source SHA to GitLab's
merge endpoint, which enforces repository rules; completion requires a provider
receipt at that same SHA.

## Other providers

Configure a local executable adapter for Bitbucket, Gitea, Azure DevOps or another
forge. An adapter can wrap that host's CLI or API; the Factory workflow does not
change when adding a provider.

```json
{
  "gitProvider": {
    "type": "custom",
    "repositoryUrl": "https://code.example/team/repository",
    "command": "/opt/tools/factory-forge",
    "args": ["--profile", "work"],
    "instructions": "Use factory-forge discussion commands for review replies and resolution. Read its --help for provider-specific CI repair commands."
  }
}
```

The command executes directly, without a shell, in the run's accepted execution
environment. `~/` in the command path expands to the user's home. Authentication
belongs to the adapter's native store or declared execution/tool environment;
never put tokens in arguments, URLs or instructions. Native execution identity
bindings currently cover GitHub/GitLab. Other forge authentication can use Legacy
execution and the adapter's own store; this adapter contract does not add private
identity/account verification for arbitrary providers.

The invocation is:

```text
<command> <args...> <operation> --request <temporary-json-file>
```

The protected request file is removed after the command completes, including on
failure. It contains `{ "version": 1, "repositoryUrl": "...", "input": {...} }`.
Return exactly one JSON value on stdout and diagnostic text on stderr. Exit
nonzero when access, provider policy or evidence is unavailable.

| Operation | Input | JSON response |
| --- | --- | --- |
| `list` | `branch` | Array of `{url,isDraft}` for all open requests on that branch |
| `create` | `branch,baseBranch,title,body` | `{url}` for the created open draft request |
| `view` | `url` | Normalized request below |
| `inspect` | `url` | Normalized request plus `comments,reviews,reviewComments` arrays containing complete discussion |
| `readiness` | `url` | Normalized readiness below |
| `draft` | `url,draft` | `{ "ok": true }` after changing draft status |
| `description` | `url,body` | `{ "ok": true }` after updating the description |
| `merge` | `url,headSha,method` | `{ "ok": true }` after requesting merge, atomically guarded by `headSha` and provider rules |

The normalized request has `url`, positive integer `number`, `title`, `body`,
`headRefName`, `headRefOid`, `baseRefName`, `state` (`OPEN`, `MERGED`, `CLOSED`),
`isDraft`, and `isCrossRepository`. Takeover requires `OPEN` and a same-repository
source branch; forks are rejected. Takeover fetches that branch through Git.

Readiness has `url`, `headSha`, `baseSha` (current target tip), `state`, `isDraft`,
`approved`, `reviewReady`, `fix`, `blockers`, `checks`, `threads`, `comments`,
`reviews`, `queued`, and `mergeMethod` (`squash`, `merge`, `rebase`). Each blocker
has `kind`, `message`, and `action` (`fix`, `wait`, `human`). Each check has `name`,
`state`, `bucket` (`pass`, `fail`, `pending`), and an optional `link`. Comments use
`id`, `body`, optional `html_url`/`updated_at`, and `user.login`/`user.type`.
Review decisions use `id`, `state` and `author.login` as in the GitHub-normalized
receipts. Retain full thread data for the configured discussion tooling.

`approved` means the provider permits merge of this exact revision: no draft,
blockers or failed/pending checks. `reviewReady` permits handoff only when all
remaining blockers are human actions and checks have passed. `fix` is true
exactly when a blocker needs corrective work. Inconsistent receipts are rejected.
Do not treat unavailable checks, truncated discussions or unknown rules as passing.
Adapter request URLs must stay below the configured repository URL. A successful
merge command alone never completes a run; subsequent `view`/`readiness` must
confirm `MERGED` at the approved head.

The built-in GitLab implementation follows the upstream [merge requests API](https://docs.gitlab.com/api/merge_requests/),
[approval API](https://docs.gitlab.com/api/merge_request_approvals/),
[discussions API](https://docs.gitlab.com/api/discussions/) and
[`glab api` contract](https://docs.gitlab.com/cli/api/).
