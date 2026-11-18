# SPDX-License-Identifier: AGPL-3.0-only
import asyncio
import base64
import hashlib
from dataclasses import replace
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from servernet.hosted.app import Settings, create_app
from servernet.hosted.gmail import SCOPE


@pytest.fixture
def gmail(tmp_path):
    settings = Settings(origin='https://studio.servernet.test', client_secret='s' * 32,
        encryption_key=Fernet.generate_key().decode(), database=tmp_path / 'studio.db',
        source_url='https://github.com/servernetir/servernet-studio', testing=True,
        gmail_client_id='fixture.apps.googleusercontent.com', gmail_client_secret='fixture-oauth-secret')
    calls = []
    mode = {'scope': SCOPE, 'revoke_status': 200}

    def google(request):
        calls.append(request)
        if str(request.url) == 'https://oauth2.googleapis.com/token':
            form = parse_qs(request.content.decode())
            assert form['client_id'] == [settings.gmail_client_id]
            assert form['client_secret'] == [settings.gmail_client_secret]
            result = {'access_token': 'fixture-access-token', 'token_type': 'Bearer'}
            if form['grant_type'] == ['authorization_code']:
                assert form['code'] == ['fixture-code']
                assert form['redirect_uri'] == [settings.origin + '/auth/connectors/gmail/callback']
                result.update({'scope': mode['scope'], 'refresh_token': 'fixture-refresh-token'})
            else:
                assert form['grant_type'] == ['refresh_token']
                assert form['refresh_token'] == ['fixture-refresh-token']
            return httpx.Response(200, json=result)
        if str(request.url) == 'https://oauth2.googleapis.com/revoke':
            assert parse_qs(request.content.decode()) == {'token': ['fixture-refresh-token']}
            return httpx.Response(mode['revoke_status'])
        assert request.url.host == 'gmail.googleapis.com' and request.method == 'GET'
        assert request.url.path == '/gmail/v1/users/me/labels/INBOX'
        assert request.url.params == httpx.QueryParams({'fields': 'id,messagesUnread'})
        assert request.headers['authorization'] == 'Bearer fixture-access-token'
        return httpx.Response(200, json={'id': 'INBOX', 'messagesUnread': 7, 'name': 'private-label-name'})

    outbound = httpx.AsyncClient(transport=httpx.MockTransport(google))
    app = create_app(settings, outbound)
    with TestClient(app, base_url=settings.origin, follow_redirects=False) as client:
        yield client, app, settings, calls, mode
    asyncio.run(outbound.aclose())


def sign_in(gmail, subject='customer-one'):
    client, app, settings, *_ = gmail
    cookie, _ = app.state.store.create_session({'access_token': 'fixture-servernet-key', 'expires_in': 3600,
        'customer': {'id': subject, 'name': 'Fixture customer'}})
    client.cookies.set(settings.cookie, cookie)
    return cookie, {'Origin': settings.origin, 'X-CSRF-Token': client.get('/api/session').json()['csrf']}


def consent_query(client, headers):
    response = client.post('/api/connectors/gmail/start', headers=headers)
    assert response.status_code == 200
    target = urlsplit(response.json()['authorization_url'])
    assert (target.scheme, target.netloc, target.path) == ('https', 'accounts.google.com', '/o/oauth2/v2/auth')
    return parse_qs(target.query)


def callback(client, query, **parameters):
    return client.get('/auth/connectors/gmail/callback', params={'state': query['state'][0], **parameters})


