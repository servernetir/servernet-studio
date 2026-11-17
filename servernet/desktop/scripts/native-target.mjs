// SPDX-License-Identifier: AGPL-3.0-only
export function nativeBinary(platform, arch, expectedArch = arch) {
  if (arch !== expectedArch) throw Error('Native check host architecture does not match the requested package.');
  if (platform === 'win32' && arch === 'x64') return 'release/win-unpacked/ServerNet Studio.exe';
  if (platform === 'darwin' && ['arm64', 'x64'].includes(arch)) {
    return `release/${arch === 'arm64' ? 'mac-arm64' : 'mac'}/ServerNet Studio.app/Contents/MacOS/ServerNet Studio`;
  }
  throw Error('Native smoke checks require a supported Windows or macOS host.');
}
