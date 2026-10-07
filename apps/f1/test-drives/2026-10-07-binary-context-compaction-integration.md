# Compact review history integration with the binary fork

Date: 2026-10-07. PR: [#34](https://github.com/Attraccess/bobs-factory/pull/34).
Tested merge: `c0290c7ae2688af3d9db638e150a9c35b96feb3f` plus
`080fa5f89f7c801500c5aee440fa7c707e30123d`; staged runtime tree
`ee7c091ad76ffa281f27d16c11c577d0392a1915` before this report.

## Applicability and setup

The merge imports the compact Factory MCP history protocol from #42. F1 applies
because agent roles consume that input during repeated reviews and recovery.
The changelog conflict retains both branches' entries. Existing explanation
handling and separate role revisions remain in the fork.

The existing compaction driver was adapted to `factoryHome`, `BOBS_FACTORY_*`
settings and isolated ports 4667/4668. Its migration-source capacity directory
also points into the disposable fixture root. Every agent uses an injected
`MockAgentRunner`; roles connect to their actual private stdio MCP server.
The local tracker, Git repository, bare remote, authentication session and
one-slot capacity pool are disposable fixtures. No provider credits or native
agent execution were used.

```sh
F1_AGENT_MODE=mock bun run /Users/jappy/.cyrus/factory/evidence/manual-7f0c7c6e-cca1-4387-b7ee-7d81e06997ba/ci-compaction-drive.mjs
```

## Results

- The repeated-review fixture completed with 103 history records, three reviewer
  visits, three fixer visits and exactly one explicit answer after restart.
- Roles recovered exact original outputs and full records from compact indexes.
  Accepted decisions, the rejected complaint, new failure evidence and its later
  correction remained visible. Final review accepted the corrected fixture.
- The restricted-input fixture completed after one fixer visit. Undeclared
  ticket/history paths were refused in both compact and full views.
- All private snapshots were removed. The final capacity pool had zero active,
  stopping or queued requests. Shutdown closed both fixture ports. Fifty-six
  tool-use activities and corresponding results were observed; result costs
  were zero.
- All 45 MCP tests and 1,459 EdgeWorker tests passed; one EdgeWorker test was
  skipped. This includes explanation decision/source protection and separate
  explanation revision tests. Workspace build, typecheck, Biome CI and diff
  checks passed. Biome retained its existing warnings.

Evidence is retained under
`/Users/jappy/.cyrus/factory/evidence/manual-7f0c7c6e-cca1-4387-b7ee-7d81e06997ba/`:
`ci-compaction-f1-rerun.log`, `ci-compaction-receipts/receipts.json`,
`repeat-run.json`, `scoped-run.json` and the build/typecheck/MCP/EdgeWorker/Biome
logs prefixed `ci-compaction-`.

## Limitations and initial setup failure

The first attempt stopped at the legacy capacity safety barrier because the
driver inherited the real host's migration-source location. It started no
fixture workflow. The corrected driver selected a disposable source directory;
the successful evidence above comes from a fresh fixture root. The failed log
is retained as `ci-compaction-f1.log`. No host coordinator was stopped or changed.

This proves simulated orchestration and real MCP transport, not native model
browsing, live tracker synchronization or production deployment. Existing
native Intel, authenticated Cursor and real-agent testing exclusions remain.
Publication licensing/platform limits and external hosted-tool catalog
verification remain outside this integration check. Human approvals remain
pending; the PR stays draft.
