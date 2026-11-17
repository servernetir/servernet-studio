# ServerNet Studio validation — 2026-11-17

## Current product and publication

Customer entry points are servernet/hosted, servernet/web and servernet/desktop. They provide online text chat, central ServerNet/Google login, the website registration/2FA flow, shared wallet/usage and per-customer history. Upstream local training/media tools and the original Desktop are not exposed.

Studio code is published in servernetir/servernet-studio:develop. Core SSO/wallet/download changes were merged through PR323 into servernetir/server:develop, merge SHA 311acf8cfecfd0e06cfb02aa0c3eba9134dcfc70. Production feature flags remain off. GitHub access was initially blocked by 403 and was restored by the owner during this task.

## Confirmed checks

- 55 Python tests passed locally and in hosted CI run 44068751248, job 133989208801, on functional source 41ff4de12e74d751c80a3bbaa2a68ef612615531. HTTP/model services were synthetic. Coverage includes browser-bound PKCE, console sign-in methods, registration expiry, desktop code/CSRF/attempt limits, one-time native claim, no browser-session fallback after native expiry, ownership, encrypted keys, central wallet units, duplicate/unknown billable requests, fonts and body limits.
- The Passenger adapter passed lifespan startup/shutdown, incremental SSE and unauthenticated/console redirect checks. The live Apache/Passenger/Cloudflare path remains untested.
- Eight Node desktop tests passed for navigation, handoff URLs, cookies, cancellation and malformed responses. Main/release/native-startup scripts passed syntax checks. Desktop production dependencies reported zero vulnerabilities in npm audit.
- Customer lockfile install and TypeScript/Vite build passed locally and in CI. Font URLs resolve at runtime from existing ServerNet IRANSans files. Actual glyph rendering, mobile layout and accessibility remain unverified.
- Core functional SHA 1cf62aa100e6ba0af61ae069741ea5e28c109503: CI run 44062680272, job 133968326218, PHP 8.4.27: **78 tests / 1012 assertions passed** across StudioSsoTest, GoogleAuthTest, StudioDownloadsTest and V1ChatTest. Later core commits changed documentation only; base develop remained b76ba2eb03b903508080261e65131c37d92502c8 before merge.

## Passenger runtime configuration update

The complete Python suite passes **90 tests** locally and in hosted CI run 44100679806, job 134099536087, on source ed1479b9fee5cd79b5d1236d7918fbaf8d4ea93c. The same job passed the TypeScript/Vite build. This adds private JSON configuration loading for Passenger with bounded reads, owner/mode checks, no symlinks/hard links, duplicate/unknown-field rejection, environment precedence and safe failures when a file disappears or is replaced during startup. An integration check starts the customer service with fixture fonts and private config, verifies health/auth/font routes and confirms no secret is exported to the environment. All traffic remains synthetic. Environment-only Docker deployment remains supported. See CPANEL.md for the template and precedence.

## Packaged artifacts

### Latest verified native run — 2026-11-17

