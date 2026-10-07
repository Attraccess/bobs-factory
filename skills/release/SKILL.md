---
name: release
description: Prepare or validate a Bob’s Factory binary release candidate when the user requests a release.
---

# Binary release candidates

Read `apps/cli/RELEASING.md` and `docs/distribution/README.md` before release work.
Follow the canonical F1 applicability policy for the full payload. Build from an
immutable reviewed SHA and committed exact version. Require native runtime smoke,
prepared-agent/helper validation and preservation evidence for all four targets.

`binary-build.yml` builds and verifies only. It never publishes. Workspace npm
packages are private; historical upstream scripts in `scripts/archive` are retired.
Report concrete validation blockers before publication. A live release requires
an explicit user request and a separately implemented publisher with verified
artifact provenance, immutable version protection and recoverable replacement.
