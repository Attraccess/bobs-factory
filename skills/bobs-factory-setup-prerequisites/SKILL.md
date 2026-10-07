---
name: bobs-factory-setup-prerequisites
description: Check a Bob’s Factory binary installation and prepared Git, delivery and coding-agent tools.
---

# Prerequisites

Check `bobs-factory --version` and `--help`. If absent, guide the user through
versioned binary installation in `docs/distribution/README.md`. Validate platform
and checksum before installation. The factory does not require Node, npm or Bun.

Check Git and, for GitHub delivery, `gh auth status`. Check the selected agent's
CLI and authenticated status through its supported commands. Users own agent
installation and authentication; do not install or log tools in automatically.
Agent launchers may need their own runtime. Project dependencies are handled by
the run's workflow/agent. Preserve existing Git/SSH/signing configuration.

Finish when the requested agent is prepared and the executable runs, or report
the concrete missing tool and its setup action. Use isolated state for smoke checks.