def test_gmail_consent_is_csrf_protected_and_bound_to_exact_session(gmail):
    client, _, settings, calls, _ = gmail
    assert client.post('/api/connectors/gmail/start').status_code == 401
    first_cookie, headers = sign_in(gmail)
    assert client.post('/api/connectors/gmail/start', headers=headers | {'Origin': 'https://other.test'}).status_code == 403
    assert client.post('/api/connectors/gmail/start', headers={'Origin': settings.origin}).status_code == 403
    query = consent_query(client, headers)
    assert query['scope'] == [SCOPE]
    assert query['access_type'] == ['offline'] and query['code_challenge_method'] == ['S256']
    sign_in(gmail)
    assert callback(client, query, code='fixture-code').headers['location'] == '/?gmail=error#connectors'
    assert calls == []
    client.cookies.set(settings.cookie, first_cookie)
    result = callback(client, query, code='fixture-code')
    assert result.headers['location'] == '/?gmail=connected#connectors'
    assert result.headers['referrer-policy'] == 'no-referrer'
    verifier = parse_qs(calls[0].content.decode())['code_verifier'][0]
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    assert query['code_challenge'] == [challenge]
    assert callback(client, query, code='fixture-code').headers['location'] == '/?gmail=error#connectors'
    assert len(calls) == 2


def test_gmail_persists_across_sessions_and_owner_controls_read_and_revoke(gmail):
    client, app, settings, calls, _ = gmail
    _, headers = sign_in(gmail)
    query = consent_query(client, headers)
    assert callback(client, query, code='fixture-code').headers['location'] == '/?gmail=connected#connectors'
    listing = client.get('/api/connectors').json()
    assert 'gmail' in listing['available']
    assert len(listing['data']) == 1
    connector = listing['data'][0]
    assert (connector['kind'], connector['status']) == ('gmail', 'connected')
    assert 'secret' not in connector
    assert 'fixture-refresh-token' not in repr(listing)
    with app.state.store.connect() as db:
        row = db.execute('SELECT secret FROM connectors WHERE id=?', (connector['id'],)).fetchone()
    assert row['secret'] != 'fixture-refresh-token'
    assert app.state.store.decrypt(row['secret']) == 'fixture-refresh-token'
    check_path = f"/api/connectors/{connector['id']}/gmail/inbox"
    delete_path = f"/api/connectors/{connector['id']}"
    _, outsider = sign_in(gmail, 'customer-two')
    assert client.get('/api/connectors').json()['data'] == []
    assert client.post(check_path, headers=outsider).status_code == 404
    assert client.delete(delete_path, headers=outsider).status_code == 404
    assert len(calls) == 2
    _, owner = sign_in(gmail)
    assert client.post('/api/connectors/gmail/start', headers=owner).status_code == 409
    response = client.post(check_path, headers=owner).json()
    assert response['unread'] == 7 and response['connection']['id'] == connector['id']
    assert 'private-label-name' not in repr(response)
    assert client.delete(delete_path, headers=owner).json() == {'ok': True, 'provider_revoked': True}
    assert client.post(check_path, headers=owner).status_code == 404
    assert client.get('/api/connectors').json()['data'] == []


def test_gmail_denied_or_wider_scopes_do_not_create_connections(gmail):
    client, _, _, calls, mode = gmail
    _, headers = sign_in(gmail)
    query = consent_query(client, headers)
    assert callback(client, query, error='access_denied').headers['location'] == '/?gmail=denied#connectors'
    assert callback(client, query, code='fixture-code').headers['location'] == '/?gmail=error#connectors'
    assert not calls
    mode['scope'] = SCOPE + ' https://www.googleapis.com/auth/gmail.modify'
    query = consent_query(client, headers)
    assert callback(client, query, code='fixture-code').headers['location'] == '/?gmail=error#connectors'
    assert len(calls) == 1
    assert client.get('/api/connectors').json()['data'] == []


def test_gmail_requires_both_private_settings(gmail):
    _, _, settings, _, _ = gmail
    with pytest.raises(ValueError, match='both Gmail OAuth client fields'):
        replace(settings, gmail_client_secret=None)


def test_gmail_can_connect_after_more_than_a_page_of_server_connections(gmail):
    client, _, _, calls, _ = gmail
    _, headers = sign_in(gmail)
    connector = {'kind': 'https_token', 'target': 'https://example.com', 'secret': 'fixture-token'}
    for index in range(35):
        assert client.post('/api/connectors', headers=headers, json=connector | {'name': f'Fixture {index}'}).status_code == 201
    response = client.post('/api/connectors/gmail/start', headers=headers)
    assert response.status_code == 200 and 'authorization_url' in response.json()
    assert not calls
