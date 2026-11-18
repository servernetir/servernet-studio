# SPDX-License-Identifier: AGPL-3.0-only
import asyncio
import ipaddress
import socket
from types import SimpleNamespace

import asyncssh
import pytest

from servernet.hosted import connectors
from test_hosted import login, setup


TOKEN = {
    'kind': 'https_token', 'name': 'Production health', 'target': 'https://status.example.com',
    'secret': 'fixture-connector-token',
}


def test_connection_credentials_are_encrypted_and_owned_by_account(setup, monkeypatch):
    app, browser, calls, _, settings = setup
    assert browser.get('/api/connectors').status_code == 401
    owner = login(setup)
    assert browser.post('/api/connectors', json=TOKEN).status_code == 403
    created = browser.post('/api/connectors', json=TOKEN, headers=owner)
    assert created.status_code == 201
    item = created.json()
    path = '/api/connectors/' + item['id']
    assert item['status'] == 'saved'
    assert item['last_checked_at'] is None
    assert TOKEN['secret'] not in created.text
    with app.state.store.connect() as db:
        row = db.execute('SELECT secret FROM connectors').fetchone()
    assert row['secret'] != TOKEN['secret']
    assert app.state.store.decrypt(row['secret']) == TOKEN['secret']
    assert TOKEN['secret'].encode() not in settings.database.read_bytes()

    stranger = login(setup, 'customer-2')
    assert browser.get('/api/connectors').json() == {'available': ['ssh', 'https_token'], 'data': []}
    assert browser.post(path + '/check', headers=stranger).status_code == 404
    assert browser.delete(path, headers=stranger).status_code == 404

    attempts = []

    async def check(row, secret, tls_context, is_saved):
        assert is_saved()
        attempts.append((row['target'], secret, tls_context.check_hostname))
        return True

    monkeypatch.setattr(connectors, 'check_https', check)
    owner = login(setup)
    assert browser.get('/api/connectors').json()['data'] == [item]
    assert browser.post(path + '/check').status_code == 403
    result = browser.post(path + '/check', headers=owner)
    assert result.json()['status'] == 'connected'
    assert result.json()['last_checked_at'] >= item['created_at']
    assert browser.post(path + '/check', headers=owner).status_code == 429
    assert attempts == [(TOKEN['target'], TOKEN['secret'], True)]
    assert browser.delete(path).status_code == 403
    assert browser.delete(path, headers=owner).json() == {'ok': True}
    assert browser.get('/api/connectors').json()['data'] == []
    assert browser.post(path + '/check', headers=owner).status_code == 404
    assert not calls


@pytest.mark.parametrize('target', [
    'http://example.com', 'https://localhost', 'https://127.0.0.1',
    'https://169.254.169.254', 'https://[::ffff:169.254.169.254]',
    'https://[64:ff9b::a9fe:a9fe]', 'https://user@example.com',
    'https://example.com:8443', 'https://example.com/private', 'https://example.com/?key=unused',
])
def test_invalid_connection_targets_do_not_leak_tokens(setup, target):
    response = setup[1].post('/api/connectors', json=TOKEN | {'target': target}, headers=login(setup))
    assert response.status_code == 422
    assert TOKEN['secret'] not in response.text
    assert not setup[2]


def test_invalid_ssh_key_and_unknown_fields_do_not_leak_credentials(setup):
    headers = login(setup)
    browser = setup[1]
    invalid_ssh = {
        'kind': 'ssh', 'name': 'Invalid key', 'target': 'example.com', 'username': 'studio',
        'port': 22, 'host_key_sha256': 'SHA256:' + 'a'*43, 'secret': 'unusable-private-key',
    }
    for payload in (invalid_ssh, TOKEN | {'owner': 'customer-2'}, TOKEN | {'secret': TOKEN['secret'] + '\r\n extra header'}):
        result = browser.post('/api/connectors', json=payload, headers=headers)
        assert result.status_code == 422
        assert payload['secret'] not in result.text


def test_private_dns_answers_are_rejected_and_public_address_is_pinned(monkeypatch):
    async def exercise():
        loop = asyncio.get_running_loop()
        answers = ['93.184.216.34', '169.254.169.254']
        attempts = []

        async def resolve(host, port, **_kwargs):
            assert host == 'health.example.com.'
            return [(socket.AF_INET, socket.SOCK_STREAM, 0, '', (address, port)) for address in answers]

        async def connect(_sock, address):
            attempts.append(address)

        monkeypatch.setattr(loop, 'getaddrinfo', resolve)
        monkeypatch.setattr(loop, 'sock_connect', connect)
        with pytest.raises(ValueError):
            await connectors.resolve_public_address('health.example.com', 443)
        assert not attempts
        answers.pop()
        address = await connectors.resolve_public_address('health.example.com', 443)
        with await connectors.connect_public_address(address, 443):
            assert attempts == [('93.184.216.34', 443)]

    asyncio.run(exercise())


