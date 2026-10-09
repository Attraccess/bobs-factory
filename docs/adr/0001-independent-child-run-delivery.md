# Shared proposal approval and independent child delivery

Status: accepted vocabulary and architecture proposal surface; independent child delivery planned.

Taskbot #90 introduces repository-grounded architecture discussion before implementation.
The human selected discussion-driven revision through existing chat, questions and decision
UI. A direct collaborative document editor and a synchronization dependency are unnecessary.

Use one versioned proposal surface for Factory and Takeover. Bind explicit acceptance to
the reviewed architecture, complete candidate plan and immutable asset snapshots. Meaningful
choices wait for acceptance; routine unsplit work records a bypass reason. Explanation is
not an answer or authorization. Final delivered-revision approval remains separate.

The shared surface permits later combined architecture/scope/dependency approval (#91
and #98) without another independent design gate. Do not accept arbitrary extension
payloads today. Any future child scope and dependency contract needs explicit validation.

A nested workflow currently shares parent outputs and checkpoint recovery. It does not
represent independent delivery. #97 owns independent child execution, scheduling and
recovery. #98 owns child scopes, requirement allocation and dependencies in the combined
proposal. #99 owns combined validation and final acceptance. These responsibilities are
planned work, not capabilities implemented by #90. #100 provides research ideas and does
not authorize adoption of an external runtime or HumanLayer libraries.

Consequences: proposal identity survives restart, human feedback creates a newly reviewed
version, and implementation receives one self-contained accepted plan rather than ticket
history. Takeover preserves inherited work and its original PR and branch. Recipes changes
apply to new launches; frozen accepted runs retain their definitions.
