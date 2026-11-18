# SPDX-License-Identifier: AGPL-3.0-only
import asyncio
import hashlib
import json
import secrets
import sqlite3
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from servernet.hosted.app import Settings, create_app


@pytest.fixture
def setup(tmp_path):
    calls = []
    mode = {'status': 200, 'missing_charge': False, 'timeout': False}
    def upstream(request):
        calls.append(request)
        if request.url.path == '/api/studio/token':
            return httpx.Response(200, json={'access_token': 'fake-servernet-key', 'expires_in': 3600,
                'customer': {'id': 'customer-1', 'name': 'کاربر آزمایشی'}})
        assert request.headers['authorization'] == 'Bearer fake-servernet-key'
        if request.url.path.endswith('/models'):
            return httpx.Response(200, json={'data': [{'id': 'sn-chat', 'category': 'chat'}, {'id':'video','category':'video'}, {'id':'unknown'}]})
        if request.url.path.endswith('/studio/account'):
            return httpx.Response(200, json={'customer': {'id':'customer-1', 'name':'کاربر آزمایشی'},
                'wallet': {'currency':'IRT', 'unit':'toman', 'balance': 900, 'reserved': 100, 'available':800},
                'ai': {'spent_month':37, 'prompt_tokens_month': 8, 'completion_tokens_month': 4}})
        if request.url.path.endswith('/studio/revoke'):
            return httpx.Response(200, json={'ok':True})
        if request.url.path.endswith('/chat/completions'):
            if mode['timeout']:
                raise httpx.ReadTimeout('fixture timeout', request=request)
            if mode['status'] != 200:
                return httpx.Response(mode['status'], json={'error':{'code':'fixture'}})
            chunk = {'choices': [], 'usage': {'prompt_tokens': 8, 'completion_tokens': 4}}
            if not mode['missing_charge']:
                chunk['servernet_charge_irt'] = 37
            text = 'data: ' + json.dumps({'choices':[{'delta':{'content':'پاسخ آزمایشی'}}]}) + '\n\n'
            text += 'data: ' + json.dumps(chunk) + '\n\ndata: [DONE]\n\n'
            return httpx.Response(200, text=text, headers={'Content-Type':'text/event-stream'})
        raise AssertionError('Unexpected outbound endpoint: ' + str(request.url))
    settings = Settings(origin='https://studio.servernet.test', client_secret='fixture-secret-'+'x'*32,
        encryption_key=Fernet.generate_key().decode(), database=tmp_path/'studio.db',
        source_url='https://github.com/servernetir/servernet-studio', testing=True)
    remote = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    app = create_app(settings, remote)
    with TestClient(app, base_url=settings.origin, follow_redirects=False) as browser:
        yield app, browser, calls, mode, settings
    asyncio.run(remote.aclose())


def login(setup, subject='customer-1'):
    app, browser, _, _, settings = setup
    cookie, _ = app.state.store.create_session({'access_token':'fake-servernet-key','expires_in':3600,
        'customer':{'id':subject,'name':'کاربر آزمایشی'}})
    browser.cookies.set(settings.cookie, cookie)
    csrf = browser.get('/api/session').json()['csrf']
    return {'Origin':settings.origin, 'X-CSRF-Token':csrf}


def new_chat(setup):
    headers = login(setup)
    browser = setup[1]
    identifier = browser.post('/api/conversations', headers=headers).json()['id']
    body = {'conversation_id':identifier, 'request_id':'a'*32,'model':'sn-chat','message':'سلام'}
    return headers, body


def test_no_customer_session_no_access(setup):
    browser = setup[1]
    for path in ['/api/session','/api/account','/api/models','/api/conversations']:
        assert browser.get(path).status_code == 401
    assert setup[2] == []


def test_pkce_console_login_and_cookie_binding(setup):
    app, browser, calls, _, settings = setup
    r = browser.get('/auth/start')
    q = parse_qs(urlsplit(r.headers['location']).query)
    assert r.headers['location'].startswith('https://console.servernet.cloud/login/studio?')
    assert q['code_challenge_method'] == ['S256'] and len(q['code_challenge'][0]) == 43
    assert q['redirect_uri'] == [settings.callback]
    assert 'HttpOnly' in r.headers['set-cookie'] and 'SameSite=lax' in r.headers['set-cookie']
    assert browser.get('/auth/callback', params={'state':'wrong','code':'x'*43}).status_code == 400
    assert not calls
    r = browser.get('/auth/callback', params={'state':q['state'][0],'code':'x'*43})
    assert r.status_code == 303
    sent = json.loads(calls[0].content)
    import base64
    challenge = base64.urlsafe_b64encode(hashlib.sha256(sent['code_verifier'].encode()).digest()).decode().rstrip('=')
    assert challenge == q['code_challenge'][0]
    assert browser.get('/api/session').status_code == 200
    assert browser.get('/auth/callback', params={'state':q['state'][0],'code':'x'*43}).status_code == 400
    assert len(calls) == 1
    assert b'fake-servernet-key' not in settings.database.read_bytes()


