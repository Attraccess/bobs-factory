# Factory session lifetime configuration

Date: 2026-10-07. Taskbot #79, PR #27, reported run
`manual-09e877cd-6bbb-4ad8-9aec-85b6d59877e8`.
Tested `0dd6c5d12006fa8851456aba783fecbdc5b8191d` with the session-lifetime
launcher fix in this commit. Historical passkey QA evidence is preserved.

## Reproduction and fix

The launcher's default `--session-hours=12` overwrote
`CYRUS_FACTORY_SESSION_HOURS` even when the option was absent. The actual
standalone launcher issued a 12-hour session with environment value `24` and
started successfully with invalid environment value `0`.

The launcher now writes the environment only for an explicitly supplied CLI
option. FactoryServer retains the 12-hour default and existing 1–24-hour
validation. Explicit CLI options take precedence over the environment.

## Relevant F1 validation

The isolated driver launches the actual `scripts/factory.ts`, EdgeWorker,
FactoryServer and auth store with a fresh temporary home for each case. Valid
cases complete cryptographic WebAuthn registration over the Factory HTTP API,
check the returned session expiry, and assert unauthenticated run reads are 401.
Invalid cases must exit 1 without reaching startup readiness.

`node /tmp/cyrus-session-fix-09e877cd/config.mjs` passed all 15 scenarios:

- Neither setting supplied: 12 hours.
- Environment values 1 and 24: corresponding lifetimes.
- CLI values 1 and 24: corresponding lifetimes.
- Explicit CLI overrides both a valid and an invalid environment value.
- Environment and CLI values `0`, `25`, `banana`, and empty string: startup fails.

Existing `FactoryAuth.test.ts` and `FactoryAccess.test.ts` passed all 20 tests.
`pnpm build`, `pnpm typecheck`, Biome for the launcher, and `git diff --check`
passed. The repository pre-commit hook also runs the required build/type gates.

## Actual tunnel observations

A separate temporary public zrok2 v2.0.3 share forwards unchanged request headers
through a recording proxy to an empty Factory instance on ports 46379–46381.
Its configured HTTPS origin is `https://mhj2145ey1w5.zrok.apps.janjaap.de`.
No production listener, tunnel, configuration or authentication store is changed.

The incoming Host is the exact public hostname, X-Forwarded-Host is the same
hostname, and X-Forwarded-Proto is `https`. An auth POST retains its exact public
Origin. A supplied forged Forwarded localhost claim is retained but gives no
authorization; zrok replaces supplied X-Forwarded-Host/Proto with the real public
values. All five checks passed:

- Unauthenticated protected read: 401.
- Protected read with forged localhost forwarding claims: 401.
- Auth POST with correct Origin but invalid setup code: 409, invalid setup code.
- Auth POST without Origin: 403.
- Auth POST with foreign Origin: 403.

This establishes actual tunnel behavior for an isolated share on the same
frontend. It does not claim the reserved production hostname has been deployed
or that physical-device checks have passed. The physical iPhone/Safari and PWA
checks are being performed separately with the operator; outcomes must be
recorded before QA approval.

## Evidence

Driver, before/after results, build/typecheck logs and sanitized tunnel receipts:
`/Users/jappy/.cyrus/factory/evidence/manual-09e877cd-6bbb-4ad8-9aec-85b6d59877e8/resolution-2026-10-07/`.
Setup codes, authentication cookies and credential state are excluded.
The session-configuration finding is resolved; overall run QA still needs its
remaining device evidence and a fresh workflow review of the changed revision.
