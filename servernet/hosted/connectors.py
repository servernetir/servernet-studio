# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026 ServerNet contributors
"""Customer-owned credentials and explicit, narrowly scoped connection checks."""
from __future__ import annotations

import asyncio
import ipaddress
import json
import re
import secrets
import socket
import ssl
import time
import uuid
from typing import Literal
from urllib.parse import urlsplit

import asyncssh
from cryptography.fernet import InvalidToken
from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, SecretStr

PUBLIC_FIELDS = 'id,kind,name,target,port,username,status,created_at,last_checked_at'
NETWORK_KINDS = ('ssh', 'https_token')
MAX_CONNECTORS = 12
CHECK_INTERVAL = 20
CHECK_TIMEOUT = 8
LABEL = r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
BEARER = re.compile(r'[A-Za-z0-9._~+/=-]{8,4096}')
STATUS_LINE = re.compile(rb'HTTP/1\.[01] ([0-9]{3})(?: [^\r\n]*)?\r\n')
HOST_KEY_ALGORITHMS = (
    'ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384',
    'ecdsa-sha2-nistp521', 'rsa-sha2-512', 'rsa-sha2-256',
)
IPV6_TRANSITION_NETWORKS = tuple(map(ipaddress.IPv6Network, ('64:ff9b::/96', '64:ff9b:1::/48', '2001::/32', '2002::/16')))


class ConnectorInput(BaseModel):
    model_config = ConfigDict(extra='forbid')

    kind: Literal['ssh', 'https_token']
    name: str = Field(min_length=1, max_length=80)
    target: str = Field(min_length=1, max_length=260)
    secret: SecretStr = Field(min_length=8, max_length=16000)
    port: Literal[22] | None = None
    username: str | None = Field(default=None, pattern=r'^[A-Za-z0-9_.-]{1,64}$')
    host_key_sha256: str | None = Field(default=None, pattern=r'^SHA256:[A-Za-z0-9+/]{43}$')

    def values(self):
        name = self.name.strip()
        secret = self.secret.get_secret_value().strip()
        if not name or any(ord(char) < 32 or ord(char) == 127 for char in name):
            raise ValueError
        if self.kind == 'ssh':
            if not self.username or not self.host_key_sha256:
                raise ValueError
            asyncssh.import_private_key(secret)
            return dict(kind=self.kind, name=name, target=public_host(self.target), port=22,
                        username=self.username, secret=json.dumps({'key': secret, 'fingerprint': self.host_key_sha256}))
        if self.username is not None or self.host_key_sha256 is not None or self.port is not None or not BEARER.fullmatch(secret):
            raise ValueError
        parsed = urlsplit(self.target)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username is not None
                or parsed.port not in (None, 443) or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
            raise ValueError
        host = public_host(parsed.hostname)
        authority = f'[{host}]' if ':' in host else host
        return dict(kind=self.kind, name=name, target=f'https://{authority}', secret=secret)


