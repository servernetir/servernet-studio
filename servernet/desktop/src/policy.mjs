// SPDX-License-Identifier: AGPL-3.0-only
export const ORIGIN = 'https://studio.servernet.cloud';
export const COOKIE = '__Host-servernet-studio';
export const DOWNLOADS = 'https://servernet.cloud/studio/download';
export const UPDATE_FEED = 'https://servernet.cloud/downloads/studio/';
export const LANGUAGES = ['fa', 'en', 'tr'];
export const METHODS = ['account', 'google', 'register'];

export function url(value) { try { const u = new URL(value); return u.username || u.password ? null : u; } catch { return null; } }
export function signinOptions(value) {
  const u = url(value);
  if (!u || u.origin !== ORIGIN || u.pathname !== '/auth/start') return null;
  const lang = u.searchParams.get('lang') || 'fa', method = u.searchParams.get('method') || 'account';
  const theme = u.searchParams.get('theme') === 'light' ? 'light' : 'dark';
  return LANGUAGES.includes(lang) && METHODS.includes(method) ? {lang, method, theme} : null;
}
export function internal(value) {
  const u = url(value);
  // All authentication navigation is handled in the system browser.
  return !!u && u.origin === ORIGIN && !u.pathname.startsWith('/auth/') && !u.pathname.startsWith('/api/');
}
export function external(value) {
  const u = url(value);
  if (!u || u.protocol !== 'https:' || u.port) return false;
  if (u.origin === 'https://console.servernet.cloud') return /^\/(?:en\/|tr\/)?(?:account(?:\/|$)|login(?:\/|$)|register(?:\/|$))/.test(u.pathname);
  if (u.origin === 'https://myaccount.google.com') return u.pathname === '/connections' && !u.search && !u.hash;
  return u.origin === 'https://servernet.cloud' && /^\/(?:en\/|tr\/)?(?:studio\/download|ai\/(?:models|docs))\/?$/.test(u.pathname)
    || u.origin === ORIGIN && (u.pathname === '/legal' || u.pathname === '/studio-chrome-extension.zip'
      || (u.pathname === '/' && !u.search && u.hash === '#connectors'));
}
export function conversationExport(value) {
  const u = url(value);
  if (!u || u.origin !== ORIGIN || u.search || u.hash) return null;
  const match = /^\/api\/conversations\/([a-f0-9]{32})\/export$/.exec(u.pathname);
  return match ? `servernet-conversation-${match[1]}.txt` : null;
}
export function mediaExport(value, mime) {
  const u = url(value);
  if (!u || u.origin !== ORIGIN || u.search !== '?download=true' || u.hash) return null;
  const match = /^\/api\/media\/([a-f0-9]{32})\/asset\/[0-7]$/.exec(u.pathname);
  const extensions = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif',
    'video/mp4':'mp4','video/webm':'webm','audio/wav':'wav','audio/mpeg':'mp3',
    'audio/ogg':'ogg','audio/flac':'flac','audio/aac':'aac'};
  return match && Object.hasOwn(extensions,mime) ? 'studio-output-'+match[1]+'.'+extensions[mime] : null;
}
export function browserApproval(value, identifier) {
  const u = url(value);
  return !!u && u.origin === ORIGIN && u.pathname === '/auth/desktop'
    && u.searchParams.size === 1 && u.searchParams.get('request_id') === identifier && !u.hash;
}
export function sessionCookie(payload, now = Date.now()/1000) {
  if (payload.origin !== ORIGIN || payload.cookie_name !== COOKIE || !/^[A-Za-z0-9_-]{43}$/.test(payload.cookie_value)
    || !Number.isInteger(payload.expires_at) || payload.expires_at <= now || payload.expires_at > now + 28810) throw Error('Invalid desktop session.');
  return {url: ORIGIN, name: COOKIE, value: payload.cookie_value, path:'/',
    secure:true, httpOnly:true, sameSite:'lax', expirationDate:payload.expires_at};
}
