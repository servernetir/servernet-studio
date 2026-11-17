# SPDX-License-Identifier: AGPL-3.0-only
"""Browser-approved desktop sign-in. No provider or client secrets leave the BFF."""
import hashlib
import html
import re
import secrets
import time
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

from .app import LOGIN_FLOW_TTL, digest


class DesktopChallenge(BaseModel):
    challenge: str = Field(pattern=r'^[A-Za-z0-9_-]{43}$')
    lang: str = Field(default='fa', pattern=r'^(fa|en|tr)$')
    method: str = Field(default='account', pattern=r'^(account|google|register)$')


class DesktopClaim(BaseModel):
    request_id: str = Field(pattern=r'^[A-Za-z0-9_-]{43}$')
    verifier: str = Field(pattern=r'^[A-Za-z0-9_-]{43}$')


TEXT = {
    'fa': ('اتصال برنامهٔ سرورنت', 'کد نمایش‌داده‌شده در برنامهٔ نصب‌شده را وارد کنید. فقط اتصال برنامه‌ای را تأیید کنید که خودتان باز کرده‌اید.', 'کد برنامه', 'ادامه در سرورنت', 'اتصال تأیید شد. به برنامهٔ سرورنت برگردید.', 'ورود با حساب', 'ادامه با گوگل', 'ثبت‌نام'),
    'en': ('Connect ServerNet Studio', 'Enter the code shown in your desktop app. Only connect an app you opened yourself.', 'App code', 'Continue with ServerNet', 'Connection approved. Return to ServerNet Studio.', 'Account sign-in', 'Continue with Google', 'Create account'),
    'tr': ('ServerNet Studio bağlantısı', 'Masaüstü uygulamanızdaki kodu girin. Yalnızca kendiniz açtığınız uygulamayı bağlayın.', 'Uygulama kodu', 'ServerNet ile devam et', 'Bağlantı onaylandı. ServerNet Studio’ya dönün.', 'Hesapla giriş', 'Google ile devam et', 'Hesap oluştur'),
}


def page(lang, content):
    title = html.escape(TEXT[lang][0])
    return '<!doctype html><html lang="'+lang+'" dir="'+('rtl' if lang == 'fa' else 'ltr')+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+title+'</title><link rel="stylesheet" href="/assets/desktop-auth.css"></head><body><main><img src="/servernet.svg" alt="ServerNet"><h1>'+title+'</h1>'+content+'</main></body></html>'


