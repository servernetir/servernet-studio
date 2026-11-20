// SPDX-License-Identifier: AGPL-3.0-only
// Run after building signed candidates, never as part of an unsigned build.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat, open, readdir, readFile, writeFile} from 'node:fs/promises';
import {basename, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {blake2b} from '@noble/hashes/blake2b';
import {load} from 'js-yaml';

function releaseFiles(platform, version) {
  assert.match(version, /^\d+\.\d+\.\d+$/, 'Expected an official stable version');
  const prefix = `ServerNet-Studio-${version}-`;
  if (platform === 'win32') {
    return {manifest: 'latest.yml', updates: [prefix + 'win-x64.exe'], diskImages: [], checksums: 'SHA256SUMS-windows.txt'};
  }
  if (platform === 'darwin') {
    return {
      manifest: 'latest-mac.yml',
      checksums: 'SHA256SUMS-macos.txt',
      updates: ['x64', 'arm64'].map(arch => prefix + 'mac-' + arch + '.zip'),
      diskImages: ['x64', 'arm64'].map(arch => prefix + 'mac-' + arch + '.dmg'),
    };
  }
  throw Error('Signed release finalization requires a native Windows or macOS host.');
}

async function regularFile(path) {
  const info = await lstat(path);
  assert(info.isFile() && info.size > 0, 'Invalid release file: ' + basename(path));
  return info;
}

async function hashFile(path, algorithm = 'sha256', encoding = 'hex') {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest(encoding);
}

export async function verifyBlockmap(path) {
  const fileSize = (await regularFile(path)).size;
  const mapPath = path + '.blockmap';
  await regularFile(mapPath);
  const map = JSON.parse(gunzipSync(await readFile(mapPath), {maxOutputLength: 16_000_000}));
  // electron-builder 26.18.0 emits the v2 external map with 18-byte BLAKE2b chunks.
  assert.equal(map.version, '2', 'Unexpected blockmap version');
  assert.equal(map.files?.length, 1, 'Expected a single-file blockmap');
  const entry = map.files[0];
  assert(entry.name === 'file' && entry.offset === 0 && Array.isArray(entry.sizes) &&
    entry.sizes.length > 0 && Array.isArray(entry.checksums) && entry.checksums.length === entry.sizes.length,
    'Invalid blockmap structure');
  let position = 0;
  const file = await open(path, 'r');
  try {
    for (let i = 0; i < entry.sizes.length; i++) {
      const size = entry.sizes[i];
      assert(Number.isSafeInteger(size) && size > 0 && size <= 32768 && position + size <= fileSize,
        'Blockmap chunk is outside the release file');
      const buffer = Buffer.alloc(size);
      const {bytesRead} = await file.read(buffer, 0, size, position);
      assert.equal(bytesRead, size, 'Blockmap chunk is truncated');
      assert.equal(Buffer.from(blake2b(buffer, {dkLen: 18})).toString('base64'), entry.checksums[i],
        'Blockmap does not match release file: ' + basename(path));
      position += size;
    }
    assert.equal(position, fileSize, 'Blockmap does not cover the complete release file');
  } finally { await file.close(); }
}

export async function verifyUpdateFiles(directory, platform, version) {
  const {manifest, updates, diskImages} = releaseFiles(platform, version);
  const expected = [...updates, ...diskImages, ...updates.map(name => name + '.blockmap'), manifest];
  const artifacts = (await readdir(directory)).filter(name => /\.(exe|dmg|zip|blockmap)$|^latest.*\.yml$|^SHA256SUMS-.*\.txt$/.test(name));
  assert.deepEqual(artifacts.sort(), expected.slice().sort(), 'Unexpected release files; start with a clean output directory');
  const manifestPath = join(directory, manifest);
  await regularFile(manifestPath);
  const info = load(await readFile(manifestPath, 'utf8'));
  assert.equal(info.version, version, 'Updater manifest has the wrong version');
  assert(Array.isArray(info.files) && info.files.length === updates.length, 'Unexpected updater file count');
  const files = new Map(info.files.map(file => [file.url, file]));
  assert.deepEqual([...files.keys()].sort(), updates.slice().sort(), 'Unexpected updater file reference');
  assert(files.has(info.path) && files.get(info.path).sha512 === info.sha512, 'Invalid legacy updater file reference');
  for (const name of updates) {
    const path = join(directory, name);
    const entry = files.get(name);
    assert.equal(entry.size, (await regularFile(path)).size, 'Updater size mismatch: ' + name);
    assert.equal(entry.sha512, await hashFile(path, 'sha512', 'base64'), 'Updater hash mismatch: ' + name);
    await verifyBlockmap(path);
  }
  for (const name of diskImages) await regularFile(join(directory, name));
  const immutable = [manifest, ...updates, ...updates.map(name => name + '.blockmap')];
  return {files: expected.sort(), diskImages, updateHashes: Object.fromEntries(
    await Promise.all(immutable.map(async name => [name, await hashFile(join(directory, name))])))};
}

function nativeCommand(file, args, label) {
  // Never print raw signing command arguments or subprocess errors: notarytool receives secrets.
  const result = spawnSync(file, args, {encoding: 'utf8', timeout: 20 * 60 * 1000, windowsHide: true});
  if (result.status !== 0) throw Error(label + ' failed. Inspect the native signing service for details.');
  return {stdout: result.stdout, stderr: result.stderr};
}

export function notarizeDiskImage(path, env, run = nativeCommand) {
  for (const key of ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
    assert(env[key], 'Missing notarization configuration: ' + key);
  }
  const name = basename(path);
  const verifyIdentity = () => {
    run('/usr/bin/codesign', ['--verify', '--strict', path], 'Disk image signature for ' + name);
    const signature = run('/usr/bin/codesign', ['-dv', '--verbose=4', path], 'Disk image publisher for ' + name);
    const lines = (signature.stdout + signature.stderr).split(/\r?\n/);
    assert(lines.some(line => /^Authority=Developer ID Application: .+/.test(line)) &&
      lines.includes('TeamIdentifier=' + env.APPLE_TEAM_ID), 'Unexpected Developer ID signature for ' + name);
  };
  verifyIdentity();
  const result = run('/usr/bin/xcrun', ['notarytool', 'submit', path, '--apple-id', env.APPLE_ID,
    '--password', env.APPLE_APP_SPECIFIC_PASSWORD, '--team-id', env.APPLE_TEAM_ID,
    '--wait', '--output-format', 'json'], 'Notarization of ' + name);
  let submission;
  try { submission = JSON.parse(result.stdout); }
  catch { throw Error('Notarization response could not be verified for ' + name); }
  assert(submission.status === 'Accepted', 'Apple did not accept notarization for ' + name);
  run('/usr/bin/xcrun', ['stapler', 'staple', path], 'Stapling of ' + name);
  run('/usr/bin/xcrun', ['stapler', 'validate', path], 'Notarization ticket validation for ' + name);
  verifyIdentity();
  run('/usr/sbin/spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', path],
    'Gatekeeper disk image assessment for ' + name);
}

export async function finalizeRelease(directory, platform, version, env = process.env, run = nativeCommand) {
  const checksumName = releaseFiles(platform, version).checksums;
  assert(!(await readdir(directory)).includes(checksumName), 'Finalized release already exists; use a clean output directory');
  const before = await verifyUpdateFiles(directory, platform, version);
  for (const name of before.diskImages) notarizeDiskImage(join(directory, name), env, run);
  const after = await verifyUpdateFiles(directory, platform, version);
  assert.deepEqual(after.updateHashes, before.updateHashes, 'Updater bytes changed during notarization');
  const checksums = await Promise.all(after.files.map(async name => `${await hashFile(join(directory, name))}  ${name}\n`));
  await writeFile(join(directory, checksumName), checksums.join(''), {flag: 'wx'});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
  await finalizeRelease('release', process.platform, version);
  console.log('Final signed-distribution bytes and updater files verified.');
}
