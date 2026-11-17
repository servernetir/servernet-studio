// SPDX-License-Identifier: AGPL-3.0-only
// Launch the packaged client on its real target OS, without authenticating or
// issuing model requests. This does not establish sign-in or visual acceptance.
import {spawn, execFileSync} from 'node:child_process';
import {access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {nativeBinary} from './native-target.mjs';
const binary = nativeBinary(process.platform, process.arch, process.env.SERVERNET_NATIVE_ARCH);
await access(binary);
if (process.platform === 'darwin') {
  const expected = process.arch === 'x64' ? 'x86_64' : 'arm64';
  const actual = execFileSync('/usr/bin/lipo', ['-archs', resolve(binary)], {encoding:'utf8'}).trim();
  if (actual !== expected) throw Error('Packaged executable architecture does not match its native host.');
}
const child=spawn(resolve(binary),[],{stdio:'ignore'});
let early=false,failed=false;
child.once('error',()=>{early=true;failed=true;});
child.once('exit',()=>{early=true;});
try {
  await sleep(8000);
  if(early || failed)throw Error('Packaged client exited before native startup completed.');
  console.log(`Packaged client stayed running on ${process.platform}/${process.arch} for 8 seconds. Interactive acceptance is still required.`);
} finally {
  if(!early)child.kill();
}
