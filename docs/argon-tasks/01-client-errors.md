# Task 01-client-errors: privacy-safe client error reporting (no Sentry account needed)

## Why
Today the team learns about crashes only from users (`ErrorBoundary.tsx` even says no error tracking is wired). We want crash reports in the Vercel function logs without a third-party account and without ever leaking a seed phrase, key, JWT or address.

## Requirements
1. New route `frontend/pages/api/client-error.ts`, modelled on `pages/api/csp-report.ts`: POST only (405 + Allow header otherwise), no auth, per-IP rate limit 20/min via `checkRateLimit`, bodyParser sizeLimit `8kb`. Body `{kind: 'render'|'error'|'unhandledrejection', message, stack?, component?, path?, appVersion?}`; unknown kind is ignored. Truncate message 300, stack 4000, component 120, path 200 (strip `?query` and `#hash`). Every text field goes through `scrubClientText()`; then `console.error('[client-error]', JSON.stringify(...))` at most once per hour per (kind, first 120 chars of the scrubbed message) per instance (dedup map capped at 500 like csp-report). Always 204 (malformed bodies too); never echo input.
2. New pure module `frontend/lib/server/scrub-client-error.ts` exporting `scrubClientText(s)`, replacing: runs of 8+ lowercase words of 3-8 letters separated by single spaces → `<redacted-words>` (possible seed phrase); JWTs (`eyJ…`.`…`.`…`) → `<jwt>`; hex runs of 32+ chars (optional 0x) → `<hex>`; base64/base64url runs of 40+ chars → `<b64>`; EVM 0x+40 hex, TRON T+33 base58, BTC bc1…/1…/3…, SOL base58 32-44, TON EQ/UQ 48-char addresses → `<addr>`; emails → `<email>`. Order the rules so specific patterns win, and keep ordinary stack frames readable (e.g. `at Foo (webpack-internal:///./components/X.tsx:12:5)`).
3. New client module `frontend/lib/client-error-report.ts` with NO heavy imports (it is loaded on every page via `_app`): `reportClientError({kind, message, stack?, component?})` sends JSON via `navigator.sendBeacon` (Blob, application/json), falling back to `fetch(…, {method:'POST', keepalive:true})`. Max 5 reports per page load, identical kind+message once, never throws, no-op when `typeof window === 'undefined'`. `path = location.pathname`; `appVersion = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7)` when set. Export `resetClientErrorReportForTests()`.
4. Wire it: `ErrorBoundary.componentDidCatch` reports kind `render` (component = first meaningful line of `info.componentStack`); `_app.tsx` installs window `error` and `unhandledrejection` listeners inside the existing `AppInner` useEffect (removed on cleanup). Update the stale comment in ErrorBoundary.
5. Tests: `__tests__/lib/scrub-client-error.test.ts` (each rule, incl. the 12-word phrase `abandon … about`, a JWT, a 64-hex key, ETH/TRON/TON addresses, an email; a normal stack trace stays readable), `__tests__/api/client-error.test.ts` (405, 429, 204, truncation, path query stripped, dedup logs once, malformed body still 204, the raw seed phrase never reaches console.error), `__tests__/lib/client-error-report.test.ts` (sendBeacon used, fetch keepalive fallback, max 5, dedup, never throws).
6. `API_SPEC.md`: a table row and a short section for `POST /api/client-error`, in Russian like the rest of the file.

## Files
- `frontend/pages/api/csp-report.ts`
- `frontend/__tests__/api/csp-report.test.ts`
- `frontend/lib/server/api-security.ts`
- `frontend/components/ErrorBoundary.tsx`
- `frontend/pages/_app.tsx`
- `frontend/lib/legacy-storage-cleanup.ts`
- `API_SPEC.md`

## Acceptance
tsc, eslint and the full vitest suite green; `_app` imports only the dependency-free client module (the build's `_app` chunk must not grow beyond a few kB); no secret-looking value reaches the logs in tests.
