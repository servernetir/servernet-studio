// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {appendFileSync} from 'node:fs';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {gzipSync} from 'node:zlib';
import {dump} from 'js-yaml';
import {blake2b} from '@noble/hashes/blake2b';
import {finalizeRelease, notarizeDiskImage, verifyBlockmap, verifyUpdateFiles} from '../scripts/finalize-release.mjs';

const version = '0.2.3';
const prefix = `ServerNet-Studio-${version}-`;
const zipNames = ['mac-x64.zip', 'mac-arm64.zip'].map(name => prefix + name);
const imageNames = ['mac-x64.dmg', 'mac-arm64.dmg'].map(name => prefix + name);
const exeName = prefix + 'win-x64.exe';
const dummyCredentials = {APPLE_ID: 'fixture', APPLE_APP_SPECIFIC_PASSWORD: 'dummy', APPLE_TEAM_ID: 'TEAM123'};

function sha(data, algo, encoding) { return createHash(algo).update(data).digest(encoding); }

async function fixture(t, platform = 'darwin') {
  const directory = await mkdtemp(join(tmpdir(), 'studio-release-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const updateNames = platform === 'darwin' ? zipNames : [exeName];
  const metadataName = platform === 'darwin' ? 'latest-mac.yml' : 'latest.yml';
  const files = [];
  for (const name of updateNames) {
    const chunks = [Buffer.from(name), Buffer.from('fixture bytes')];
    const data = Buffer.concat(chunks);
    await writeFile(join(directory, name), data);
    await writeFile(join(directory, name + '.blockmap'), gzipSync(JSON.stringify({version: '2',
      files: [{name: 'file', offset: 0, sizes: chunks.map(chunk => chunk.length),
        checksums: chunks.map(chunk => Buffer.from(blake2b(chunk, {dkLen: 18})).toString('base64'))}],
    })));
    files.push({url: name, sha512: sha(data, 'sha512', 'base64'), size: data.length});
  }
  const metadata = {version, files, path: files[0].url, sha512: files[0].sha512};
  await writeFile(join(directory, metadataName), dump(metadata));
  if (platform === 'darwin') for (const name of imageNames) await writeFile(join(directory, name), 'signed disk image fixture');
  return {directory, metadata, metadataName};
}

function nativeFixture({notaryStatus = 'Accepted', onStaple = () => {}} = {}) {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === '-dv') return {stdout: '', stderr: 'Authority=Developer ID Application: Fixture\nTeamIdentifier=TEAM123\n'};
    if (args[0] === 'notarytool') return {stdout: JSON.stringify({status: notaryStatus}), stderr: 'progress'};
    if (args[0] === 'stapler' && args[1] === 'staple') onStaple(args[2]);
    return {stdout: '', stderr: ''};
  };
  return {run, calls};
}

test('Mac metadata contains only ZIPs and both blockmaps cover their exact bytes', async t => {
  const {directory, metadata, metadataName} = await fixture(t);
  const verified = await verifyUpdateFiles(directory, 'darwin', version);
  assert.equal(verified.diskImages.length, 2);
  metadata.files[0].url = imageNames[0];
  await writeFile(join(directory, metadataName), dump(metadata));
  await assert.rejects(verifyUpdateFiles(directory, 'darwin', version), /Unexpected updater file reference/);
});

test('blockmap detects corrupt chunks even if the file size did not change', async t => {
  const {directory} = await fixture(t, 'win32');
  const artifact = join(directory, exeName);
  await verifyBlockmap(artifact);
  const data = await readFile(artifact);
  data[0] ^= 1;
  await writeFile(artifact, data);
  await assert.rejects(verifyBlockmap(artifact), /Blockmap does not match/);
});

test('final Mac checksums use stapled bytes; updater assets remain byte-identical', async t => {
  const {directory} = await fixture(t);
  const {run, calls} = nativeFixture({onStaple: file => appendFileSync(file, ' stapled ticket')});
  await finalizeRelease(directory, 'darwin', version, dummyCredentials, run);
  const sums = await readFile(join(directory, 'SHA256SUMS-macos.txt'), 'utf8');
  for (const name of imageNames) {
    const bytes = await readFile(join(directory, name));
    assert(bytes.toString().endsWith('stapled ticket'));
    assert(sums.includes(`${sha(bytes, 'sha256', 'hex')}  ${name}`));
  }
  assert.equal(calls.filter(([, command]) => command === 'notarytool').length, 2);
  assert.equal(calls.filter(([, command, action]) => command === 'stapler' && action === 'validate').length, 2);
  assert.equal(calls.filter(([command]) => command === '/usr/sbin/spctl').length, 2);
});

test('unaccepted notarization stops before stapling and stale updater/DMG files fail closed', async t => {
  const {directory} = await fixture(t);
  const {run, calls} = nativeFixture({notaryStatus: 'Invalid'});
  assert.throws(() => notarizeDiskImage(join(directory, imageNames[0]), dummyCredentials, run), /Apple did not accept/);
  assert(!calls.some(([, command]) => command === 'stapler'));
  await writeFile(join(directory, imageNames[0] + '.blockmap'), 'stale');
  await assert.rejects(finalizeRelease(directory, 'darwin', version, dummyCredentials, run), /Unexpected release files/);
  assert.equal(calls.filter(([, command]) => command === 'notarytool').length, 1);
});

test('Mac finalization rejects updater metadata mutated during notarization', async t => {
  const {directory, metadataName} = await fixture(t);
  const {run} = nativeFixture({onStaple: () => appendFileSync(join(directory, metadataName), '\n# changed\n')});
  await assert.rejects(finalizeRelease(directory, 'darwin', version, dummyCredentials, run), /Updater bytes changed/);
});

test('Windows emits its own checksum list and refuses unexpected file references', async t => {
  const {directory} = await fixture(t, 'win32');
  await finalizeRelease(directory, 'win32', version, dummyCredentials, () => { throw Error('Unexpected native notarization'); });
  const sums = await readFile(join(directory, 'SHA256SUMS-windows.txt'), 'utf8');
  assert(sums.includes(exeName + '\n') && sums.includes('latest.yml\n'));
  await assert.rejects(finalizeRelease(directory, 'win32', version), /Finalized release already exists/);
});
