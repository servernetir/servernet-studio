// SPDX-License-Identifier: AGPL-3.0-only
import {randomBytes, createHash} from 'node:crypto';
import {ORIGIN, browserApproval, sessionCookie} from './policy.mjs';

export async function signIn(options, io, signal) {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const begin = await io.post('/auth/desktop/start', {lang: options.lang, method: options.method, challenge}, signal);
  const data = begin.data;
  if (begin.status !== 200 || !/^[A-Za-z0-9_-]{43}$/.test(data.request_id) || !/^[A-F0-9]{4}-[A-F0-9]{4}$/.test(data.user_code)
    || !browserApproval(data.browser_url, data.request_id) || data.expires_in !== 3600 || data.interval !== 3) throw Error('Invalid sign-in response.');
  const deadline = io.now() + data.expires_in * 1000;
  signal.throwIfAborted();
  if (!await io.confirmCode(data.user_code)) return;
  signal.throwIfAborted();
  if (io.now() >= deadline) throw Error('Sign-in expired. Start again.');
  await io.open(data.browser_url);
  while (io.now() < deadline) {
    await io.sleep(3000, signal);
    const poll = await io.post('/auth/desktop/poll', {request_id: data.request_id, verifier}, signal);
    if (poll.status === 202 && poll.data.status === 'pending') continue;
    if (poll.status !== 200) throw Error('Sign-in expired or could not be confirmed.');
    const cookie = sessionCookie(poll.data, io.now()/1000);
    await io.setCookie(cookie);
    await io.complete(ORIGIN);
    return;
  }
  throw Error('Sign-in expired. Start again.');
}