def test_pkce_flow_cannot_move_between_browsers(setup):
    _, browser, calls, _, _ = setup
    q = parse_qs(urlsplit(browser.get('/auth/start').headers['location']).query)
    browser.cookies.clear()
    assert browser.get('/auth/callback', params={'state':q['state'][0], 'code':'x'*43}).status_code == 400
    assert not calls


@pytest.mark.parametrize('method', ['account', 'google', 'register'])
@pytest.mark.parametrize('lang,prefix', [('fa', ''), ('en', 'en/'), ('tr', 'tr/')])
def test_signin_methods_share_the_console_flow(setup, method, lang, prefix):
    _, browser, calls, _, _ = setup
    response = browser.get('/auth/start', params={'method': method, 'lang': lang})
    target = urlsplit(response.headers['location'])
    query = parse_qs(target.query)
    assert target.netloc == 'console.servernet.cloud'
    assert target.path == '/' + prefix + 'login/studio'
    assert query['login_method'] == [method]
    assert query['code_challenge_method'] == ['S256']
    assert response.headers['cache-control'] == 'no-store'
    assert 'Max-Age=3600' in response.headers['set-cookie']
    assert not calls


def test_unsupported_signin_method_does_not_start_a_flow(setup):
    app, browser, calls, _, _ = setup
    assert browser.get('/auth/start', params={'method': 'https://attacker.test'}).status_code == 422
    with app.state.store.connect() as db:
        assert db.execute('SELECT COUNT(*) FROM flows').fetchone()[0] == 0
    assert not calls


def test_registration_can_take_longer_than_five_minutes_but_flow_still_expires(setup, monkeypatch):
    _, browser, calls, _, _ = setup
    response = browser.get('/auth/start', params={'method': 'register'})
    query = parse_qs(urlsplit(response.headers['location']).query)
    import time
    started = time.time()
    monkeypatch.setattr('servernet.hosted.app.time.time', lambda: started + 900)
    assert browser.get('/auth/callback', params={'state': query['state'][0], 'code': 'x'*43}).status_code == 303
    assert len(calls) == 1
    # A newly started transaction still expires after its bounded one-hour lifetime.
    query = parse_qs(urlsplit(browser.get('/auth/start').headers['location']).query)
    monkeypatch.setattr('servernet.hosted.app.time.time', lambda: started + 900 + 3601)
    assert browser.get('/auth/callback', params={'state': query['state'][0], 'code': 'x'*43}).status_code == 400
    assert len(calls) == 1


def test_csrf_and_origin_both_required(setup):
    headers = login(setup)
    browser = setup[1]
    assert browser.post('/api/conversations').status_code == 403
    assert browser.post('/api/conversations', headers=headers|{'Origin':'https://evil.test'}).status_code == 403
    assert browser.post('/api/conversations', headers=headers|{'X-CSRF-Token':'wrong'}).status_code == 403
    assert browser.post('/api/conversations', headers=headers).status_code == 200


def test_account_wallet_and_model_filter_are_server_owned(setup):
    login(setup)
    browser = setup[1]
    account = browser.get('/api/account').json()
    assert account['wallet'] == {'currency':'IRT','unit':'toman','balance':900,'reserved':100,'available':800}
    assert browser.get('/api/models').json() == {'data':[{'id':'sn-chat','context_length':None}]}
    assert browser.get('/api/models?catalog=true').json() == {'data': [
        {'id': 'sn-chat', 'context_length': None, 'category': 'chat'},
        {'id': 'video', 'context_length': None, 'category': 'video'},
    ]}
    assert 'fake-servernet-key' not in browser.get('/api/session').text


def test_history_isolated_between_customers(setup):
    headers, body = new_chat(setup)
    login(setup, 'customer-2')
    assert setup[1].get('/api/conversations').json() == []
    assert setup[1].get('/api/conversations/'+body['conversation_id']).status_code == 404
    assert setup[1].get('/api/conversations/'+body['conversation_id']+'/export').status_code == 404


def test_export_returns_owned_conversation_as_plain_text(setup):
    headers, body = new_chat(setup)
    browser = setup[1]
    assert browser.post('/api/chat', headers=headers, json=body).status_code == 200
    identifier = body['conversation_id']
    exported = browser.get(f'/api/conversations/{identifier}/export')
    assert exported.status_code == 200
    assert exported.headers['content-type'] == 'text/plain; charset=utf-8'
    assert exported.headers['content-disposition'] == f'attachment; filename="servernet-conversation-{identifier}.txt"'
    assert body['message'] in exported.text
    assert 'پاسخ آزمایشی' in exported.text


