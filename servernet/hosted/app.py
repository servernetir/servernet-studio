# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026 ServerNet contributors
"""Customer-facing ServerNet Studio. No local-model/tool/admin routes are exposed.

The independent customer shell keeps the upstream engine available for later
isolated workers. Customer identity and every billable call belong to ServerNet.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager, asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlencode, urlsplit

import httpx
from cryptography.fernet import Fernet
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from servernet.hosted.config import runtime_environment
from servernet.hosted.connectors import install_connectors
from servernet.hosted.media import MAX_REQUEST, MEDIA_HOSTS, MediaStore, install_media, json_response

# Registration includes the console's existing verification steps. This is only
# a browser-bound PKCE transaction lifetime, not an authorization code lifetime.
LOGIN_FLOW_TTL = 3600


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


@dataclass(frozen=True)
class Settings:
    origin: str
    client_secret: str
    encryption_key: str
    database: Path
    source_url: str
    console: str = 'https://console.servernet.cloud'
    gateway: str = 'https://servernet.cloud/v1'
    fonts: Path = Path('/run/servernet/fonts')
    assets: Path = Path(__file__).parents[1] / 'web' / 'dist'
    testing: bool = False
    gmail_client_id: str | None = None
    gmail_client_secret: str | None = None

    def __post_init__(self):
        for value in (self.origin, self.console, self.gateway, self.source_url):
            parsed = urlsplit(value)
            local_test = self.testing and parsed.hostname in ('localhost', '127.0.0.1', 'testserver')
            if (parsed.scheme != 'https' and not local_test) or not parsed.hostname or parsed.username or parsed.query or parsed.fragment:
                raise ValueError('ServerNet URLs must be configured HTTPS origins/paths without credentials, query or fragment.')
        if urlsplit(self.origin).path not in ('', '/') or self.origin.endswith('/'):
            raise ValueError('Studio origin must not have a path or trailing slash.')
        if len(self.client_secret) < 32:
            raise ValueError('A private Studio client secret of at least 32 characters is required.')
        if bool(self.gmail_client_id) != bool(self.gmail_client_secret):
            raise ValueError('Configure both Gmail OAuth client fields or leave both unset.')
        Fernet(self.encryption_key.encode())

    @property
    def callback(self):
        return self.origin + '/auth/callback'

    @property
    def cookie(self):
        return 'sn_studio_test' if self.testing else '__Host-servernet-studio'


class Store:
    def __init__(self, settings: Settings):
        self.path = settings.database
        self.crypt = Fernet(settings.encryption_key.encode())
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with self.connect() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS flows(state TEXT PRIMARY KEY, browser TEXT, verifier TEXT, expires INTEGER);
                CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, subject TEXT, name TEXT, token TEXT, csrf TEXT, expires INTEGER);
                CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY, subject TEXT, title TEXT, created INTEGER);
                CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, conversation TEXT, role TEXT, content TEXT);
                CREATE TABLE IF NOT EXISTS calls(subject TEXT, id TEXT, conversation TEXT, fingerprint TEXT, state TEXT, reply TEXT,
                    PRIMARY KEY(subject,id));
                CREATE INDEX IF NOT EXISTS conversations_owner ON conversations(subject, created);
                CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation,id);
            ''')
        os.chmod(self.path, 0o600)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def encrypt(self, value):
        return self.crypt.encrypt(value.encode()).decode()

    def decrypt(self, value):
        return self.crypt.decrypt(value.encode()).decode()

    def begin_flow(self):
        state, browser, verifier = [secrets.token_urlsafe(32) for _ in range(3)]
        with self.connect() as db:
            db.execute('DELETE FROM flows WHERE expires < ?', (int(time.time()),))
            db.execute('DELETE FROM sessions WHERE expires < ?', (int(time.time()),))
            db.execute('INSERT INTO flows VALUES(?,?,?,?)', (digest(state), digest(browser), self.encrypt(verifier), int(time.time()) + LOGIN_FLOW_TTL))
        return state, browser, verifier

    def consume_flow(self, state, browser):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM flows WHERE state=? AND browser=? AND expires>?',
                             (digest(state), digest(browser), int(time.time()))).fetchone()
            if row is None:
                raise HTTPException(400, 'Sign-in expired or could not be verified. Start again.')
            db.execute('DELETE FROM flows WHERE state=?', (digest(state),))
        return self.decrypt(row['verifier'])

    def session(self, cookie):
        with self.connect() as db:
            row = db.execute('SELECT * FROM sessions WHERE id=? AND expires>?', (digest(cookie), int(time.time()))).fetchone()
        if row is None:
            raise HTTPException(401, 'Sign in with ServerNet to continue.')
        return dict(row)

    def create_session(self, payload):
        cookie, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        # Identity is supplied only by the authenticated token exchange.
        customer = payload['customer']
        if not isinstance(customer['id'], str) or not customer['id'] or not isinstance(customer['name'], str):
            raise ValueError('Invalid customer identity.')
        ttl = min(28800, int(payload['expires_in']))
        if ttl <= 0:
            raise ValueError('Expired sign-in response.')
        with self.connect() as db:
            db.execute('INSERT INTO sessions VALUES(?,?,?,?,?,?)', (digest(cookie), customer['id'], customer['name'],
                self.encrypt(payload['access_token']), csrf, int(time.time()) + ttl))
        return cookie, ttl

    def conversation(self, subject, conversation_id):
        with self.connect() as db:
            row = db.execute('SELECT * FROM conversations WHERE id=? AND subject=?', (conversation_id, subject)).fetchone()
            if row is None:
                raise HTTPException(404, 'Conversation not found.')
            messages = [dict(m) for m in db.execute('SELECT role,content FROM messages WHERE conversation=? ORDER BY id', (conversation_id,))]
            pending = db.execute("SELECT id,state FROM calls WHERE subject=? AND conversation=? AND state IN ('sending','unknown')",
                                 (subject, conversation_id)).fetchone()
        return {'id': row['id'], 'title': row['title'], 'messages': messages, 'pending': dict(pending) if pending else None}

    def prepare_call(self, subject, body):
        fingerprint = digest(json.dumps(body.model_dump(exclude_none=True), sort_keys=True, ensure_ascii=False))
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute('SELECT * FROM calls WHERE subject=? AND id=?', (subject, body.request_id)).fetchone()
            if previous:
                if previous['fingerprint'] != fingerprint:
                    raise HTTPException(422, 'This request identifier belongs to a different message.')
                if previous['state'] == 'done':
                    return None, json.loads(previous['reply'])
                raise HTTPException(409, 'This request is pending or already attempted. Check its billing status before sending again.')
            row = db.execute('SELECT * FROM conversations WHERE id=? AND subject=?', (body.conversation_id, subject)).fetchone()
            if row is None:
                raise HTTPException(404, 'Conversation not found.')
            if db.execute("SELECT 1 FROM calls WHERE subject=? AND conversation=? AND state IN ('sending','unknown')",
                          (subject, body.conversation_id)).fetchone():
                raise HTTPException(409, 'A previous request in this conversation needs reconciliation.')
            messages = [dict(m) for m in db.execute("""SELECT role,content FROM messages WHERE conversation=?
                AND (role!='assistant' OR content!='') ORDER BY id""", (body.conversation_id,))]
            if len(messages) > 98 or sum(len(m['content']) for m in messages) > 120000:
                raise HTTPException(422, 'Start a new conversation to continue within the context limit.')
            messages.append({'role': 'user', 'content': body.message})
            db.execute('INSERT INTO calls VALUES(?,?,?,?,?,?)', (subject, body.request_id, body.conversation_id, fingerprint, 'sending', None))
        return messages, None

    def fail_call(self, subject, request_id, state='unknown'):
        with self.connect() as db:
            db.execute("UPDATE calls SET state=? WHERE subject=? AND id=? AND state='sending'", (state, subject, request_id))

    def finish_call(self, subject, body, text, result):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            updated = db.execute("UPDATE calls SET state='done',reply=? WHERE subject=? AND id=? AND state='sending'",
                                 (json.dumps(result), subject, body.request_id)).rowcount
            if updated != 1:
                raise RuntimeError('Request state changed before completion.')
            db.executemany('INSERT INTO messages(conversation,role,content) VALUES(?,?,?)',
                           [(body.conversation_id, 'user', body.message), (body.conversation_id, 'assistant', text)])
            db.execute("UPDATE conversations SET title=? WHERE id=? AND title='New conversation'", (body.message[:70], body.conversation_id))


class BodyLimit:
    """Bound JSON bodies even when a client sends chunked data without a length."""
    def __init__(self, app, origin):
        self.app = app
        self.origin = origin

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope['method'] != 'POST':
            return await self.app(scope, receive, send)
        headers = dict(scope.get('headers', []))
        limit = request_limit(scope['path'], headers.get(b'origin', b'').decode('latin1'), self.origin)
        body = bytearray()
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            body.extend(message.get('body', b''))
            if len(body) > limit:
                return await JSONResponse({'detail': 'Request is too large.'}, 413)(scope, receive, send)
            if not message.get('more_body'):
                break
        delivered = False
        async def cached_receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {'type':'http.request', 'body':bytes(body), 'more_body':False}
            return await receive()
        return await self.app(scope, cached_receive, send)


class ChatRequest(BaseModel):
    conversation_id: str = Field(pattern=r'^[a-f0-9]{32}$')
    request_id: str = Field(pattern=r'^[a-f0-9]{32}$')
    model: str = Field(min_length=1, max_length=120)
    message: str = Field(min_length=1, max_length=8000)
    image: str | None = Field(default=None, max_length=2_800_000)


def request_limit(path, origin, expected):
    return MAX_REQUEST if origin == expected and path in ('/api/chat', '/api/media', '/api/media/quote') else 32000


def event(name, data):
    return 'event: ' + name + '\ndata: ' + json.dumps(data, ensure_ascii=False) + '\n\n'


def create_app(settings: Settings, upstream: httpx.AsyncClient | None = None):
    from .desktop import DesktopLogin, TEXT, page
    from .gmail import install_gmail
    store = Store(settings)
    desktop = DesktopLogin(store, settings)
    media = MediaStore(store)
    client = upstream or httpx.AsyncClient(timeout=httpx.Timeout(120, read=90), trust_env=False, follow_redirects=False)
    @asynccontextmanager
    async def lifespan(app):
        yield
        if upstream is None:
            await client.aclose()

    app = FastAPI(title='ServerNet Studio', docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.add_middleware(BodyLimit, origin=settings.origin)
    app.state.store = store

    @app.middleware('http')
    async def protect(request, call_next):
        try:
            length = int(request.headers.get('content-length', '0'))
        except ValueError:
            return JSONResponse({'detail': 'Invalid request length.'}, 400)
        if length > request_limit(request.url.path, request.headers.get('origin'), settings.origin):
            return JSONResponse({'detail': 'Request is too large.'}, 413)
        response = await call_next(request)
        referrer_policy = 'no-referrer'
        form_targets = "'self'"
        if request.method == 'GET' and request.url.path == '/auth/desktop' and response.status_code == 200:
            # A top-level form POST from a no-referrer page has an opaque Origin.
            # Keep the request ID on Studio and allow the reviewed login redirects.
            referrer_policy = 'same-origin'
            form_targets += f' {settings.console} https://accounts.google.com'
        response.headers.update({
            'Cache-Control': 'no-store',
            'Referrer-Policy': referrer_policy,
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Content-Security-Policy': (
                "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; "
                "img-src 'self' data: blob: " + ' '.join('https://' + host for host in MEDIA_HOSTS) + "; "
                "media-src 'self' " + ' '.join('https://' + host for host in MEDIA_HOSTS) + "; "
                "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; "
                f"form-action {form_targets}"
            ),
        })
        return response

    def authenticated(request, mutate=False):
        row = store.session(request.cookies.get(settings.cookie, ''))
        if mutate and (request.headers.get('origin') != settings.origin or not secrets.compare_digest(request.headers.get('x-csrf-token', ''), row['csrf'])):
            raise HTTPException(403, 'Request verification failed.')
        return row

    def headers(row):
        return {'Authorization': 'Bearer ' + store.decrypt(row['token']), 'Accept': 'application/json'}

    install_media(app, settings, store, media, client, authenticated, headers)
    vault = install_connectors(app, store, authenticated)
    install_gmail(app, settings, store, vault, client, authenticated)

    @app.get('/auth/start')
    async def start(lang: str = 'fa', method: str = 'account'):
        if lang not in ('fa', 'en', 'tr'):
            raise HTTPException(422, 'Unsupported language.')
        if method not in ('account', 'google', 'register'):
            raise HTTPException(422, 'Unsupported sign-in method.')
        language_prefix = '' if lang == 'fa' else lang + '/'
        state, browser, verifier = store.begin_flow()
        challenge = __import__('base64').urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
        response = RedirectResponse(settings.console + '/' + language_prefix + 'login/studio?' + urlencode({
            'client_id': 'servernet-studio', 'redirect_uri': settings.callback, 'state': state,
            'code_challenge': challenge, 'code_challenge_method': 'S256', 'login_method': method}), 302)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.set_cookie(settings.cookie + '-flow', browser, max_age=LOGIN_FLOW_TTL, secure=not settings.testing,
                            httponly=True, samesite='lax', path='/')
        return response

    @app.get('/auth/callback')
    async def callback(request: Request, code: str, state: str):
        if len(code) > 128 or len(state) > 128:
            raise HTTPException(400, 'Invalid sign-in response.')
        verifier = store.consume_flow(state, request.cookies.get(settings.cookie + '-flow', ''))
        try:
            result = await client.post(settings.console + '/api/studio/token', json={
                'client_id': 'servernet-studio', 'client_secret': settings.client_secret, 'redirect_uri': settings.callback,
                'code': code, 'code_verifier': verifier})
            result.raise_for_status()
            cookie, ttl = store.create_session(result.json())
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            raise HTTPException(502, 'ServerNet sign-in could not be completed. Start sign-in again.') from None
        native_lang = desktop.complete(state, cookie, ttl)
        if native_lang:
            from html import escape
            response = HTMLResponse(page(native_lang, '<p>'+escape(TEXT[native_lang][4])+'</p>'))
        else:
            response = RedirectResponse('/', 303)
            response.set_cookie(settings.cookie, cookie, max_age=ttl, secure=not settings.testing, httponly=True, samesite='lax', path='/')
        response.delete_cookie(settings.cookie + '-flow', path='/', secure=not settings.testing, httponly=True, samesite='lax')
        return response

    desktop.install(app, start)

    @app.get('/healthz')
    async def health():
        with store.connect() as db:
            db.execute('SELECT 1').fetchone()
        return {'service': 'servernet-studio', 'status': 'ok', 'desktop_auth_protocol': 1}

    @app.get('/api/session')
    async def session(request: Request):
        row = authenticated(request)
        return {'name': row['name'], 'csrf': row['csrf']}

    async def gateway_get(path, row):
        try:
            response = await client.get(settings.gateway + path, headers=headers(row))
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as exc:
            raise HTTPException(401 if exc.response.status_code in (401, 403) else 502, 'ServerNet account access could not be verified.') from None
        except (httpx.HTTPError, ValueError):
            raise HTTPException(502, 'ServerNet is temporarily unavailable.') from None

    @app.get('/api/account')
    async def account(request: Request):
        return await gateway_get('/studio/account', authenticated(request))

    @app.get('/api/tools/mcp')
    async def mcp_tools(request: Request):
        row = authenticated(request)
        request_headers = headers(row) | {'Accept':'application/json, text/event-stream', 'MCP-Protocol-Version':'2025-11-25'}
        try:
            code, _, body = await json_response(client, 'POST', settings.gateway+'/studio/mcp',
                request_headers, {'jsonrpc':'2.0','id':1,'method':'tools/list'})
        except (httpx.HTTPError, ValueError):
            raise HTTPException(502, 'MCP catalogue unavailable.') from None
        result = body.get('result')
        if code != 200 or body.get('id') != 1 or not isinstance(result, dict) or not isinstance(result.get('tools'), list):
            raise HTTPException(502, 'MCP catalogue unavailable.')
        return {'tools': [{'name': tool['name']} for tool in result['tools'] if isinstance(tool, dict)
                          and tool.get('name') == 'list_models']}

    @app.get('/api/models')
    async def models(request: Request, catalog: bool = False):
        upstream = await gateway_get('/models?studio=1' if catalog else '/models', authenticated(request))
        categories = ('chat', 'image', 'video', 'audio', 'music', 'classification') if catalog else ('chat',)
        data = []
        for model in upstream.get('data', []):
            if not isinstance(model, dict) or model.get('category') not in categories or not isinstance(model.get('id'), str):
                continue
            entry = {'id': model['id'], 'context_length': model.get('context_length')}
            if catalog:
                entry['category'] = model['category']
                for key in ('name', 'vision', 'pricing', 'studio', 'endpoint', 'free'):
                    if key in model:
                        entry[key] = model[key]
            data.append(entry)
        return {'data': data}

    @app.post('/api/logout')
    async def logout(request: Request):
        row = authenticated(request, True)
        try:
            await client.post(settings.gateway + '/studio/revoke', headers=headers(row))
        except httpx.HTTPError:
            pass  # Local logout still succeeds. The remote key has a bounded expiry.
        with store.connect() as db:
            db.execute('DELETE FROM sessions WHERE id=?', (row['id'],))
        response = JSONResponse({'ok': True})
        response.delete_cookie(settings.cookie, path='/', secure=not settings.testing, httponly=True, samesite='lax')
        return response

    @app.get('/api/conversations')
    async def conversations(request: Request):
        row = authenticated(request)
        with store.connect() as db:
            return [dict(r) for r in db.execute('SELECT id,title FROM conversations WHERE subject=? ORDER BY created DESC LIMIT 100', (row['subject'],))]

    @app.post('/api/conversations')
    async def new_conversation(request: Request):
        row = authenticated(request, True)
        identifier = uuid.uuid4().hex
        with store.connect() as db:
            db.execute('INSERT INTO conversations VALUES(?,?,?,?)', (identifier, row['subject'], 'New conversation', int(time.time())))
        return {'id': identifier, 'title': 'New conversation'}

    @app.get('/api/conversations/{identifier}')
    async def conversation(identifier: str, request: Request):
        row = authenticated(request)
        detail = store.conversation(row['subject'], identifier)
        detail['messages'] = media.messages(row['subject'], identifier)
        return detail

    @app.get('/api/conversations/{identifier}/export')
    async def export_conversation(identifier: str, request: Request):
        row = authenticated(request)
        if not re.fullmatch(r'[a-f0-9]{32}', identifier):
            raise HTTPException(404, 'Conversation not found.')
        conversation = store.conversation(row['subject'], identifier)
        sections = [conversation['title']]
        for message in conversation['messages']:
            speaker = 'You' if message['role'] == 'user' else 'ServerNet'
            sections.append(f"{speaker}:\n{message['content']}")
        return PlainTextResponse('\n\n'.join(sections) + '\n', headers={
            'Content-Disposition': f'attachment; filename="servernet-conversation-{identifier}.txt"',
        })

    @app.post('/api/chat')
    async def chat(body: ChatRequest, request: Request):
        row = authenticated(request, True)
        if body.image is not None and (body.model == 'studio-free-chat' or not re.fullmatch(
                r'data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}', body.image)):
            raise HTTPException(422, 'Choose a supported image and vision model.')
        messages, replay = store.prepare_call(row['subject'], body)
        if replay is not None:
            return StreamingResponse(iter([event('done', replay)]), media_type='text/event-stream')
        if body.model == 'studio-free-chat':
            try:
                code, _, data = await json_response(client, 'POST', settings.gateway + '/studio/free/chat',
                    headers(row), {'model': body.model, 'messages': messages})
            except (httpx.HTTPError, ValueError):
                code, data = 503, {}
            if code != 200 or type(data.get('charge_irt')) is not int or data['charge_irt'] != 0 \
                    or not isinstance(data.get('text'), str) or not isinstance(data.get('usage'), dict):
                store.fail_call(row['subject'], body.request_id, 'rejected')
                raise HTTPException(429 if code == 429 else 503, 'Free Chat is temporarily unavailable.')
            result = {'text': data['text'], 'usage': data['usage'], 'charge_irt': 0, 'request_id': body.request_id}
            store.finish_call(row['subject'], body, data['text'], result)
            return StreamingResponse(iter([event('done', result)]), media_type='text/event-stream')
        if body.image:
            messages[-1]['content'] = [{'type': 'text', 'text': body.message},
                {'type': 'image_url', 'image_url': {'url': body.image}}]
        outgoing = client.build_request('POST', settings.gateway + '/chat/completions',
            headers=headers(row) | {'Idempotency-Key': 'studio-' + body.request_id},
            json={'model': body.model, 'messages': messages, 'max_tokens': 2048, 'stream': True,
                  'stream_options': {'include_usage': True}})
        try:
            response = await client.send(outgoing, stream=True)
        except httpx.HTTPError:
            store.fail_call(row['subject'], body.request_id)
            raise HTTPException(502, 'Request outcome is unknown. Check the console before trying again.') from None
        if response.status_code != 200:
            store.fail_call(row['subject'], body.request_id, 'rejected' if response.status_code in (400, 401, 402, 403, 404, 422, 429) else 'unknown')
            status_code = response.status_code if response.status_code in (401, 402, 403, 409, 422, 429) else 502
            await response.aclose()
            raise HTTPException(status_code, 'ServerNet declined the request. Check your balance, access or request status in the console.')

        async def generate():
            content, usage, charge = '', None, None
            complete = False
            try:
                async for line in response.aiter_lines():
                    if not line.startswith('data:'):
                        continue
                    data = line[5:].strip()
                    if data == '[DONE]':
                        if usage is None or not isinstance(charge, int) or isinstance(charge, bool) or charge < 0:
                            raise ValueError('Final billing event missing')
                        result = {'text': content, 'usage': usage, 'charge_irt': charge, 'request_id': body.request_id}
                        store.finish_call(row['subject'], body, content, result)
                        complete = True
                        yield event('done', result)
                        return
                    chunk = json.loads(data)
                    if chunk.get('error'):
                        raise ValueError('Gateway reported an incomplete stream')
                    for choice in chunk.get('choices') or []:
                        text = choice.get('delta', {}).get('content') or ''
                        if isinstance(text, str):
                            content += text
                            if len(content) > 200000:
                                raise ValueError('Response exceeds limit')
                            if text:
                                yield event('delta', {'text': text})
                    if isinstance(chunk.get('usage'), dict):
                        usage = chunk['usage']
                    if 'servernet_charge_irt' in chunk:
                        charge = chunk['servernet_charge_irt']
                raise ValueError('Stream ended before completion')
            except (httpx.HTTPError, ValueError, TypeError, KeyError):
                yield event('error', {'message': 'The request outcome needs review in the console. Do not automatically resend.', 'request_id': body.request_id})
            finally:
                if not complete:
                    store.fail_call(row['subject'], body.request_id)
                await response.aclose()
        return StreamingResponse(generate(), media_type='text/event-stream', headers={'X-Accel-Buffering': 'no'})

    @app.get('/assets/fonts/{name}')
    async def font(name: str):
        allowed = {'IRANSans-Regular.woff2': 'IRANSans-web.woff2', 'IRANSans-Medium.woff2': 'IRANSans-Medium-web.woff2',
                   'IRANSans-Bold.woff2': 'IRANSans-Bold-web.woff2'}
        if name not in allowed or not (settings.fonts / allowed[name]).is_file():
            raise HTTPException(404, 'Font not found.')
        return FileResponse(settings.fonts / allowed[name], media_type='font/woff2')

    @app.get('/legal', response_class=HTMLResponse)
    async def legal():
        from html import escape
        return '<!doctype html><html><head><meta charset="utf-8"><title>ServerNet Studio — Legal</title></head><body><h1>ServerNet Studio</h1><p>Copyright 2026 ServerNet contributors. No warranty.</p><p>Includes components of Unsloth Studio, copyright Unsloth AI Inc. and contributors, licensed under AGPL-3.0-only. Original notices and licenses are retained in the corresponding source.</p><p><a href="' + escape(settings.source_url, quote=True) + '">Corresponding source and license notices</a></p></body></html>'

    if settings.assets.is_dir():
        app.mount('/', StaticFiles(directory=settings.assets, html=True), name='studio')
    return app


def configured_app():
    environment = runtime_environment()
    font_dir = Path(environment.get('SERVERNET_STUDIO_FONTS', '/run/servernet/fonts'))
    if not all((font_dir / name).is_file() for name in ('IRANSans-web.woff2', 'IRANSans-Medium-web.woff2', 'IRANSans-Bold-web.woff2')):
        raise ValueError('Install the ServerNet IRANSans font files before starting the customer app.')
    return create_app(Settings(
        origin=environment['SERVERNET_STUDIO_ORIGIN'], client_secret=environment['SERVERNET_STUDIO_CLIENT_SECRET'],
        encryption_key=environment['SERVERNET_STUDIO_ENCRYPTION_KEY'], database=Path(environment.get('SERVERNET_STUDIO_DB', '/data/studio.db')),
        source_url=environment['SERVERNET_STUDIO_SOURCE_URL'], fonts=font_dir,
        gmail_client_id=environment.get('SERVERNET_STUDIO_GMAIL_CLIENT_ID'),
        gmail_client_secret=environment.get('SERVERNET_STUDIO_GMAIL_CLIENT_SECRET'),
    ))
