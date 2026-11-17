// SPDX-License-Identifier: AGPL-3.0-only
// Launch the packaged client on its real target OS, without authenticating or
// issuing model requests. This does not establish sign-in or visual acceptance.
import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
const binary = process.platform==='win32' ? 'release/win-unpacked/ServerNet Studio.exe' :
  process.platform==='darwin' ? 'release/mac-arm64/ServerNet Studio.app/Contents/MacOS/ServerNet Studio' : null;
if(!binary)throw Error('Native smoke checks require Windows or macOS.');
await access(binary);
const child=spawn(resolve(binary),[],{stdio:'ignore'});
let early=false,failed=false;
child.once('error',()=>{early=true;failed=true;});
child.once('exit',()=>{early=true;});
try {
  await sleep(8000);
  if(early || failed)throw Error('Packaged client exited before native startup completed.');
  console.log('Packaged client stayed running on its native OS for 8 seconds. Interactive acceptance is still required.');
} finally {
  if(!early)child.kill();
}
