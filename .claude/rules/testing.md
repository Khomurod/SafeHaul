---
paths:
  - "**/*.{test,spec}.{js,jsx,cjs,mjs}"
  - "**/*.support.{js,jsx}"
  - "e2e/**"
  - "src/tests/**"
  - "functions/test/**"
  - "playwright.config.cjs"
  - "playwright.visual.config.cjs"
  - "vitest.config.js"
---

# Testing and local test runs

Rules for writing tests and for running them on this machine. Each one is here
because ignoring it once cost real time; the incidents are in
`docs/archive/agent-instructions-2026-10-02.md`.

## Running suites locally

1. **One Playwright suite at a time.** The config serves the app on port 5000
   with `reuseExistingServer`, so a second run attaches to the first run's server
   and fails when that server is torn down. Check the port is free first:
   `curl -s -o /dev/null -w "%{http_code}" http://localhost:5000`.
2. **Never kill by a broad pattern.** `pkill -f vite` matches your own shell and
   kills it. Capture the PID or process group when you start a server and stop
   exactly that; if you must match, use a narrow pattern such as
   `pkill -f 'node.*vite'`.
3. **Long suites run in the background** with output redirected to a log, the
   PID kept and the real exit status collected. A tool timeout or a `SIGTERM`
   (exit 143) is not a test failure; read the log before calling anything one.
4. **Do not edit files in the app's module graph while a Playwright suite runs**:
   the dev server hot-reloads and in-flight tests fail spuriously.
5. **`--project` accumulates, it does not narrow.** CI runs
   `npm run test:e2e -- --project=chromium`, so never bake a `--project` into the
   `test:e2e` script. The pixel lane lives in `playwright.visual.config.cjs` so no
   caller can widen into it. Run `npm run check:ci-plan` after touching either
   Playwright config or those scripts (J1–J5).
6. **Locally, `PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium` is for the
   functional lanes only.** The pixel lane (`test:visual`) and
   `check:visual-contract` need the browser revision Playwright pins; with any
   other build their differences are meaningless. Say so instead of updating
   baselines.
7. **If creating a pull request fails with a server error**, first check whether
   the pull request was created anyway. Never push an empty commit to change the
   SHA.

## Writing reliable Vitest tests

- **A file that queues any `*Once` value uses `vi.resetAllMocks()`**, not
  `vi.clearAllMocks()`, in `beforeEach`/`afterEach`: clearing leaves once-queues
  behind and they leak into the next test. Give defaults at creation
  (`vi.fn(async () => x)`), not chained at module scope
  (`vi.fn().mockResolvedValue(x)` is wiped by a reset). Enforced for `src/` by
  `src/tests/mockResetHygiene.test.js`.
- **Wait for the rendered consequence, not for a mock.** A promise that calls a
  spy and sets state does the second on a later tick. Put the DOM assertion you
  were going to make inside `waitFor`, then assert the spy.
- **`await findBy…` followed by a synchronous assertion is the same hazard** when
  the element renders before the state the assertion depends on (a `<select>`
  whose options a later fetch filters). Assertions that something is *absent* are
  safe either way.
- **`await findByText(name)` is a trap when the name is domain data** — a person's
  or company's name that another element (a picker, a summary) renders from a
  different source. Wait for something that cannot exist until the state you
  assert on does, such as the row's own control.
- **Settle every promise a test starts.** A timer that fires after teardown fails
  the whole run with `EnvironmentTeardownError` even when every test passed; an
  error count that changes between runs is the tell. Resolve or reject a deferred
  inside the test.

## Jest under `functions/`

- Jest 30's `mockReset` replaces every implementation with one returning
  `undefined`, so moving a file to `jest.resetAllMocks()` means re-establishing
  each default in `beforeEach`. 18 files still pair `jest.clearAllMocks` with
  `*Once` queues — a known leak, to be converted as its own measured change.

## Playwright in CI

- CI pins `workers: 1` and `retries: 2` on purpose: more workers on one runner
  produced shared-server failures and contention timeouts. A single green run is
  not evidence that raising it is safe.
- The sanctioned speed-up is sharding across runners (the 4-way `frontend-e2e`
  matrix). Change the shard count in both `matrix.shard` and `--shard=N/<total>`
  in `main.yml`; sharding partitions the same tests, it does not subset them.
