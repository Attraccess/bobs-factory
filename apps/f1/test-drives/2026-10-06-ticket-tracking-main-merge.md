# Ticket tracking after the latest main merge

Date: 2026-10-06

Candidate: PR #19 at `d90cbc81` merged with `main` at `3a98d3ba`.
The conflicts were adjacent changelog entries and independent FactoryServer
regression tests; both versions were retained. The combined server now retains
the tracking-only retry route alongside main's versioned PWA shell and stale
settings protections.

Ran the existing isolated `ticket-f1-ci/drive.mjs` against rebuilt packages,
with its fixture certificate through `NODE_EXTRA_CA_CERTS`. All twelve
assertions passed: full Taskbot context, work start, review and rejection,
PR linkage, merge-only completion, pending synchronization/restart recovery,
native status recovery, configured native base, inherited follow-up identity,
legacy tracking-only retry, and accepted Cursor MCP discovery. Agent and Git
provider outcomes were fixtures; no production tickets or PRs were mutated.

Ran `ci-merge-visual-drive.mjs` and Chromium through agent-browser at 1440×900.
The expanded Today row renders the complete readable provider warning and
recovery guidance, with Open run and Stop available. The installable shell and
versioned assets render successfully. Stopped the fixture after inspection.

Evidence directory:
`/Users/jappy/.cyrus/factory/evidence/manual-df3a6623-c843-44af-8926-fdc200996962`.
New evidence: `ci-merge-f1.log`, `ci-merge-f1-results.json`,
`ci-merge-visual-results.json`, and `ci-merge-ticket-sync-pending.png`.
Historical test-drive reports and accepted screenshots remain unchanged.

Verification: build and typecheck passed. The full EdgeWorker run passed 100
suites; two asset suites initially failed because the new PWA build had not
been generated. After building, both suites passed all 36 tests, including
both preserved server regression cases. Biome and diff checks passed.

`pnpm audit` reports four advisories already present on main: proxy-addr,
node-forge, braces and source-map-js. Two have no published patched version.
No dependency versions were changed beyond those inherited from main.
