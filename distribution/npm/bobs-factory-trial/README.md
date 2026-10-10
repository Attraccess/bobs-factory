# bobs-factory-trial

This package is a small `npx` launcher for Bob’s Factory’s signed native release
bootstrap. The launcher requires Node.js 20 or newer; the downloaded Factory
runtime does not require Node, npm or Bun. Git, a coding agent and any agent-owned
runtime/login remain separate host prerequisites.

When published, the intended commands are:

```sh
npx --yes bobs-factory-trial
npx --yes bobs-factory-trial --channel nightly
npx --yes bobs-factory-trial --no-open
```

It downloads the official HTTPS bootstrap, which authenticates release metadata
with Bob’s pinned publisher key before installing the matching native archive
into a temporary prefix. The runtime starts in the foreground; the temporary
binary is removed when it exits. Factory state remains under the normal
`~/.bobs-factory` home and can be reused after a permanent install. The trial
does not install a service, change package-manager state or modify update policy.

The name was available in the public npm registry when checked on 2026-10-10,
but it is not reserved or project-owned until an authorized publisher registers
it. Do not advertise or publish the command until npm ownership is confirmed and
the official release trust key and matching native artifacts are available.

Bob’s Factory derives from the Apache-2.0 project [Cyrus](https://github.com/cyrusagents/cyrus)
by Ceedar. See the included license and the source repository for notices and
attribution.
