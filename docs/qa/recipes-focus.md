# Recipes focus recovery — QA-002

The earlier `qa-r3/browser-recipes.py` scenario opened the reviewer with
programmatic `element.click()` and accepted any focused element whose text
contained the reviewer name. That could pass when focus returned to the page
container. It did not prove `recipes-navigation-readable`.

The replacement [browser check](../../scripts/qa-recipes-focus.mjs) retains the
exact opening DOM button, opens it through trusted pointer or Enter interaction,
and requires `document.activeElement === window.qaRecipesTrigger` after Escape.
It also verifies that the button remains connected, the dialog closes, Tab reaches
the labelled prompt/output/JSON controls, narrow-layout keyboard navigation scrolls
the modal, and a rejected JSON-off save retains its draft without changing saved
configuration. The check writes interaction logs, assertions and screenshots and
closes only its fresh, explicitly headless browser session.

Run against an isolated Factory server with stock recipes:

```sh
node scripts/qa-recipes-focus.mjs http://127.0.0.1:3903 /tmp/recipes-focus-evidence
```

On 2026-10-07, all four cases passed: pointer and keyboard opening at 1280×900
and 430×900. Each recorded a trusted opening click with the exact trigger focused;
Escape returned focus to that same connected button. Narrow-layout Tab navigation
scrolled the modal body to its lower controls. Every rejected save retained the
unchecked JSON draft and left the complete configuration unchanged.

The tested frontend was built from `76fd0268340966c9ead97656ba15890164896086`
before the QA-script/documentation changes, with build ID
`d06b07332fcc991011b681e9`. The loopback fixture used production `FactoryServer`
and `WorkflowRuntime`, an isolated temporary home and hooks that reject all agent
or run launches. No provider agents executed. Product code needed no correction.
This change only corrects QA evidence; a new F1 drive is not applicable. Historical
F1 reports and settled SR-001 through SR-004 and QA-001 dispositions are preserved.

Full receipts and four screenshots are retained under
`/Users/jappy/.cyrus/factory/evidence/manual-0b7cf77f-8296-4e61-9df5-b03561e59729/qa-focus-fix/`.
`focus-receipts.json` is the passing run. `label-diagnostic.json` preserves an
initial script-label assertion failure: textarea contents were included by
`label.textContent`; the final check reads the label's own text nodes.
These results supplement the prior accepted images and other passing criteria;
they do not replace the pipeline's subsequent QA reassessment.
