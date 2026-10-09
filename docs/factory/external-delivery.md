# External ticket delivery and recovery

Standard Factory shares clarification, decisions, planning and plan review across
three delivery modes. Repository includes code, repository documentation and
configuration. External currently supports ticket titles, descriptions and
blocks/related relationships through configured Taskbot and native Linear
integrations. Mixed delivers both. An empty branch never selects external mode.

The accepted plan records a `delivery-v1` contract with a separate authorization
reference. Deferral stays deferred; “no repository changes” can authorize ticket
changes. Plan review confirms its digest before execution. Every resource needs
verified instance, workspace/project, immutable ID and URL; complete before-state;
required integration capabilities; specific field/relationship operations; preserved
relationships; expected content and criterion references. The execution reference
is the canonical SHA-256 digest of the retained execution snapshot.

Taskbot uses the run's configured transport and tool permissions. Native Linear
uses the configured workspace integration in Legacy mode and checks tool permissions.
Explicit execution profiles without a native tracker credential binding are blocked,
rather than silently substituting the operator's native credentials. Read/capability
preflight is non-mutating and cannot guarantee the provider will accept a later write.
Providers without conditional writes retain a concurrency limitation in the guide.

Runtime tracking owns originating-ticket lifecycle status, lifecycle comments and
PR links. Delivery operations cannot mutate those fields. Intent and before-state
are saved before each dispatch. Retry reads actual state, recognizes achieved
outcomes, preserves successful receipts and applies only remaining operations.
Conflicts, denied writes and uncertain outcomes retain progress; there is no automatic
rollback. Retrying a conflict does not approve overwriting the observed edit; a
reviewed contract correction is required. Successful relationship writes reconcile
both ticket endpoints before subsequent operations. Complete relationship reads include both directions and follow pagination.

The independent verifier reads all resources twice, checks every criterion and
preserved relationship, and rejects changes observed during collection. External
review includes linked tickets, readable before/after state, operation history,
criterion evidence and limitations. **Accept completed work** binds the persisted
digest. **Request changes** retains the edits and feedback and returns through
reviewed planning, reconciliation and fresh verification. Revisions need new operation
IDs when their intent changes. Final reads must match accepted content and relationships;
drift requires renewed verification and acceptance. Lifecycle updates are excluded.

External delivery skips publication, code-diff review, CI, Git-baseline QA and merge.
Repository delivery keeps the existing pipeline. Mixed guides include external
evidence and approval binds both the external digest and all repository revisions.
Mixed requests for changes before merge return through planning and plan review
to renew the ticket contract, then resume corrections on the existing repository
work and PR. Already-confirmed merges remain retained if external completion later
blocks. Renewed external acceptance after multiple repository merges binds the
complete repository scope and fresh ticket digest in one human decision.

## Recover already-applied work failed at publication

The historical NG-850 run `956de934-9610-406a-b9de-ea3d209be39f` is a motivating
example, not an instruction to recover production or repeat its edits. Historical
executor claims about NG-850–854 and NG-844 must be checked against current state.

1. Open the failed run in the authenticated dashboard. Recovery is eligible only for
   an idle failed `draft-pr` run with a verified originating ticket and no competing
   active owner. Restore integration access and the retained run session first.
2. Review an authorized **external** `delivery-v1` contract. Include the originating
   ticket, every required target and relationship, full expected content, original
   before-state and preserved relations. Confirm the retained execution reference.
   Do not derive authorization from a clean tree or failed publication.
3. Expand **Recover already-applied external ticket work**, paste the contract and
   explicitly confirm its review and authorization. Submit **Verify existing work
   for external review**. The operator's authenticated passkey identity and time
   are recorded with the contract, original workflow and checkpoint.
4. Recovery reconciles and independently verifies current state. It does not invoke
   the original implementation or mutation step. Missing access, incomplete reads,
   unmet outcomes or conflicts stay blocked. Original outputs, answers, decisions,
   history, native conversations and repository receipts remain retained.
5. Inspect the new guide and explicitly accept its snapshot or request corrections.
   Recovery never completes automatically. A final matching read is required.

Automation can use `POST /api/runs/:id/external-recovery` with an authenticated
Factory session and exact Origin. The body contains `requestId`, `contract` and
`reviewedDigest` (SHA-256 of recursively key-sorted JSON; arrays retain order).
Reuse the same request ID and contract for a retry; changed inputs cannot reuse an
accepted request ID. The original frozen workflow remains untouched; the audited
execution overlay survives restart. Do not log session tokens or credentials.

Tracking errors remain visible in `ticketSync` and activity. After restoring access,
use `POST /api/runs/:id/ticket-sync` to retry only tracking. External Done delivery
performs another state check, so a delayed retry cannot silently close changed work.
If state drifted, renew verification and human acceptance before retrying closure.

If delayed completion loses its matching state proof, open the completed run's
review and select **Reverify ticket changes**. This authenticated action retains
applied changes and merge receipts, retires the stale completion receipt and
resumes only independent verification. Review and explicitly accept the fresh
evidence before closure. It is separate from tracking-only retry and does not
repeat ticket mutations or repository publication.
