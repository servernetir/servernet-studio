# Validation — ServerNet customer edition, 2026-11-17

## Current scope

The customer product is `servernet/hosted` + `servernet/web`: ServerNet branding, IRANSans font routes, fa/en/tr, console sign-in with PKCE, per-customer history, read-only central wallet/usage, and text-chat streaming through the existing Gateway. Upstream local tools, training, media UI and the original Desktop are not exposed by this customer entry point.

## Confirmed checks

- 55 Python tests passed with synthetic HTTP only, including the original 12 provider connector checks. New checks cover account isolation, PKCE/browser binding, single-use flow, all three console login methods in fa/en/tr, registration longer than five minutes and bounded one-hour expiry, CSRF/origin, encrypted key persistence, unknown outcomes and duplicate requests, monetary units, language redirects, font path allowlisting and oversized chunked bodies.
- Customer `npm ci --ignore-scripts --no-audit --no-fund` and `npm run build` passed with the committed independent lockfile. TypeScript and Vite completed successfully. Font URLs are intentionally resolved by the runtime font mount; Lucide emitted non-fatal bundler directive warnings.
- The earlier internal upstream frontend checks (2 provider tests and the upstream build) also passed before this edition was added.
- ServerNet core functional SHA `07399493da48da2670b5959a770507cce79db93f`: Studio SSO CI run `44051098582` passed, PHP 8.4.27, **21 tests / 165 assertions**, with existing V1Chat financial behavior included. All 14 triggered related workflows passed. Core PR: https://github.com/servernetir/server/pull/323 . Earlier core documentation head: `69a0afd97a99db5eb5727814e9337a8f1eb42624`; Google extension documentation head: `7a2625bff6044d0ed891d885a5d277642fd489e2`.
- PHP grammar parser and `git diff --check` found no syntax/whitespace errors in the prepared code.

## Not established

Local Chromium launch was blocked by the environment's socket restrictions; browser layout, accessibility and actual font rendering remain unverified. The font route test uses fixture bytes to verify routing and allowlisting, not font glyph rendering. Real IRANSans files remain in the existing ServerNet project and are mounted at deployment.
Docker build, public DNS, installation, actual customer sign-in, live catalog access, live model output and financial ledger reconciliation were not performed. No paid API call, customer wallet modification or production migration/configuration was made.
The first PHP CI attempt revealed a validation-response mismatch in one test; malformed authorization requests now fail explicitly with 400, and the final functional run above passed.

## Publication and recovery

The ServerNet core SSO change is in draft PR323, base develop, feature default off. The Studio fork exists, but the GitHub connection still returns 403 for writing its new develop branch. Customer code is committed locally and included in the downloadable source/patch. Code publication, private installation and production acceptance are separate steps.
Do not overwrite the newer fork main with the older pinned local upstream baseline. Create develop from the tested baseline, then publish these commits without force after repository access is granted.

Source baselines: upstream `b52c45162d4dd91c8379c19a8e836f3e8b8d7e2c`, ServerNet core `b76ba2eb03b903508080261e65131c37d92502c8`.
Rollback: disable the core feature and revert its commits; revoke Studio-scoped keys. Preserve financial records. For the customer app, roll back its image/source and retain the encrypted database and its encryption key together.

## Central Google login extension

The customer shell now provides account, Google and registration buttons. All use the same browser-bound PKCE transaction and the existing console authentication/registration routes. No separate Google OAuth application or customer database was introduced. Existing console sessions go directly to consent; Google configuration absence falls back to normal console sign-in.
The first expanded CI run (`44057443837`) passed the Google registration/2FA checks but one combined entry-point test exceeded the existing sign-in rate limit (429). Valid and malformed request cases were separated without weakening production throttling. The follow-up CI result is recorded separately. No live Google account was used.

Google extension acceptance: core SHA `2382ddcedbeab4ef89f40f6daff0d8de836a7a9e`, CI run `44057595824`, job `133950847698`, PHP 8.4.27: **75 tests / 985 assertions passed**, including StudioSsoTest, existing/extended GoogleAuthTest and V1ChatTest. Customer build passed after adding all three translated buttons. Real Google sign-in and production installation remain untested.

## Desktop implementation and packaging

2026-11-17: 55 Python tests passed, including browser-approved native sign-in, attempt limits, origin/CSRF, PKCE possession, single-use claim, encrypted session storage and expiry. Eight Node tests passed for navigation boundaries, handoff URLs, rejected cookies, cancel and invalid-server responses. Main process and release prerequisite scripts passed Node syntax checks. The customer web lockfile install and TypeScript/Vite build passed.

Cross-packaging on Linux produced unsigned ZIPs for Windows x64, macOS Intel x64 and macOS Apple Silicon arm64. ZIP CRC checks passed, the Mac bundle IDs/version/minimum OS were inspected, and Windows ASAR was inspected for expected code, version and AGPL license. No native install or UI execution on Windows/macOS was performed. Windows NSIS failed first for missing Wine, then the official Wine bundle failed with `wineserver: socket: Operation not permitted`. No attempt was made to bypass that restriction; the incomplete EXE was renamed `.incomplete` and is not delivered. Native Windows CI is prepared but cannot be published/run while the new repository returns 403. Mac DMG, code signing, notarization and live auto-update acceptance remain unperformed.

Core download page and gating passed CI run `44062680272`, job `133968326218`, functional SHA `1cf62aa100e6ba0af61ae069741ea5e28c109503`: PHP 8.4.27, **78 tests / 1012 assertions**. All three locale preparation pages and approved/malformed/unsigned release manifests are covered. Public download feature remains off.

Deployment preflight through the authenticated cPanel terminal found Python 3.12.16, Node, Passenger, and no Docker/uv. `studio.servernet.cloud` resolved through Cloudflare. None of the Studio core SSO files is installed; no production application, migration, config, customer or paid model request was changed. GitHub installation configuration currently requires the owner’s passkey/2FA confirmation. This preflight is not installation.

The final native-flow regression test additionally confirms that an expired native request cannot turn into a browser login when another request triggers cleanup. Five bad approval codes terminate native polling rather than waiting for the full transaction timeout.

Update: the owner completed GitHub installation confirmation and granted repository access later in this session. Creating the new develop branch from the tested baseline succeeded. Source publication and native CI are proceeding; earlier 403 observations above describe the earlier state. The cPanel session is authenticated. No production installation or paid request has been performed.

Published source: develop functional commit `51037d564140c4df6d12ea61d692f7ad66a649ac`. GitHub access was restored by the owner. Run `44066450575` passed customer contract/build checks and native Windows NSIS packaging/startup (`133981587760`); artifact `14319948055` was downloaded and its SHA-256 matched the GitHub digest. Windows startup stayed running for 8 seconds; interactive sign-in/installation was not tested. The Mac job did not run because its macos-14 runner had retired; workflow commit `6b6e832c879d9c8df53a057b49fb0ee2fbf3e8d7` uses supported macos-15. Follow-up run `44067697227` passed contracts and Windows again while Mac remained queued at this update.

Passenger HTTP/SSE adapter preparation adds three successful in-memory checks for lifespan shutdown, incremental SSE and preserving unauthenticated access/console redirects (55 Python tests total). Production dependencies for the desktop client had no vulnerabilities reported by npm audit. The browser tool subsequently timed out, so no production install/config/migration was attempted.
