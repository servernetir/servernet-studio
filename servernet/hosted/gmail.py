# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026 ServerNet contributors
"""Browser-approved access to Gmail inbox counts for a Studio account."""
from __future__ import annotations

import base64
import hashlib
import re
import secrets
import time
from urllib.parse import urlencode

import httpx
from cryptography.fernet import InvalidToken
from fastapi import HTTPException, Request
from fastapi.responses import RedirectResponse

from .app import digest
from .connectors import MAX_CONNECTORS

SCOPE = 'https://www.googleapis.com/auth/gmail.metadata'
AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth'
TOKEN = 'https://oauth2.googleapis.com/token'
REVOKE = 'https://oauth2.googleapis.com/revoke'
INBOX = 'https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX'
FLOW_TTL = 600
TIMEOUT = 8.0


class GmailConnector:
    def __init__(self, settings, store, client):
        self.store, self.client = store, client
        self.callback = settings.origin + '/auth/connectors/gmail/callback'
        self.oauth = {'client_id': settings.gmail_client_id, 'client_secret': settings.gmail_client_secret}
        with self.store.connect() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS gmail_flows (
                state TEXT PRIMARY KEY, subject TEXT UNIQUE NOT NULL, session TEXT NOT NULL,
                verifier TEXT NOT NULL, expires INTEGER NOT NULL)''')

    def begin(self, row):
        state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
        now = int(time.time())
        with self.store.connect() as db:
            db.execute('DELETE FROM gmail_flows WHERE expires<=? OR subject=?', (now, row['subject']))
            db.execute('INSERT INTO gmail_flows VALUES(?,?,?,?,?)',
                       (digest(state), row['subject'], row['id'], self.store.encrypt(verifier), now + FLOW_TTL))
        return AUTHORIZE + '?' + urlencode({
            'client_id': self.oauth['client_id'], 'redirect_uri': self.callback, 'scope': SCOPE,
            'response_type': 'code', 'state': state, 'code_challenge': challenge, 'code_challenge_method': 'S256',
            'access_type': 'offline', 'prompt': 'consent select_account',
        })

    def consume(self, state, row):
        if not state or not re.fullmatch(r'[A-Za-z0-9_-]{43}', state):
            return None
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            flow = db.execute('SELECT verifier FROM gmail_flows WHERE state=? AND session=? AND subject=? AND expires>?',
                              (digest(state), row['id'], row['subject'], int(time.time()))).fetchone()
            if flow is None:
                return None
            db.execute('DELETE FROM gmail_flows WHERE state=?', (digest(state),))
        return self.store.decrypt(flow['verifier'])

    async def token(self, grant):
        try:
            response = await self.client.post(TOKEN, data=self.oauth | grant, timeout=TIMEOUT, follow_redirects=False)
            response.raise_for_status()
            result = response.json()
            if not isinstance(result, dict) or result.get('token_type', '').lower() != 'bearer':
                raise ValueError
            # Google reports the scope on authorization. A refresh may omit it.
            scope = result.get('scope', SCOPE if grant['grant_type'] == 'refresh_token' else '')
            if not isinstance(scope, str) or set(scope.split()) != {SCOPE}:
                raise ValueError
            access = result['access_token']
            if not isinstance(access, str) or not re.fullmatch(r'[A-Za-z0-9._~+/=-]{1,8192}', access):
                raise ValueError
            return result
        except (httpx.HTTPError, KeyError, AttributeError, ValueError, TypeError):
            raise HTTPException(502, 'Gmail access could not be verified.') from None

    async def unread(self, access_token):
        try:
            response = await self.client.get(INBOX, params={'fields': 'id,messagesUnread'},
                headers={'Authorization': 'Bearer ' + access_token}, timeout=TIMEOUT, follow_redirects=False)
            response.raise_for_status()
            label = response.json()
            unread = label['messagesUnread']
            if label.get('id') != 'INBOX' or type(unread) is not int or unread < 0:
                raise ValueError
            return unread
        except (httpx.HTTPError, KeyError, ValueError, TypeError):
            raise HTTPException(502, 'Gmail inbox count is temporarily unavailable.') from None

    async def revoke_remote(self, refresh_token):
        try:
            response = await self.client.post(REVOKE, data={'token': refresh_token}, timeout=TIMEOUT, follow_redirects=False)
            return response.status_code == 200
        except httpx.HTTPError:
            return False


def install_gmail(app, settings, store, vault, client, authenticated):
    if not settings.gmail_client_id:
        return
    gmail = GmailConnector(settings, store, client)
    vault.available.append('gmail')
    vault.on_revoke['gmail'] = gmail.revoke_remote

    @app.post('/api/connectors/gmail/start')
    async def gmail_start(request: Request):
        row = authenticated(request, True)
        connections = vault.list(row['subject'])
        if len(connections) >= MAX_CONNECTORS:
            raise HTTPException(409, 'Connection limit reached.')
        if any(connection['kind'] == 'gmail' for connection in connections):
            raise HTTPException(409, 'Disconnect the current Gmail account before connecting another.')
        return {'authorization_url': gmail.begin(row)}

    @app.get('/auth/connectors/gmail/callback')
    async def gmail_callback(request: Request):
        row = authenticated(request)
        query = request.query_params
        verifier = gmail.consume(query.get('state'), row)
        if not verifier:
            return RedirectResponse('/?gmail=error#connectors', 303)
        if query.get('error') == 'access_denied':
            return RedirectResponse('/?gmail=denied#connectors', 303)
        code = query.get('code')
        if not code or len(code) > 2048 or query.get('error'):
            return RedirectResponse('/?gmail=error#connectors', 303)
        try:
            token = await gmail.token({'grant_type': 'authorization_code', 'code': code,
                                       'code_verifier': verifier, 'redirect_uri': gmail.callback})
            refresh_token = token.get('refresh_token')
            if not isinstance(refresh_token, str) or not re.fullmatch(r'[A-Za-z0-9._~+/=-]{1,8192}', refresh_token):
                raise HTTPException(502, 'Gmail did not provide a persistent connection.')
            await gmail.unread(token['access_token'])
            authenticated(request)
            vault.add(row['subject'], kind='gmail', name='Gmail', target='gmail.googleapis.com',
                      secret=refresh_token, status='connected')
        except HTTPException:
            return RedirectResponse('/?gmail=error#connectors', 303)
        return RedirectResponse('/?gmail=connected#connectors', 303)

    @app.post('/api/connectors/{identifier}/gmail/inbox')
    async def gmail_inbox(identifier: str, request: Request):
        row = authenticated(request, True)
        connection = vault.reserve_check(row['subject'], identifier, ('gmail',))
        try:
            refresh_token = store.decrypt(connection['secret'])
            token = await gmail.token({'grant_type': 'refresh_token', 'refresh_token': refresh_token})
            unread = await gmail.unread(token['access_token'])
        except InvalidToken:
            vault.finish_check(row['subject'], identifier, 'unreachable')
            raise HTTPException(502, 'Gmail access could not be verified.') from None
        except HTTPException:
            vault.finish_check(row['subject'], identifier, 'unreachable')
            raise
        return {'unread': unread, 'connection': vault.finish_check(row['subject'], identifier, 'connected')}