class ConnectorStore:
    def __init__(self, store):
        self.store = store
        self.available = list(NETWORK_KINDS)
        self.on_revoke = {}
        with store.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS connectors(
                    id TEXT PRIMARY KEY, subject TEXT NOT NULL, kind TEXT NOT NULL,
                    name TEXT NOT NULL, target TEXT NOT NULL, port INTEGER, username TEXT,
                    secret TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL,
                    last_checked_at INTEGER);
                CREATE INDEX IF NOT EXISTS connectors_owner ON connectors(subject, created_at);
                CREATE TABLE IF NOT EXISTS connector_checks(subject TEXT PRIMARY KEY, started_at INTEGER NOT NULL);
            ''')

    def list(self, subject):
        with self.store.connect() as db:
            return [dict(row) for row in db.execute(
                f'SELECT {PUBLIC_FIELDS} FROM connectors WHERE subject=? ORDER BY created_at DESC, rowid DESC',
                (subject,))]

    def add(self, subject, *, kind, name, target, secret, port=None, username=None, status='saved'):
        row = dict(id=uuid.uuid4().hex, kind=kind, name=name, target=target, port=port, username=username,
                   status=status, created_at=int(time.time()), last_checked_at=None)
        encrypted = self.store.encrypt(secret)
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if kind == 'gmail' and db.execute(
                    'SELECT 1 FROM connectors WHERE subject=? AND kind=?', (subject, kind)).fetchone():
                raise HTTPException(409, 'A Gmail connection already exists.')
            if db.execute('SELECT COUNT(*) FROM connectors WHERE subject=?', (subject,)).fetchone()[0] >= MAX_CONNECTORS:
                raise HTTPException(409, 'Connection limit reached.')
            db.execute(f'''INSERT INTO connectors(subject,secret,{PUBLIC_FIELDS})
                           VALUES (:subject,:secret,:id,:kind,:name,:target,:port,:username,
                                   :status,:created_at,:last_checked_at)''', dict(row, subject=subject, secret=encrypted))
        return row

    def get(self, subject, identifier):
        with self.store.connect() as db:
            row = db.execute('SELECT * FROM connectors WHERE id=? AND subject=?', (identifier, subject)).fetchone()
        if row is None:
            raise HTTPException(404, 'Connection not found.')
        return row

    def is_saved(self, subject, identifier):
        with self.store.connect() as db:
            return db.execute('SELECT 1 FROM connectors WHERE id=? AND subject=?',
                              (identifier, subject)).fetchone() is not None

    def reserve_check(self, subject, identifier, kinds):
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM connectors WHERE id=? AND subject=?', (identifier, subject)).fetchone()
            if row is None:
                raise HTTPException(404, 'Connection not found.')
            if row['kind'] not in kinds:
                raise HTTPException(422, 'This connection does not support this check.')
            now = int(time.time())
            previous = db.execute('SELECT started_at FROM connector_checks WHERE subject=?', (subject,)).fetchone()
            if previous and now - previous['started_at'] < CHECK_INTERVAL:
                raise HTTPException(429, 'Wait before checking another connection.',
                                    headers={'Retry-After': str(CHECK_INTERVAL - (now - previous['started_at']))})
            db.execute('INSERT OR REPLACE INTO connector_checks VALUES(?,?)', (subject, now))
        return row

    def finish_check(self, subject, identifier, status):
        with self.store.connect() as db:
            db.execute('UPDATE connectors SET status=?, last_checked_at=? WHERE id=? AND subject=?',
                       (status, int(time.time()), identifier, subject))
            row = db.execute(f'SELECT {PUBLIC_FIELDS} FROM connectors WHERE id=? AND subject=?',
                             (identifier, subject)).fetchone()
        if row is None:
            raise HTTPException(404, 'Connection not found.')
        return dict(row)

    def revoke(self, subject, identifier):
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT kind,secret FROM connectors WHERE id=? AND subject=?', (identifier, subject)).fetchone()
            if row is None:
                raise HTTPException(404, 'Connection not found.')
            db.execute('DELETE FROM connectors WHERE id=? AND subject=?', (identifier, subject))
        return row


def require_public(address):
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped or address.is_site_local or any(address in network for network in IPV6_TRANSITION_NETWORKS):
            raise ValueError
    if not address.is_global or address.is_multicast or address.is_reserved:
        raise ValueError
    return address


def public_host(value):
    value = value.strip().lower().rstrip('.')
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        host = value.encode('idna').decode('ascii')
        if not re.fullmatch(rf'{LABEL}(?:\.{LABEL})+', host) or host.rsplit('.', 1)[-1].isdigit():
            raise ValueError from None
        return host
    if '%' in value:
        raise ValueError
    return str(require_public(address))


async def resolve_public_address(host, port):
    loop = asyncio.get_running_loop()
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        records = await loop.getaddrinfo(host + '.', port, type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP)
        # Validate every result and pin the selected IP. The protocol client never resolves the name again.
        addresses = [require_public(ipaddress.ip_address(record[4][0])) for record in records]
        if not addresses:
            raise ValueError
        address = next((item for item in addresses if item.version == 4), addresses[0])
    return require_public(address)


async def connect_public_address(address, port):
    loop = asyncio.get_running_loop()
    require_public(address)
    family = socket.AF_INET if address.version == 4 else socket.AF_INET6
    sock = socket.socket(family, socket.SOCK_STREAM)
    sock.setblocking(False)
    try:
        await loop.sock_connect(sock, (str(address), port))
    except BaseException:
        sock.close()
        raise
    return sock


class PinnedSSHClient(asyncssh.SSHClient):
    def __init__(self, fingerprint, key, is_saved):
        self.fingerprint = fingerprint
        self.key = key
        self.is_saved = is_saved
        self.offered_key = False

    def validate_host_public_key(self, host, addr, port, key):
        return secrets.compare_digest(key.get_fingerprint('sha256'), self.fingerprint)

    def public_key_auth_requested(self):
        if self.offered_key or not self.is_saved():
            return None
        self.offered_key = True
        return [self.key]


async def check_ssh(row, secret, is_saved):
    credentials = json.loads(secret)
    key = asyncssh.import_private_key(credentials['key'])
    client = PinnedSSHClient(credentials['fingerprint'], key, is_saved)
    address = await resolve_public_address(row['target'], row['port'])
    with await connect_public_address(address, row['port']) as sock:
        async with asyncssh.connect(
                row['target'], port=row['port'], sock=sock, config=None,
                username=row['username'], client_keys=[], client_certs=[], agent_path=None,
                agent_identities=[], pkcs11_provider=None, preferred_auth='publickey',
                public_key_auth=True, password_auth=False, kbdint_auth=False, host_based_auth=False,
                known_hosts=((), (), ()), client_factory=lambda: client,
                server_host_key_algs=HOST_KEY_ALGORITHMS, x509_trusted_certs=None,
                gss_kex=False, gss_auth=False, compression_algs=None):
            # Completing key authentication is the entire check. Never open an SSH channel.
            return client.offered_key


async def health_status(target, address, tls_context, is_saved, secret=None):
    sock = await connect_public_address(address, 443)
    try:
        reader, writer = await asyncio.open_connection(
            sock=sock, ssl=tls_context, server_hostname=target.hostname, ssl_shutdown_timeout=1, limit=1024)
    except BaseException:
        sock.close()
        raise
    try:
        if secret is not None and not is_saved():
            return 0
        authorization = f'Authorization: Bearer {secret}\r\n' if secret is not None else ''
        writer.write(f'GET /healthz HTTP/1.1\r\nHost: {target.netloc}\r\n{authorization}'
                     'Connection: close\r\n\r\n'.encode('ascii'))
        await writer.drain()
        match = STATUS_LINE.fullmatch(await reader.readline())
        return int(match[1]) if match else 0
    finally:
        writer.close()


async def check_https(row, secret, tls_context, is_saved):
    target = urlsplit(row['target'])
    address = await resolve_public_address(target.hostname, 443)
    anonymous = await health_status(target, address, tls_context, is_saved)
    if anonymous not in (401, 403) or not is_saved():
        return False
    authenticated = await health_status(target, address, tls_context, is_saved, secret)
    return 200 <= authenticated < 300


def install_connectors(app, store, authenticated):
    vault = ConnectorStore(store)
    slots = asyncio.Semaphore(4)
    tls_context = ssl.create_default_context()

    @app.get('/api/connectors')
    async def connectors(request: Request):
        subject = authenticated(request)['subject']
        return {'available': vault.available, 'data': vault.list(subject)}

    @app.post('/api/connectors', status_code=201)
    async def add_connector(request: Request):
        subject = authenticated(request, True)['subject']
        try:
            values = ConnectorInput.model_validate(await request.json()).values()
        except (ValueError, RecursionError):
            # Never echo Pydantic's raw input or key parser diagnostics to a client or a logger.
            raise HTTPException(422, 'Check the connection details and credentials.') from None
        return vault.add(subject, **values)

    @app.post('/api/connectors/{identifier}/check')
    async def check_connector(identifier: str, request: Request):
        subject = authenticated(request, True)['subject']
        if slots.locked():
            raise HTTPException(429, 'Connection checks are busy. Try again shortly.')
        row = vault.reserve_check(subject, identifier, NETWORK_KINDS)

        def is_saved():
            return vault.is_saved(subject, identifier)

        async with slots:
            try:
                async with asyncio.timeout(CHECK_TIMEOUT):
                    secret = store.decrypt(row['secret'])
                    if row['kind'] == 'ssh':
                        connected = await check_ssh(row, secret, is_saved)
                    else:
                        connected = await check_https(row, secret, tls_context, is_saved)
            except (ValueError, InvalidToken, OSError, asyncssh.Error):
                connected = False
        return vault.finish_check(subject, identifier, 'connected' if connected else 'unreachable')

    @app.delete('/api/connectors/{identifier}')
    async def delete_connector(identifier: str, request: Request):
        subject = authenticated(request, True)['subject']
        row = vault.revoke(subject, identifier)
        callback = vault.on_revoke.get(row['kind'])
        if callback is None:
            return {'ok': True, 'provider_revoked': False} if row['kind'] == 'gmail' else {'ok': True}
        try:
            provider_revoked = await callback(store.decrypt(row['secret']))
        except InvalidToken:
            provider_revoked = False
        return {'ok': True, 'provider_revoked': provider_revoked}

    return vault