Source `b6ae19b0c1edcfa93bbde8b45f7c792db3598c7a`, run [44126181641](https://github.com/servernetir/servernet-studio/actions/runs/44126181641): all five jobs completed successfully. Contracts job 134190473516 logged **90 Python tests passed, 10 Node tests passed, zero Node failures**, and a successful TypeScript/Vite build. Windows job 134190946173 built the NSIS TEST installer and passed startup. Intel packaging job 134190946108 produced both Mac ZIPs. Native jobs 134198492905 (Intel) and 134198492787 (Apple Silicon) downloaded that run's artifact, checked ZIP integrity and matching Mach-O architecture, then each logged that the packaged process stayed running for eight seconds.

GitHub artifact metadata (expected digests, not an independent local download/hash claim):

| Artifact | ID | Bytes | SHA-256 |
| --- | --- | --- | --- |
| servernet-macos-UNSIGNED-TEST | 14349305941 | 241236240 | dd25bd052eb26196afc31d40f3434f0c710415cc9c1771ff92527f9eb4bd5b21 |
| servernet-windows-x64-UNSIGNED-TEST | 14348135946 | 121895435 | 79f9ed0e5e660c4b175d0f0128a96d0bf8b15922d2505f466a7fc61d42243686 |

Both artifacts expire on 2026-12-01. This closes the previously unconfirmed native process-startup check for both Mac architectures. It does **not** establish interactive installation, sign-in/registration/logout, real billing, distribution signing, notarization, update acceptance or production readiness. No acceptance booleans or release flags were changed. Historical queued/cancelled observations below remain historical.

Remaining prerequisites require authorized production access, an explicitly authorized test account/spending cap, and existing Windows/Apple signing/notarization configuration through private Actions secrets. The connected Browser tool again returned unavailable in this environment; no live server output or installation is claimed. No credentials were inspected and no paid model request was made. Resume from the source above and recheck remote HEAD and concurrent deployment state before installation.

- Windows x64 NSIS packaging and eight-second native startup passed in runs 44066450575 and 44067697227, and the Windows job of run 44068751154. This establishes native process startup, not interactive install/sign-in or real billing.
- On source ed1479b9fee5cd79b5d1236d7918fbaf8d4ea93c, desktop contracts and the Windows native package/startup job 134099906669 in run 44100679659 also passed. The Mac job was still queued at the last check; no new native Mac result is claimed.
- Artifact 14319948055 was downloaded; ZIP CRC passed and SHA-256 matched GitHub digest 891e7d6308ee0f943e832496a9feccd2aa0682ca6746e0bd6aa1e5db218f41c5. It contains the unsigned TEST installer and blockmap.
- Unsigned validation ZIPs were also cross-packaged for Windows x64 and Mac Intel x64/Apple Silicon arm64. CRC checks passed. Mac bundle ID/version/macOS 13 minimum and Windows packaged source/version/AGPL license were inspected.
- Local NSIS first lacked Wine; the official bundle then failed with wineserver socket Operation not permitted. No bypass was attempted, and its incomplete EXE is not delivered. Native Windows CI subsequently built the complete installer.
- The original macos-14 CI label is retired. Workflow 6b6e832c879d9c8df53a057b49fb0ee2fbf3e8d7 uses supported macos-15. Mac jobs were cancelled or queued; native Mac execution is **not confirmed**. No Mac DMG or signed/notarized public package was produced.

## Production acceptance not established

### Native Mac coverage correction

The previous startup script always selected `release/mac-arm64`, so it could not establish Intel startup. The revised workflow tests each already-built Mac ZIP on its matching standard native host, rejects host/package architecture mismatches and verifies the executable architecture before launch. It retains one combined Mac packaging job and its update metadata. Local validation for this change: 10 Node tests passed, startup scripts passed syntax checks, workflow YAML parsed and `git diff --check` passed. Native GitHub results for this change are pending; neither Mac launch nor interactive acceptance is claimed. Rollback is to revert this workflow/helper change; it does not alter production, billing, signatures or public flags.

Base Studio SHA: `5759c7efba886ede6351c0ad4fd1aa4eee80b27d`. Core develop remains `311acf8cfecfd0e06cfb02aa0c3eba9134dcfc70`. On 2026-11-17 the previously queued Mac job 134099906786 in run 44100679659 was observed cancelled without steps. The connected Browser tool was unavailable in this execution environment and the fallback browser had no tabs; no cPanel terminal output or deployment is claimed.

Read-only cPanel inspection found Python 3.12.16, Node and Passenger, without Docker/uv. Studio DNS resolved through Cloudflare. Studio SSO files were not installed. The authenticated browser subsequently timed out. On reconnection cPanel required login after an IP change; authenticated Tools and Terminal pages were later observed. A new read-only preflight submission timed out and its output was not observed. No production file, environment value, migration, account record or wallet transaction was changed. No paid model request was issued.

Live login/registration/2FA, actual font/layout rendering, real proxy streaming/disconnects, interactive native install/logout, signing/notarization and ledger reconciliation remain pending. Public installers and update feeds must stay unpublished until acceptance and its matching record are complete. The website gate rejects unapproved, unsigned, missing or malformed release manifests.

## Recovery and provenance

### Mac runner capacity — 2026-11-17

Run [44106078048](https://github.com/servernetir/servernet-studio/actions/runs/44106078048), source `a0fe9c6d0cbee7bfd09c853a102fdaf5bf59e6a7`, passed contracts/build and Windows packaging/startup. Its Mac package job 134119056548 never acquired a hosted runner; the public run summary explicitly reports arm64 capacity constraints and an internal GitHub error. Both downstream Mac launch checks were consequently skipped. This is not a package execution failure or evidence of Mac acceptance.

The package assembly job now uses the supported standard `macos-15-intel` host while retaining both arm64/x64 targets and separate native launch jobs. The actual Apple Silicon check is not substituted by Intel execution. Base remote source/tree: `a0fe9c6d0cbee7bfd09c853a102fdaf5bf59e6a7` / `daadf71723b67a1c02fdb44c4ebfc80e579cadf3`. Only the workflow host selection and these explanatory documents change; no production settings, public release gates or signing requirements change. Rollback is to restore the package assembly runner label. New native results are pending.

Source baselines: engine b52c45162d4dd91c8379c19a8e836f3e8b8d7e2c, core b76ba2eb03b903508080261e65131c37d92502c8. Original licenses/copyright remain preserved. Customer changes are AGPL-3.0-only; corresponding source must identify the deployed commit.

For rollback, keep core Studio/download flags off, revert app source/image, and revoke Studio keys if needed. Retain the BFF database with its encryption key and preserve financial history. Git publication, installation and production acceptance are distinct outcomes.