def test_gateway_stream_billing_history_and_same_request_replay(setup):
    headers, body = new_chat(setup)
    browser, calls = setup[1], setup[2]
    r = browser.post('/api/chat', json=body, headers=headers)
    assert r.status_code == 200 and 'event: delta' in r.text and '"charge_irt": 37' in r.text
    assert len(calls) == 1 and calls[0].headers['idempotency-key'] == 'studio-' + body['request_id']
    sent = json.loads(calls[0].content)
    assert sent['stream_options'] == {'include_usage':True} and sent['messages']==[{'role':'user','content':'سلام'}]
    replay = browser.post('/api/chat', json=body, headers=headers)
    assert 'event: done' in replay.text and len(calls) == 1
    history = browser.get('/api/conversations/'+body['conversation_id']).json()
    assert len(history['messages']) == 2 and not history['pending']
    assert browser.post('/api/chat', json=body|{'message':'changed'}, headers=headers).status_code == 422
    assert len(calls) == 1


@pytest.mark.parametrize('failure', ['missing_charge','timeout','conflict','server_error'])
def test_unknown_outcomes_never_resend_or_unlock_conversation(setup, failure):
    headers, body = new_chat(setup)
    browser, calls, mode = setup[1:4]
    if failure in ('missing_charge','timeout'):
        mode[failure] = True
    else:
        mode['status'] = 409 if failure == 'conflict' else 502
    r = browser.post('/api/chat', json=body, headers=headers)
    assert r.status_code in (200,409,502)
    assert browser.get('/api/conversations/'+body['conversation_id']).json()['pending']['state']=='unknown'
    assert browser.post('/api/chat', json=body, headers=headers).status_code == 409
    assert browser.post('/api/chat', json=body|{'request_id':'b'*32}, headers=headers).status_code == 409
    assert len(calls) == 1


def test_insufficient_funds_no_local_charge_or_history_and_no_retry(setup):
    headers, body = new_chat(setup)
    setup[3]['status'] = 402
    browser = setup[1]
    assert browser.post('/api/chat', json=body, headers=headers).status_code == 402
    assert browser.post('/api/chat', json=body, headers=headers).status_code == 409
    history=browser.get('/api/conversations/'+body['conversation_id']).json()
    assert not history['pending'] and history['messages']==[] and len(setup[2])==1


def test_logout_removes_session_and_revokes_only_its_key(setup):
    headers = login(setup)
    browser=setup[1]
    assert browser.post('/api/logout', headers=headers).status_code == 200
    assert browser.get('/api/session').status_code == 401
    assert setup[2][0].url.path == '/v1/studio/revoke'


def test_customer_app_has_no_upstream_admin_or_tools_routes(setup):
    for path in ['/api/inference','/api/auth/login','/api/terminal','/docs']:
        assert setup[1].get(path).status_code == 404
    assert setup[1].get('/legal').status_code == 200
    assert 'Unsloth Studio' in setup[1].get('/legal').text
    assert setup[1].get('/legal').headers['referrer-policy'] == 'no-referrer'


def test_untrusted_or_expired_session_and_oversized_requests(setup):
    app,browser,_,_,settings=setup
    browser.cookies.set(settings.cookie, 'forged')
    assert browser.get('/api/session').status_code==401
    headers=login(setup)
    with app.state.store.connect() as db:
        db.execute('UPDATE sessions SET expires=0')
    assert browser.get('/api/session').status_code==401
    assert browser.post('/api/chat',content='x'*40000).status_code==413

@pytest.mark.parametrize('lang,prefix', [('fa',''),('en','en/'),('tr','tr/')])
def test_console_language_is_preserved(setup, lang, prefix):
    response=setup[1].get('/auth/start', params={'lang':lang})
    assert response.headers['location'].startswith('https://console.servernet.cloud/'+prefix+'login/studio?')
    assert setup[1].get('/auth/start', params={'lang':'../admin'}).status_code==422


def test_font_route_serves_only_installed_whitelisted_fonts(setup, tmp_path):
    from dataclasses import replace
    fonts=tmp_path/'fonts';fonts.mkdir()
    data=b'woff2-font-route-fixture'
    (fonts/'IRANSans-web.woff2').write_bytes(data)
    settings=replace(setup[4], fonts=fonts)
    app=create_app(settings)
    with TestClient(app,base_url=settings.origin) as client:
        result=client.get('/assets/fonts/IRANSans-Regular.woff2')
        assert result.status_code==200 and result.content==data and result.headers['content-type']=='font/woff2'
        assert client.get('/assets/fonts/secrets.env').status_code==404
        assert client.get('/assets/fonts/IRANSans-Bold.woff2').status_code==404


def test_chunked_oversized_body_is_rejected_without_upstream_call(setup):
    def chunks():
        yield b'x'*20000
        yield b'x'*20000
    response=setup[1].post('/api/chat',content=chunks())
    assert response.status_code==413
    assert setup[2]==[]
