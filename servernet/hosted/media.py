# SPDX-License-Identifier: AGPL-3.0-only
"""Owned generation receipts and safe playback for the existing AI Gateway."""
from __future__ import annotations

import base64
import binascii
import json
import os
import re
import shutil
import tempfile
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

MAX_REQUEST = 7_500_000
MAX_RESULT = 64_000_000
MAX_LOCAL_ASSET = 36_000_000
ASSET_TTL = 7 * 86400
CATEGORIES = ('image', 'video', 'audio', 'music', 'classification')
MIME_TYPES = {
    'image/png': ('image', 'png'), 'image/jpeg': ('image', 'jpg'), 'image/webp': ('image', 'webp'),
    'image/gif': ('image', 'gif'), 'video/mp4': ('video', 'mp4'), 'video/webm': ('video', 'webm'),
    'audio/wav': ('audio', 'wav'), 'audio/mpeg': ('audio', 'mp3'), 'audio/ogg': ('audio', 'ogg'),
    'audio/flac': ('audio', 'flac'), 'audio/aac': ('audio', 'aac'),
}
# The browser loads reviewed vendor CDN URLs directly. Studio never fetches an upstream-generated URL.
MEDIA_HOSTS = ('api.deepinfra.com', 'cdn.deepinfra.com', 'deepinfra.com', 'api.gapgpt.app', 'cdn.gapgpt.app')


class NativeInput(BaseModel):
    model: str = Field(min_length=1, max_length=160)
    category: str
    parameters: dict

    def payload(self):
        if self.category not in CATEGORIES or len(self.parameters) > 70:
            raise HTTPException(422, 'Unsupported media operation.')
        denied = {'model','stream','webhook','service_tier','fail_fast','disable_safety_filter',
                  'enable_safety_checker','safety_tolerance','visual_input_content_moderation',
                  'visual_output_content_moderation','prompt_content_moderation'}
        if any(key in denied for key in self.parameters):
            raise HTTPException(422, 'Unsupported media option.')
        return {'model': self.model, **self.parameters}


class NativeJob(NativeInput):
    conversation_id: str = Field(pattern=r'^[a-f0-9]{32}$')
    request_id: str = Field(pattern=r'^[a-f0-9]{32}$')
    label: str = Field(min_length=1, max_length=8000)
    max_hold_irt: int = Field(ge=0, le=2_000_000_000)


async def json_response(client, method, url, headers, payload=None):
    async with client.stream(method, url, headers=headers, json=payload) as response:
        chunks = bytearray()
        async for part in response.aiter_bytes():
            chunks.extend(part)
            if len(chunks) > MAX_RESULT:
                raise ValueError('Gateway response is too large')
        try:
            data = json.loads(chunks)
        except ValueError:
            data = {}
        return response.status_code, response.headers, data if isinstance(data, dict) else {}


def asset_type(data: bytes):
    if data.startswith(b'\x89PNG\r\n\x1a\n'): return 'image/png'
    if data.startswith(b'\xff\xd8\xff'): return 'image/jpeg'
    if data.startswith((b'GIF87a', b'GIF89a')): return 'image/gif'
    if data.startswith(b'RIFF') and data[8:12] == b'WEBP': return 'image/webp'
    if data.startswith(b'RIFF') and data[8:12] == b'WAVE': return 'audio/wav'
    if data[4:8] == b'ftyp': return 'video/mp4'
    if data.startswith(b'\x1a\x45\xdf\xa3'): return 'video/webm'
    if data.startswith(b'OggS'): return 'audio/ogg'
    if data.startswith(b'fLaC'): return 'audio/flac'
    if data.startswith(b'ID3') or data[:2] in (b'\xff\xfb', b'\xff\xf3', b'\xff\xf2'): return 'audio/mpeg'
    if data[:2] in (b'\xff\xf1', b'\xff\xf9'): return 'audio/aac'
    return None


def public_url(value):
    if not isinstance(value, str) or len(value) > 8192 or any(c.isspace() or ord(c) < 32 for c in value):
        return None
    try:
        parsed = urlsplit(value)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.port not in (None, 443) or not re.fullmatch(r'[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+', parsed.hostname)
            or parsed.hostname.rsplit('.', 1)[1].isdigit() or parsed.hostname.endswith(('.local','.internal','.test'))):
            return None
    except ValueError:
        return None
    return parsed


def extracted_values(body):
    keys = ('images','image','image_url','image_urls','data','b64_json','audio','audio_url','video_url','videos',
            'video','mask_url','results','text','transcription','output','result','url','base64','content','parts','inlineData','candidates')
    def visit(value, depth=0):
        if depth > 6:
            return
        if isinstance(value, str):
            yield value
        elif isinstance(value, dict):
            for name in keys:
                if name in value:
                    yield from visit(value[name], depth + 1)
        elif isinstance(value, list):
            for entry in value[:16]:
                yield from visit(entry, depth + 1)
    return visit(body)


