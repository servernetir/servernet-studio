// SPDX-License-Identifier: AGPL-3.0-only
module.exports = {
  appId: 'cloud.servernet.studio', productName: 'ServerNet Studio',
  copyright: 'Copyright © 2026 ServerNet', asar: true,
  directories: { output: 'release', buildResources: 'build' },
  files: ['src/**/*', 'build/icon.png', 'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.txt'],
  artifactName: 'ServerNet-Studio-${version}-${os}-${arch}.${ext}',
  forceCodeSigning: true,
  publish: [{provider: 'generic', url: 'https://servernet.cloud/downloads/studio/'}],
  mac: {category: 'public.app-category.productivity', minimumSystemVersion: '13.0.0',
    icon: 'build/icon.icns', hardenedRuntime: true, notarize: true,
    target: [{target:'dmg', arch:['arm64','x64']}, {target:'zip', arch:['arm64','x64']}]},
  dmg: {sign: true},
  win: {icon: 'build/icon.ico', target:[{target:'nsis',arch:['x64']}],
    signtoolOptions:{publisherName: process.env.SERVERNET_WINDOWS_PUBLISHER || 'ServerNet'}, verifyUpdateCodeSignature: true},
  nsis: {oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false, createDesktopShortcut: true, createStartMenuShortcut: true},
};
