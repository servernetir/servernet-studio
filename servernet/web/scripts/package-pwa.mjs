// SPDX-License-Identifier: AGPL-3.0-only
// Produce an allowlisted runtime-only upload from the tested Vite output.
import {createHash} from 'node:crypto';
import {copyFileSync, mkdirSync, readdirSync, readFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const destination = process.argv[2];
assert(destination, 'Usage: node scripts/package-pwa.mjs <new staging directory>');
const stage = resolve(destination);

function files(directory) {
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return files(path);
    assert(entry.isFile(), `Unexpected non-file in build: ${relative(dist, path)}`);
    return [relative(dist, path)];
  });
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const hashed = [...html.matchAll(/(?:src|href)="\/(assets\/index-[A-Za-z0-9_-]+\.(?:js|css))"/g)].map(match => match[1]);
assert.equal(hashed.length, 2, 'Expected exactly two hashed runtime files');
assert.equal(hashed.filter(name => name.endsWith('.js')).length, 1);
assert.equal(hashed.filter(name => name.endsWith('.css')).length, 1);
const runtime = [
  'index.html', 'manifest.webmanifest', 'servernet.svg',
  'icons/studio-180.png', 'icons/studio-192.png', 'icons/studio-512.png', ...hashed,
].sort();
// The existing extension is intentionally distributed via its established release
// process, not this rolling web install update. Fail on any unreviewed output.
assert.deepEqual(files(dist).sort(), [...runtime, 'studio-chrome-extension.zip'].sort());

mkdirSync(stage);
for (const name of runtime) {
  const source = join(dist, name), target = join(stage, name);
  mkdirSync(dirname(target), {recursive: true});
  copyFileSync(source, target);
  console.log(`${createHash('sha256').update(readFileSync(target)).digest('hex')}  ${name}`);
}