class DesktopLogin:
    def __init__(self, store, settings):
        self.store, self.settings = store, settings
        with store.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS desktop_requests(id TEXT PRIMARY KEY, challenge TEXT, code TEXT,
                    lang TEXT, method TEXT, state TEXT, attempts INTEGER, cookie TEXT, session_expires INTEGER, expires INTEGER);
                CREATE TABLE IF NOT EXISTS desktop_flows(flow TEXT PRIMARY KEY, request_id TEXT UNIQUE);
                CREATE TABLE IF NOT EXISTS desktop_limits(ip TEXT, bucket INTEGER, hits INTEGER, PRIMARY KEY(ip,bucket));
            ''')

    def begin(self, body, ip):
        identifier, code = secrets.token_urlsafe(32), secrets.token_hex(4).upper()
        now = int(time.time())
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM desktop_requests WHERE expires<=?', (now,))
            # Keep an expired native request's link while its browser PKCE flow
            # still exists, so callback cannot silently become a web sign-in.
            db.execute('DELETE FROM desktop_flows WHERE flow NOT IN (SELECT state FROM flows)')
            db.execute('DELETE FROM desktop_limits WHERE bucket<?', (now//600,))
            key = digest(ip)
            hits = db.execute('SELECT hits FROM desktop_limits WHERE ip=? AND bucket=?', (key, now//600)).fetchone()
            if (hits and hits['hits'] >= 120) or db.execute('SELECT COUNT(*) FROM desktop_requests').fetchone()[0] >= 1000:
                raise HTTPException(429, 'Too many sign-in requests. Try later.')
            db.execute('INSERT INTO desktop_limits VALUES(?,?,1) ON CONFLICT(ip,bucket) DO UPDATE SET hits=hits+1', (key, now//600))
            db.execute('INSERT INTO desktop_requests VALUES(?,?,?,?,?,?,0,NULL,NULL,?)',
                       (identifier, body.challenge, digest(code), body.lang, body.method, 'pending', now + LOGIN_FLOW_TTL))
        return {'request_id': identifier, 'user_code': code[:4]+'-'+code[4:],
                'browser_url': self.settings.origin+'/auth/desktop?request_id='+identifier,
                'expires_in': LOGIN_FLOW_TTL, 'interval': 3}

    def lookup(self, identifier):
        if not re.fullmatch(r'[A-Za-z0-9_-]{43}', identifier):
            raise HTTPException(404, 'Sign-in request not found.')
        with self.store.connect() as db:
            row = db.execute('SELECT * FROM desktop_requests WHERE id=? AND expires>?', (identifier, int(time.time()))).fetchone()
        if row is None:
            raise HTTPException(410, 'Sign-in expired. Start again in the desktop app.')
        return dict(row)

    def activate(self, identifier, code):
        row = self.lookup(identifier)
        normalized = code.replace('-', '').replace(' ', '').upper()
        valid = secrets.compare_digest(row['code'], digest(normalized))
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            current = db.execute('SELECT * FROM desktop_requests WHERE id=?', (identifier,)).fetchone()
            if current is None or current['expires'] <= int(time.time()):
                raise HTTPException(410, 'Sign-in expired.')
            if current['state'] != 'pending' or current['attempts'] >= 5:
                raise HTTPException(409, 'Start again in the desktop app.')
            db.execute('UPDATE desktop_requests SET attempts=attempts+1, state=? WHERE id=?',
                       ('authorizing' if valid else 'pending', identifier))
        # Commit failed guesses too; raising inside the transaction would roll them back.
        if not valid:
            raise HTTPException(400, 'The code does not match your desktop app.')
        return row

    def link(self, state, identifier):
        with self.store.connect() as db:
            db.execute('INSERT INTO desktop_flows VALUES(?,?)', (digest(state), identifier))

    def complete(self, state, cookie, ttl):
        now = int(time.time())
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            link = db.execute('SELECT request_id FROM desktop_flows WHERE flow=?', (digest(state),)).fetchone()
            if link is None:
                return None
            row = db.execute('SELECT * FROM desktop_requests WHERE id=?', (link['request_id'],)).fetchone()
            if row is None or row['expires'] <= now or row['state'] != 'authorizing':
                # Revoke the unused local session if its native request has expired.
                db.execute('DELETE FROM sessions WHERE id=?', (digest(cookie),))
                expired = True
            else:
                db.execute("UPDATE desktop_requests SET state='ready', cookie=?, session_expires=?, expires=? WHERE id=?",
                           (self.store.encrypt(cookie), now+ttl, min(row['expires'], now+60), row['id']))
                expired = False
            db.execute('DELETE FROM desktop_flows WHERE flow=?', (digest(state),))
        if expired:
            raise HTTPException(410, 'Start sign-in again in the desktop app.')
        return row['lang']

    def claim(self, body):
        import base64
        challenge = base64.urlsafe_b64encode(hashlib.sha256(body.verifier.encode()).digest()).decode().rstrip('=')
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM desktop_requests WHERE id=? AND expires>?', (body.request_id, int(time.time()))).fetchone()
            if row is None:
                raise HTTPException(410, 'Sign-in expired or already claimed.')
            if not secrets.compare_digest(challenge, row['challenge']):
                raise HTTPException(403, 'Desktop verification failed.')
            if row['state'] == 'pending' and row['attempts'] >= 5:
                raise HTTPException(409, 'Start again in the desktop app.')
            if row['state'] != 'ready':
                return JSONResponse({'status': 'pending'}, 202, {'Retry-After': '3'})
            cookie = self.store.decrypt(row['cookie'])
            db.execute('DELETE FROM desktop_requests WHERE id=?', (body.request_id,))
        return JSONResponse({'cookie_name': self.settings.cookie, 'cookie_value': cookie,
                             'expires_at': row['session_expires'], 'origin': self.settings.origin})

    def install(self, app, start):
        @app.post('/auth/desktop/start')
        async def begin(body: DesktopChallenge, request: Request):
            if request.headers.get('origin') not in (None, self.settings.origin):
                raise HTTPException(403, 'Invalid origin.')
            return self.begin(body, request.client.host)

        @app.post('/auth/desktop/poll')
        async def poll(body: DesktopClaim, request: Request):
            if request.headers.get('origin') not in (None, self.settings.origin):
                raise HTTPException(403, 'Invalid origin.')
            return self.claim(body)

        @app.get('/auth/desktop', response_class=HTMLResponse)
        async def approval(request_id: str):
            row = self.lookup(request_id)
            if row['state'] != 'pending' or row['attempts'] >= 5:
                raise HTTPException(409, 'Start again in the desktop app.')
            csrf = secrets.token_urlsafe(32)
            t = TEXT[row['lang']]
            options = ''.join('<option value="'+method+'"'+(' selected' if row['method']==method else '')+'>'+html.escape(label)+'</option>'
                              for method, label in zip(('account','google','register'), t[5:]))
            content = '<p>'+html.escape(t[1])+'</p><form action="/auth/desktop" method="post"><input type="hidden" name="request_id" value="'+request_id+'"><input type="hidden" name="csrf" value="'+csrf+'"><label for="code">'+html.escape(t[2])+'</label><input id="code" name="code" maxlength="9" required autocomplete="off" dir="ltr" placeholder="ABCD-1234"><select name="method">'+options+'</select><button>'+html.escape(t[3])+'</button></form>'
            response = HTMLResponse(page(row['lang'], content))
            response.set_cookie(self.settings.cookie+'-device', csrf, max_age=600, secure=not self.settings.testing, httponly=True, samesite='strict', path='/')
            return response

        @app.post('/auth/desktop')
        async def approve(request: Request):
            if request.headers.get('origin') != self.settings.origin:
                raise HTTPException(403, 'Invalid origin.')
            try:
                fields = {k: v[0] for k, v in parse_qs((await request.body()).decode(), max_num_fields=5).items()}
            except (ValueError, UnicodeError):
                raise HTTPException(400, 'Invalid form.') from None
            csrf = fields.get('csrf', '')
            if not csrf or not secrets.compare_digest(csrf, request.cookies.get(self.settings.cookie+'-device', '')):
                raise HTTPException(403, 'Request verification failed.')
            method = fields.get('method', 'account')
            if method not in ('account', 'google', 'register'):
                raise HTTPException(400, 'Invalid sign-in method.')
            row = self.activate(fields.get('request_id', ''), fields.get('code', ''))
            response = await start(lang=row['lang'], method=method)
            state = parse_qs(urlsplit(response.headers['location']).query)['state'][0]
            self.link(state, row['id'])
            response.delete_cookie(self.settings.cookie+'-device', path='/', secure=not self.settings.testing, httponly=True, samesite='strict')
            return response

        @app.get('/assets/desktop-auth.css')
        async def stylesheet():
            return FileResponse(Path(__file__).with_name('desktop-auth.css'), media_type='text/css')
