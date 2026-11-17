// SPDX-License-Identifier: AGPL-3.0-only
// Run on a native release host before signing or uploading any artifacts.
import {ORIGIN} from '../src/policy.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

function required(name){if(!process.env[name])throw Error('Missing release configuration: '+name);}
if(!['darwin','win32'].includes(process.platform))throw Error('Release builds require a macOS or Windows host.');
const evidence=JSON.parse(readFileSync(process.env.SERVERNET_ACCEPTANCE_FILE || 'acceptance.json','utf8'));
for(const field of ['account_login','google_login','registration_return','two_factor','wallet_read','billing_reconciled','owner_isolation','font_rendering','native_install','native_logout']){
  if(evidence.checks?.[field]!==true)throw Error('Live acceptance incomplete: '+field);
}
if(evidence.origin!==ORIGIN || evidence.source_sha!==process.env.GITHUB_SHA || !/^[a-f0-9]{40}$/.test(evidence.source_sha))throw Error('Acceptance does not match this release source and origin.');
if(!Number.isFinite(Date.parse(evidence.checked_at)) || Date.now()-Date.parse(evidence.checked_at)>7*86400000 || Date.parse(evidence.checked_at)>Date.now())throw Error('Acceptance evidence is stale.');
required('CSC_LINK');required('CSC_KEY_PASSWORD');
if(process.platform==='darwin'){
  for(const name of ['APPLE_ID','APPLE_APP_SPECIFIC_PASSWORD','APPLE_TEAM_ID'])required(name);
  execFileSync('/usr/bin/xcrun',['--find','notarytool'],{stdio:'ignore'});
}else required('SERVERNET_WINDOWS_PUBLISHER');
const response=await fetch(ORIGIN+'/healthz',{redirect:'error',signal:AbortSignal.timeout(15000)});
const health=await response.json();
if(!response.ok || health.service!=='servernet-studio' || health.status!=='ok' || health.desktop_auth_protocol!==1)throw Error('Studio runtime is unavailable or incompatible.');
console.log('Release prerequisites passed. Native signatures and artifact checks are still required.');
