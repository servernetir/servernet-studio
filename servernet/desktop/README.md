# ServerNet Studio desktop 0.2.0

This is the independent ServerNet customer client. It connects to the hosted Studio service and existing ServerNet account, Google sign-in and wallet. It provides online text chat; it does not embed the upstream local training tools or a model runtime.

## Prepared packages

| Platform | Current artifact | Public installer target |
| --- | --- | --- |
| Windows x64 | Unsigned validation NSIS installer and ZIP | Signed NSIS EXE |
| macOS Intel x64 | Unsigned validation app ZIP | Signed/notarized DMG and update ZIP |
| macOS Apple Silicon arm64 | Unsigned validation app ZIP | Signed/notarized DMG and update ZIP |

Mac requires macOS 13 or later. Windows requires Windows 10 or later, x64. An internet connection and the installed/activated hosted service are required. Automated eight-second native startup passed for Windows x64 and Mac Intel/Apple Silicon in run 44126181641. Interactive installation, login/logout and financial acceptance remain incomplete. These validation packages are not public releases. Do not instruct customers to bypass their operating system's security warnings.

## Identity and billing

Sign-in opens the operating system's browser. The app shows a code for the user to enter in that browser, then uses a main-process-only verifier to claim a single-use, encrypted BFF session. Console SMS/identity/legal/2FA requirements remain in the console. No Google refresh token, client secret or AI Gateway key is embedded in the app, renderer or installer. The renderer has no Node integration, preload bridge or IPC commands. Provider billing is always performed by the central Gateway.

The hosted service must include `servernet/hosted/desktop.py`. Its health endpoint advertises `desktop_auth_protocol: 1`. Sign-in uses `/auth/desktop/start`, browser `/auth/desktop`, and `/auth/desktop/poll`; the ordinary console PKCE callback is unchanged. The code must match before console login begins; five incorrect guesses close the approval request. A ready session can be claimed only once, for 60 seconds, by the initiating verifier.

## Local verification and builds

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run build:test -- --win --x64
npm run build:test -- --mac --arm64 --x64
```

Build NSIS on Windows and DMG/sign/notarize on macOS. The included GitHub Actions workflow runs isolated HTTP/Node checks first and uploads validation artifacts. It can build signed candidates only after the release prerequisites pass. Repository access and Actions availability must be established first.

The Linux cross-build produced all three ZIPs. NSIS could not finish because Wine's server socket was denied by the environment; the incomplete EXE is not a valid installer. Windows native CI avoids Wine and is the intended next build environment. macOS ZIP CRC/Info.plist and Windows ZIP/ASAR checks passed; this does not establish native launch, installer behavior or actual font rendering.

The workflow builds the two Mac ZIPs together, then downloads those exact artifacts from the same run onto separate `macos-15` (Apple Silicon) and `macos-15-intel` hosts. Each host extracts its matching ZIP, checks the executable's Mach-O architecture and launches it for eight seconds. A different host/package architecture fails the check. Signed ZIPs also undergo signature, stapled-ticket and Gatekeeper checks after extraction. This avoids treating one architecture's launch as evidence for both, and does not rebuild or publish another update feed. These are startup checks; interactive installation, sign-in, logout and financial acceptance are still separate requirements. Runner labels: [GitHub's supported standard hosts](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

Mac packaging uses the standard `macos-15-intel` host for both target architectures. GitHub failed to allocate an arm64 packaging host in run 44106078048 and reported capacity constraints; using Intel for assembly allows packaging and the Intel launch check to proceed independently of the arm64 pool. The separate Apple Silicon launch job still requires a real arm64 host and remains mandatory evidence. No larger/paid runner or emulation is enabled.

## Signed candidates and updates

`builder.cjs` requires code signing. `builder.test.cjs` explicitly creates `UNSIGNED-TEST` outputs and disables publishing. Never rename test outputs into production names. `npm run release:check` requires an actual native host, fresh live acceptance matching the source SHA, configured signing/notarization credentials and a healthy Studio service. The example acceptance file deliberately has all checks false.

Configure these **in GitHub Actions secrets**, never in source or chat:

- `SERVERNET_MAC_CSC_LINK`, `SERVERNET_MAC_CSC_PASSWORD`
- `SERVERNET_WIN_CSC_LINK`, `SERVERNET_WIN_CSC_PASSWORD`
- `SERVERNET_APPLE_ID`, `SERVERNET_APPLE_APP_PASSWORD`, `SERVERNET_APPLE_TEAM_ID`

Set `SERVERNET_WINDOWS_PUBLISHER` to the certificate's actual publisher identity. Set `SERVERNET_DESKTOP_ACCEPTANCE_JSON` only after the recorded native login, registration, 2FA, wallet, ownership, billing, font and install/logout checks have actually been performed. Paid acceptance needs a separately authorized test account and spending cap; do not fabricate acceptance.

After signed builds, validate the Windows Authenticode identities and macOS code signatures/stapled tickets. The workflow performs these checks and produces candidates; it does not silently publish a release or change production. Place signed installers, update ZIPs, blockmaps and `latest*.yml` under the fixed HTTPS feed `https://servernet.cloud/downloads/studio/` as one coordinated release. Check for updates is user initiated; download and installation require the user's in-app action. Downgrades and prereleases are disabled. Do not change the feed or trust arbitrary renderer URLs.

The website page is `/studio/download` with fa/en/tr variants. Its feature stays disabled until all three approved installer entries, exact file sizes and checksums are available. The private manifest is `storage/app/studio/release.json`; see the core contract in PR323. Match `SERVERNET_STUDIO_DOWNLOADS_DIRECTORY` to the actual public download directory, verify bytes during installation and keep the release manifest outside webroot. Publish matching source before distributing the AGPL client.

## Current deployment status

Read-only inspection found Python 3.12.16, Node and Passenger, with Docker absent; Studio DNS resolves through Cloudflare. The private Passenger entry point and JSON runtime configuration passed 90 tests and a web build locally/in CI; see [CPANEL.md](../CPANEL.md). The application and core SSO migration/configuration have not been installed. No production wallet or customer record was changed. cPanel required login after an IP change and authenticated Tools/Terminal pages were later observed, but the read-only preflight submission timed out before its output could be verified.

Source is published in develop and core PR323 is merged. On source b6ae19b0c1edcfa93bbde8b45f7c792db3598c7a, run 44126181641 passed Windows NSIS packaging/startup, Mac packaging and separate eight-second launches on Intel and Apple Silicon hosts. The Mac hosts downloaded the same run's archive, checked ZIP integrity and the executable architecture before launching. These TEST packages have no distribution signatures/notarization; interactive native acceptance is still pending. No signed/notarized public packages or update feed have been released. Full evidence is in [VALIDATION.md](../VALIDATION.md).

Rollback: keep the core download feature off, revert the application source/image, and retain the encrypted BFF database with its matching encryption key. Revoke Studio keys if necessary; do not erase financial history.

Primary references: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [Electron platform changes](https://www.electronjs.org/docs/latest/breaking-changes), [electron-builder signing](https://www.electron.build/v26/docs/code-signing/), [cPanel Application Manager](https://docs.cpanel.net/cpanel/software/application-manager/). Installed electron-builder schema 26.18.0 is used by the checked-in configuration.
