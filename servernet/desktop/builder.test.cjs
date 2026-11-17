// Explicitly unsigned validation artifacts. Never publish these as public releases.
const base = require('./builder.cjs');
module.exports = {...base, forceCodeSigning: false, publish: null,
  toolsets: {wine: '1.0.1'},
  artifactName: 'ServerNet-Studio-UNSIGNED-TEST-${version}-${os}-${arch}.${ext}',
  mac: {...base.mac, identity: process.platform === 'darwin' ? '-' : null, hardenedRuntime: false, notarize: false,
    target: [{target:'zip',arch:['arm64','x64']}]},
  dmg: {sign:false},
  win: {...base.win, signAndEditExecutable:false, target:[{target:'nsis',arch:['x64']}]},
};