def test_ssh_uses_pinned_host_key_before_public_key_auth_and_opens_no_channel(monkeypatch):
    host_key = asyncssh.generate_private_key('ssh-ed25519')
    client_key = asyncssh.generate_private_key('ssh-ed25519')
    other_key = asyncssh.generate_private_key('ssh-ed25519')
    checks = []
    require_auth = True

    class TestSSHServer(asyncssh.SSHServer):
        def begin_auth(self, username):
            return require_auth

        def public_key_auth_supported(self):
            return True

        def validate_public_key(self, username, key):
            checks.append((username, key.get_fingerprint()))
            return key == client_key.convert_to_public()

        def session_requested(self):
            pytest.fail('The connector opened an SSH channel.')

    async def exercise():
        nonlocal require_auth
        async with asyncssh.create_server(TestSSHServer, '127.0.0.1', 0, server_host_keys=[host_key]) as server:
            public_address = ipaddress.ip_address('93.184.216.34')

            async def resolve(host, port):
                assert (host, port) == ('example.com', 22)
                return public_address

            async def sandbox_socket(address, port):
                assert (address, port) == (public_address, 22)
                sock = socket.socket()
                sock.setblocking(False)
                await asyncio.get_running_loop().sock_connect(sock, ('127.0.0.1', server.get_port()))
                return sock

            monkeypatch.setattr(connectors, 'resolve_public_address', resolve)
            monkeypatch.setattr(connectors, 'connect_public_address', sandbox_socket)
            connection = connectors.ConnectorInput(
                kind='ssh', name='Test Linux', target='example.com', port=22, username='studio',
                host_key_sha256=host_key.get_fingerprint(), secret=client_key.export_private_key().decode(),
            ).values()
            def saved():
                return True

            with pytest.raises(asyncssh.HostKeyNotVerifiable):
                wrong_pin = connection['secret'].replace(host_key.get_fingerprint(), other_key.get_fingerprint())
                await connectors.check_ssh(connection, wrong_pin, saved)
            assert not checks
            with pytest.raises(asyncssh.PermissionDenied):
                await connectors.check_ssh(connection, connection['secret'], lambda: False)
            assert not checks
            assert await connectors.check_ssh(connection, connection['secret'], saved)
            assert checks and set(checks) == {('studio', client_key.get_fingerprint())}
            checks.clear()
            require_auth = False
            assert not await connectors.check_ssh(connection, connection['secret'], saved)
            assert not checks

    asyncio.run(exercise())


@pytest.mark.parametrize('statuses,still_saved,result,with_bearer', [
    ([200], [], False, False), ([302], [], False, False),
    ([401, 401], [True, True], False, True), ([401, 302], [True, True], False, True),
    ([403, 204], [True, True], True, True), ([401, 204], [True, False], False, False),
])
def test_https_verifies_token_with_anonymous_control_and_pinned_tls(monkeypatch, statuses, still_saved, result, with_bearer):
    captured, resolutions, connections = [], [], []
    address = ipaddress.ip_address('93.184.216.34')
    statuses_iter = iter(statuses)
    owners = iter(still_saved)

    async def drain():
        pass

    async def resolve(host, port):
        assert (host, port) == ('status.example.com', 443)
        resolutions.append(host)
        return address

    async def pinned(ip, port):
        connections.append((ip, port))
        return socket.socket()

    async def open_connection(**options):
        assert options['server_hostname'] == 'status.example.com'
        assert options['ssl'].check_hostname
        reader = asyncio.StreamReader()
        status = next(statuses_iter)
        reader.feed_data(f'HTTP/1.1 {status} Test\r\nLocation: http://169.254.169.254\r\n\r\n'.encode())
        writer = SimpleNamespace(write=captured.append, close=options['sock'].close, drain=drain)
        return reader, writer

    monkeypatch.setattr(connectors, 'resolve_public_address', resolve)
    monkeypatch.setattr(connectors, 'connect_public_address', pinned)
    monkeypatch.setattr(connectors.asyncio, 'open_connection', open_connection)
    observed = asyncio.run(connectors.check_https(TOKEN, TOKEN['secret'], connectors.ssl.create_default_context(),
                                                  lambda: next(owners)))
    assert observed is result
    assert resolutions == ['status.example.com']
    assert connections == [(address, 443)] * len(statuses)
    assert captured[0] == b'GET /healthz HTTP/1.1\r\nHost: status.example.com\r\nConnection: close\r\n\r\n'
    assert len(captured) == (2 if with_bearer else 1)
    if with_bearer:
        assert captured[1] == (b'GET /healthz HTTP/1.1\r\nHost: status.example.com\r\n'
                               b'Authorization: Bearer fixture-connector-token\r\nConnection: close\r\n\r\n')
