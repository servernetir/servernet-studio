# SPDX-License-Identifier: AGPL-3.0-only
import base64
import hashlib
import re
import secrets
from urllib.parse import parse_qs, urlsplit

import pytest
from test_hosted import setup


def transaction(setup, lang='fa', method='google'):
    verifier = secrets.token_urlsafe(32)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    response = setup[1].post('/auth/desktop/start', json={'challenge': challenge, 'lang': lang, 'method': method})
    assert response.status_code == 200
    data = response.json()
    data['verifier'] = verifier
    assert data['user_code'] not in data['browser_url']
    return data


def form(setup, data):
    response = setup[1].get(data['browser_url'])
    assert response.status_code == 200
    csrf = re.search(r'name="csrf" value="([A-Za-z0-9_-]+)"', response.text)[1]
    return {'request_id': data['request_id'], 'code': data['user_code'], 'csrf': csrf, 'method': 'google'}


def approve(setup, data, body=None):
    body = body or form(setup, data)
    return setup[1].post('/auth/desktop', data=body, headers={'Origin': setup[4].origin})


def poll(setup, data, **override):
    return setup[1].post('/auth/desktop/poll', json={'request_id': data['request_id'], 'verifier': data['verifier']} | override)


@pytest.mark.parametrize('lang,prefix', [('fa', ''), ('en', 'en/'), ('tr', 'tr/')])
def test_desktop_login_uses_external_console_approval_and_claim_once(setup, lang, prefix):
    app, browser, calls, _, settings = setup
    data = transaction(setup, lang)
    assert poll(setup, data).status_code == 202
    assert poll(setup, data, verifier='z'*43).status_code == 403
    response = approve(setup, data)
    target = urlsplit(response.headers['location'])
    query = parse_qs(target.query)
    assert target.netloc == 'console.servernet.cloud' and target.path == '/'+prefix+'login/studio'
    assert query['login_method'] == ['google']
    assert not calls
    response = browser.get('/auth/callback', params={'state': query['state'][0], 'code': 'x'*43})
    assert response.status_code == 200 and 'ServerNet' in response.text
    # Browser approval never gives the browser the native app's authenticated cookie.
    assert settings.cookie not in browser.cookies
    assert browser.get('/api/session').status_code == 401
    response = poll(setup, data)
    assert response.status_code == 200
    payload = response.json()
    assert payload['origin'] == settings.origin
    assert payload['cookie_name'] == settings.cookie
    assert 'fake-servernet-key' not in response.text
    browser.cookies.set(settings.cookie, payload['cookie_value'])
    assert browser.get('/api/session').json()['name'] == 'کاربر آزمایشی'
    assert browser.get('/api/account').json()['wallet']['available'] == 800
    assert poll(setup, data).status_code == 410
    assert b'fake-servernet-key' not in settings.database.read_bytes()
    with app.state.store.connect() as db:
        assert db.execute('SELECT COUNT(*) FROM desktop_flows').fetchone()[0] == 0


def test_desktop_approval_requires_matching_code_csrf_and_origin(setup):
    data = transaction(setup)
    body = form(setup, data)
    browser = setup[1]
    assert browser.post('/auth/desktop', data=body).status_code == 403
    assert browser.post('/auth/desktop', data=body, headers={'Origin': 'https://attacker.test'}).status_code == 403
    assert approve(setup, data, body | {'csrf': 'wrong'}).status_code == 403
    for _ in range(5):
        assert approve(setup, data, body | {'code': 'INVALID'}).status_code == 400
    assert approve(setup, data, body).status_code == 409
    assert poll(setup, data).status_code == 409
    assert not setup[2]


def test_desktop_approval_is_one_time_and_no_claim_before_callback(setup):
    data = transaction(setup)
    body = form(setup, data)
    assert approve(setup, data, body).status_code == 302
    # A new form cannot restart the same request or approve a different account.
    assert setup[1].get(data['browser_url']).status_code == 409
    assert poll(setup, data).status_code == 202
    assert not setup[2]


def test_desktop_expiry_and_pending_session_claim_window(setup):
    app, browser, _, _, _ = setup
    data = transaction(setup)
    query = parse_qs(urlsplit(approve(setup, data).headers['location']).query)
    browser.get('/auth/callback', params={'state': query['state'][0], 'code': 'x'*43})
    with app.state.store.connect() as db:
        db.execute('UPDATE desktop_requests SET expires=0')
    assert poll(setup, data).status_code == 410
    assert browser.get(data['browser_url']).status_code == 410


def test_expired_native_callback_never_becomes_browser_login_after_cleanup(setup):
    app, browser, _, _, settings = setup
    data = transaction(setup)
    query = parse_qs(urlsplit(approve(setup, data).headers['location']).query)
    with app.state.store.connect() as db:
        db.execute('UPDATE desktop_requests SET expires=0')
    transaction(setup)  # Expired request cleanup must retain its native-flow tombstone.
    response = browser.get('/auth/callback', params={'state': query['state'][0], 'code': 'x'*43})
    assert response.status_code == 410
    assert settings.cookie not in browser.cookies
    assert browser.get('/api/session').status_code == 401
    with app.state.store.connect() as db:
        assert db.execute('SELECT COUNT(*) FROM sessions').fetchone()[0] == 0


def test_desktop_rejects_invalid_parameters_cross_origin_and_capacity_abuse(setup):
    app, browser, calls, _, _ = setup
    assert browser.post('/auth/desktop/start', json={'challenge': 'short'}).status_code == 422
    assert browser.post('/auth/desktop/start', json={'challenge': 'a'*43, 'lang': '../admin'}).status_code == 422
    assert browser.post('/auth/desktop/start', json={'challenge': 'a'*43}, headers={'Origin': 'https://attacker.test'}).status_code == 403
    transaction(setup)
    with app.state.store.connect() as db:
        db.execute('UPDATE desktop_limits SET hits=120')
    assert browser.post('/auth/desktop/start', json={'challenge': 'a'*43}).status_code == 429
    assert not calls


def test_desktop_health_and_stylesheet_are_read_only(setup):
    browser = setup[1]
    assert browser.get('/healthz').json() == {'service': 'servernet-studio', 'status': 'ok', 'desktop_auth_protocol': 1}
    response = browser.get('/assets/desktop-auth.css')
    assert response.status_code == 200 and 'IRANSans' in response.text
    assert not setup[2]
