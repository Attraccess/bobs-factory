# Explicit public UI origin

Date: 2026-10-07. Tested: `04f29693` plus the local `FactoryServer.ts` change.

F1 applies to the UI host/origin admission checks. An isolated real EdgeWorker
used a fresh F1 repository at `/tmp/f1-public-ui-local-fix-repo`, RPC port 3600,
and UI port 3649, with `CYRUS_FACTORY_PUBLIC_ORIGIN` set to
`https://bobs-factory-schlepptop.zrok.apps.janjaap.de`.

- F1 ping passed. Public-host UI/config reads returned 200; a same-origin
  `PUT /api/title-settings` using the fixture's current settings returned 200.
- Unrelated hosts/origins and local/public cross-origin writes returned 403.
  Missing request headers returned 403; mismatched build headers returned 409.
- An independent server without the opt-in continued to reject the public host
  with 403. Existing FactoryServer tests passed: 14/14.
- The real instance was restarted with the explicit origin. The original zrok2
  tunnel targets port 3457 directly; the temporary proxy was removed.
- The public page and configuration API returned 200. A harmless POST to an
  unknown route reached routing (404), and the public SSE stream delivered its
  ready event and subsequent changes throughout an eight-second observation.
- A fresh headless browser loaded the public dashboard and completed its
  connection check without an offline or checking banner.
- TypeScript compilation, JavaScript syntax, and scoped Biome checks passed.
  `git fetch origin main` confirmed main already current at `04f29693`.

The isolated F1 server was stopped. No real runs or model requests were created
for verification; the real instance was checked with reads and an unknown route.