class MediaStore:
    def __init__(self, store):
        self.store = store
        self.path = store.path.parent / 'studio-media'
        self.path.mkdir(mode=0o700, exist_ok=True)
        if self.path.is_symlink():
            raise ValueError('Invalid private media storage.')
        with store.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS studio_media_jobs (
                    subject TEXT NOT NULL, id TEXT NOT NULL, conversation TEXT NOT NULL, model TEXT NOT NULL,
                    category TEXT NOT NULL, fingerprint TEXT NOT NULL, state TEXT NOT NULL, message_id INTEGER NOT NULL,
                    data TEXT NOT NULL, updated INTEGER NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(subject,id)
                );
                CREATE INDEX IF NOT EXISTS studio_media_conversation ON studio_media_jobs(subject,conversation);
            ''')

    def get(self, subject, identifier):
        with self.store.connect() as db:
            row = db.execute('SELECT * FROM studio_media_jobs WHERE subject=? AND id=?', (subject, identifier)).fetchone()
        if not row:
            raise HTTPException(404, 'Generation not found.')
        return row

    def messages(self, subject, conversation):
        with self.store.connect() as db:
            rows = db.execute('SELECT role,content,id FROM messages WHERE conversation=? ORDER BY id', (conversation,)).fetchall()
            jobs = {row['message_id']: self.public(row) for row in db.execute(
                'SELECT * FROM studio_media_jobs WHERE subject=? AND conversation=?', (subject, conversation))}
        return [{'role': row['role'], 'content': row['content'], **({'media':jobs[row['id']]} if row['id'] in jobs else {})}
                for row in rows]

    def begin(self, subject, body, fingerprint):
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute('SELECT * FROM studio_media_jobs WHERE subject=? AND id=?', (subject, body.request_id)).fetchone()
            if previous:
                if previous['fingerprint'] != fingerprint:
                    raise HTTPException(422, 'This request identifier belongs to a different generation.')
                return previous, False
            if not db.execute('SELECT 1 FROM conversations WHERE id=? AND subject=?', (body.conversation_id, subject)).fetchone():
                raise HTTPException(404, 'Conversation not found.')
            since = int(time.time())
            recent = db.execute('SELECT COUNT(*) FROM studio_media_jobs WHERE subject=? AND created>=?', (subject, since - 3600)).fetchone()[0]
            if recent >= 25:
                raise HTTPException(429, 'Generation limit reached. Please try later.')
            db.execute('INSERT INTO messages(conversation,role,content) VALUES(?,?,?)', (body.conversation_id, 'user', body.label))
            message = db.execute('INSERT INTO messages(conversation,role,content) VALUES(?,?,?)',
                (body.conversation_id, 'assistant', '')).lastrowid
            db.execute('INSERT INTO studio_media_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)', (subject, body.request_id,
                body.conversation_id, body.model, body.category, fingerprint, 'sending', message, '{}', since, since))
            db.execute("UPDATE conversations SET title=? WHERE id=? AND title='New conversation'", (body.label[:70], body.conversation_id))
            return db.execute('SELECT * FROM studio_media_jobs WHERE subject=? AND id=?', (subject, body.request_id)).fetchone(), True

    def update(self, row, state, data=None):
        with self.store.connect() as db:
            db.execute("""UPDATE studio_media_jobs SET state=?,data=?,updated=? WHERE subject=? AND id=?
                       AND state NOT IN ('ready','failed')""", (state,json.dumps(data or {}, ensure_ascii=False),
                       int(time.time()),row['subject'],row['id']))
        return self.public(self.get(row['subject'], row['id']))

    def asset_path(self, row, index):
        import hashlib
        owner = hashlib.sha256(row['subject'].encode()).hexdigest()
        return self.path / f'{owner}-{row["id"]}-{index}'

    def prune(self):
        deadline = time.time() - ASSET_TTL
        for path in self.path.iterdir():
            if not path.is_symlink() and re.fullmatch(r'[a-f0-9]{64}-[a-f0-9]{32}-[0-7]', path.name):
                try:
                    if path.stat().st_mtime < deadline:
                        path.unlink(missing_ok=True)
                except FileNotFoundError:
                    continue

    def public(self, row):
        data = json.loads(row['data'])
        for index, asset in enumerate(data.get('assets', [])):
            if 'mime' in asset:
                source = '/api/media/' + row['id'] + '/asset/' + str(index)
                asset['url'] = source
                asset['download'] = source + '?download=true'
        return {'id': row['id'], 'category': row['category'], 'model':row['model'],
                'state': row['state'], **data}

    def complete(self, row, body, charge):
        assets, text_outputs = [], []
        seen = set()
        total = 0
        self.prune()
        for value in extracted_values(body):
            if len(assets) >= 8 or value in seen:
                continue
            seen.add(value)
            url = public_url(value)
            if url:
                kind = {'image':'image','video':'video','audio':'audio','music':'audio'}.get(row['category'], 'link')
                assets.append({'kind': kind if url.hostname in MEDIA_HOSTS else 'link', 'url': value})
                continue
            encoded = value.split(',', 1)[1] if re.match(r'^data:(?:image|audio|video)/[^,]+;base64,', value) else value
            if len(encoded) >= 32 and len(encoded) <= MAX_LOCAL_ASSET * 4 // 3 + 8:
                try:
                    binary = base64.b64decode(encoded, validate=True)
                except (ValueError, binascii.Error):
                    binary = b''
                mime = asset_type(binary)
                if mime and total + len(binary) <= MAX_LOCAL_ASSET:
                    total += len(binary)
                    index = len(assets)
                    with tempfile.NamedTemporaryFile(dir=self.path, delete=False) as temp:
                        try:
                            temp.write(binary)
                            temp.flush()
                            os.replace(temp.name, self.asset_path(row, index))
                        finally:
                            Path(temp.name).unlink(missing_ok=True)
                    assets.append({'kind': MIME_TYPES[mime][0], 'mime':mime})
                    continue
            if len(value) <= 16000 and not value.startswith(('https:', 'http:', 'data:')) and len(text_outputs) < 5:
                text_outputs.append(value)
        return self.update(row, 'ready', {'assets': assets, 'text': '\n\n'.join(text_outputs),
                                          'charge_irt': charge, 'expired_at': int(time.time()) + ASSET_TTL})

    def file(self, row, index, download):
        assets = json.loads(row['data']).get('assets', [])
        if not 0 <= index < len(assets) or assets[index].get('mime') not in MIME_TYPES:
            raise HTTPException(404, 'Output not found.')
        path = self.asset_path(row, index)
        if path.is_symlink() or not path.is_file() or path.stat().st_mtime < time.time() - ASSET_TTL:
            raise HTTPException(404, 'Output expired.')
        mime = assets[index]['mime']
        return FileResponse(path, media_type=mime, filename='studio-output.'+MIME_TYPES[mime][1],
                            content_disposition_type='attachment' if download else 'inline')


def install_media(app, settings, store, media, client, authenticated, headers):
    from .app import digest
    known_rejections = {400, 401, 402, 403, 404, 413, 422, 429}

    def charge(header, data):
        raw = header.get('x-servernet-charge-irt', data.get('charge_irt'))
        return int(raw) if raw is not None and re.fullmatch(r'\d{1,12}', str(raw)) else None

    def error_code(data):
        value = data.get('code')
        return value if isinstance(value, str) and re.fullmatch(r'[a-z_]{1,60}', value) else None

    @app.post('/api/media/quote')
    async def quote(body: NativeInput, request: Request):
        row = authenticated(request, True)
        try:
            status, _, data = await json_response(client, 'POST', settings.gateway+'/studio/media/quote', headers(row), body.payload())
        except (httpx.HTTPError, ValueError):
            raise HTTPException(502, 'Price temporarily unavailable.') from None
        amount = data.get('max_hold_irt')
        if status != 200 or type(amount) is not int or not 0 <= amount <= 2_000_000_000:
            return JSONResponse({'code': error_code(data) or 'quote_unavailable', 'detail': 'Review the model inputs and access.'},
                                status if status in known_rejections else 502)
        return {'max_hold_irt': amount}

    @app.post('/api/media')
    async def start(body: NativeJob, request: Request):
        owner = authenticated(request, True)
        payload = body.payload()
        media.prune()
        if shutil.disk_usage(media.path).free < 256_000_000:
            raise HTTPException(503, 'Media storage is temporarily unavailable.')
        row, new = media.begin(owner['subject'], body, digest(json.dumps(body.model_dump(), sort_keys=True)))
        if not new:
            return media.public(row)
        try:
            status, header, data = await json_response(client, 'POST', settings.gateway+'/inference',
                headers(owner) | {'Idempotency-Key':'studio-media-'+body.request_id, 'X-ServerNet-Max-Hold-Irt':str(body.max_hold_irt)}, payload)
        except (httpx.HTTPError, ValueError):
            return media.update(row, 'unknown')
        if status == 202:
            return media.update(row, 'processing')
        if status == 200:
            return media.complete(row, data, charge(header, data))
        code = error_code(data)
        return media.update(row, 'failed' if status in known_rejections or code == 'quote_changed' else 'unknown', {'code':code})

    @app.get('/api/media/{identifier}')
    async def status(identifier: str, request: Request):
        owner = authenticated(request)
        row = media.get(owner['subject'], identifier)
        if row['state'] in ('ready', 'failed'):
            return media.public(row)
        # Avoid competing with the original submission and never issue a second paid POST.
        if row['state'] == 'sending' and time.time() - row['updated'] < 90:
            return media.public(row)
        try:
            code, header, data = await json_response(client,'GET',settings.gateway+'/studio/media/'+identifier,headers(owner))
        except (httpx.HTTPError, ValueError):
            return media.public(row)
        if code == 200:
            return media.complete(row, data, charge(header, data))
        if code == 202:
            return media.update(row, 'processing')
        if code == 409:
            return media.update(row, 'failed' if data.get('status') == 'failed' else 'unknown',
                {'code':error_code(data), 'charge_irt':charge(header, data)})
        return media.public(row)

    @app.get('/api/media/{identifier}/asset/{index}')
    async def asset(identifier: str, index: int, request: Request, download: bool = False):
        row = media.get(authenticated(request)['subject'], identifier)
        return media.file(row, index, download)
