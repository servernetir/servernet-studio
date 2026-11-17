// SPDX-License-Identifier: AGPL-3.0-only
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativeBinary} from '../scripts/native-target.mjs';

test('native startup selects the package for the actual Mac architecture', () => {
  assert.equal(nativeBinary('darwin', 'x64'), 'release/mac/ServerNet Studio.app/Contents/MacOS/ServerNet Studio');
  assert.equal(nativeBinary('darwin', 'arm64'), 'release/mac-arm64/ServerNet Studio.app/Contents/MacOS/ServerNet Studio');
  assert.equal(nativeBinary('win32', 'x64'), 'release/win-unpacked/ServerNet Studio.exe');
});

test('native checks reject a mismatched host instead of accepting emulation', () => {
  assert.throws(() => nativeBinary('darwin', 'arm64', 'x64'), /architecture/);
  assert.throws(() => nativeBinary('darwin', 'x64', 'arm64'), /architecture/);
  for (const host of [['linux', 'x64'], ['win32', 'arm64'], ['darwin', 'ia32']]) {
    assert.throws(() => nativeBinary(...host), /supported/);
  }
});
