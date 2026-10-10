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
binary is removed when it exits. Factory state remains under the separate
`~/.bobs-factory-trial` home and can be reused by later trials. The default port is
4560 (webhooks 4561); `--port` changes that pair. A launcher lock prevents a second
trial. Inspect stale locks before retrying after an ungraceful kill. The trial
does not install a service, change package-manager state or modify update policy.

The name was available in the public npm registry when checked on 2026-10-10,
but it is not reserved or project-owned until an authorized publisher registers
it. Do not advertise or publish the command until npm ownership is confirmed and
the official release trust key and matching native artifacts are available.

Bob’s Factory derives from the Apache-2.0 project [Cyrus](https://github.com/cyrusagents/cyrus)
by Ceedar. See the included license and the source repository for notices and
attribution.

The source/prepared package is private until an operator proves registry ownership.
See [entry-point preparation and publication gates](../../../docs/distribution/PACKAGE_ENTRY_POINTS.md).
Prepared packages default to their exact signed runtime version/channel; explicit
`--channel` follows that channel instead. No native executable cache is retained. The runtime may retain its existing verified
immutable resource cache in `~/.bobs-factory/resources`; normal config/work stays intact.
