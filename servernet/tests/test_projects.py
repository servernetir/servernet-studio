# SPDX-License-Identifier: AGPL-3.0-only
import json
import uuid

from test_hosted import login, setup


def project(browser, headers, name, **options):
    response = browser.post('/api/projects', headers=headers, json={'name': name, **options})
    assert response.status_code == 200
    return response.json()


def conversation(browser, headers, project_id=None):
    response = browser.post('/api/conversations', headers=headers, json={'project_id': project_id})
    assert response.status_code == 200
    return response.json()['id']


def send(browser, headers, identifier, message, calls, model='sn-chat'):
    response = browser.post('/api/chat', headers=headers, json={
        'conversation_id': identifier, 'request_id': uuid.uuid4().hex, 'model': model, 'message': message,
    })
    assert response.status_code == 200 and 'event: done' in response.text
    return json.loads(calls[-1].content)['messages']


def test_project_and_preferences_endpoints_respect_customer_and_csrf(setup):
    _, browser, _, _, _ = setup
    assert browser.get('/api/projects').status_code == 401
    assert browser.get('/api/preferences').status_code == 401
    headers = login(setup)
    assert browser.post('/api/projects', json={'name': 'Example'}).status_code == 403
    record = project(browser, headers, '  Example  ')
    identifier = record['id']
    assert record == {
        'id': identifier, 'name': 'Example', 'description': '', 'instructions': '',
        'context_scope': 'project', 'history_turns': 12,
    }
    grouped = conversation(browser, headers, identifier)
    old = browser.post('/api/conversations', headers=headers).json()['id']
    assert browser.get('/api/conversations/' + old).json()['project_id'] is None
    assert browser.get('/api/conversations/' + grouped).json()['project_id'] == identifier
    assert browser.get('/api/conversations', params={'project_id': identifier}).json() == [
        {'id': grouped, 'title': 'New conversation', 'project_id': identifier},
    ]
    unfiled = browser.get('/api/conversations', params={'unfiled': 'true'})
    assert unfiled.headers['cache-control'] == 'no-store'
    assert unfiled.json() == [{'id': old, 'title': 'New conversation', 'project_id': None}]
    assert browser.get('/api/conversations', params={'project_id': identifier, 'unfiled': 'true'}).status_code == 422
    patch = browser.post('/api/projects/' + identifier, headers=headers, json={'history_turns': 0})
    assert patch.json() == record | {'history_turns': 0}
    assert browser.post('/api/projects/' + identifier, headers=headers, json={'name': None}).status_code == 422
    assert browser.post('/api/preferences', headers=headers, json={'history_turns': True}).status_code == 422
    assert browser.post('/api/preferences', headers=headers, json={'history_turns': 33}).status_code == 422
    assert browser.post('/api/preferences', headers=headers, json={'history_turns': 3}).json() == {'history_turns': 3}

    outsider = login(setup, 'another-customer')
    assert browser.get('/api/projects').json() == []
    assert browser.get('/api/preferences').json() == {'history_turns': 12}
    assert browser.post('/api/projects/' + identifier, headers=outsider, json={'name': 'Other name'}).status_code == 404
    assert browser.get('/api/conversations', params={'project_id': identifier}).status_code == 404
    assert browser.post('/api/conversations', headers=outsider, json={'project_id': identifier}).status_code == 404
    assert browser.get('/api/conversations').json() == []
    assert browser.get('/api/conversations', params={'unfiled': 'true'}).json() == []


def test_standalone_history_filters_before_applying_recent_conversations_limit(setup):
    app, browser, _, _, _ = setup
    owner = login(setup)
    identifier = project(browser, owner, 'Large project')['id']
    standalone = conversation(browser, owner)
    grouped = [(uuid.uuid4().hex, 'customer-1', 'Grouped', 2_000_000_000) for _ in range(100)]
    with app.state.store.connect() as db:
        db.executemany('INSERT INTO conversations VALUES(?,?,?,?)', grouped)
        db.executemany('INSERT INTO studio_conversation_projects VALUES(?,?,?)',
                       [(chat_id, subject, identifier) for chat_id, subject, _, _ in grouped])
    assert len(browser.get('/api/conversations').json()) == 100
    assert browser.get('/api/conversations', params={'unfiled': 'true'}).json() == [
        {'id': standalone, 'title': 'New conversation', 'project_id': None},
    ]


def test_project_scope_defaults_private_and_drops_revoked_cross_project_context(setup):
    _, browser, calls, _, _ = setup
    owner = login(setup)
    alpha = project(browser, owner, 'Alpha', instructions='Alpha instructions')
    beta = project(browser, owner, 'Beta', context_scope='all', instructions='Beta instructions')
    gamma = project(browser, owner, 'Gamma', context_scope='all')
    outsider = login(setup, 'another-owner')
    outsider_project = project(browser, outsider, 'Outside', context_scope='all')
    outsider_chat = conversation(browser, outsider, outsider_project['id'])
    send(browser, outsider, outsider_chat, 'Outside account content', calls)
    owner = login(setup)
    plain = conversation(browser, owner)
    send(browser, owner, plain, 'Private general conversation', calls)

    alpha_first = conversation(browser, owner, alpha['id'])
    send(browser, owner, alpha_first, 'Alpha first thread', calls)
    beta_chat = conversation(browser, owner, beta['id'])
    beta_request = send(browser, owner, beta_chat, 'Beta fact', calls)
    assert 'Alpha first thread' not in repr(beta_request)
    gamma_chat = conversation(browser, owner, gamma['id'])
    gamma_request = send(browser, owner, gamma_chat, 'Uses Beta transitively', calls)
    assert 'Beta fact' in repr(gamma_request)

    alpha_chat = conversation(browser, owner, alpha['id'])
    private_context = send(browser, owner, alpha_chat, 'Alpha second thread', calls)
    assert private_context[0] == {'role': 'system', 'content': 'Alpha instructions'}
    assert 'Alpha first thread' in repr(private_context)
    assert 'Beta fact' not in repr(private_context)

    browser.post('/api/projects/' + alpha['id'], headers=owner, json={'context_scope': 'all'})
    shared = send(browser, owner, alpha_chat, 'Consent to share', calls)
    assert 'Beta fact' in repr(shared)
    assert 'Uses Beta transitively' in repr(shared)
    assert 'Private general conversation' not in repr(shared)
    assert 'Beta instructions' not in repr(shared)
    assert 'Outside account content' not in repr(shared)

    assert browser.post('/api/projects/' + beta['id'], headers=owner, json={'context_scope': 'project'}).status_code == 200
    after = send(browser, owner, alpha_chat, 'After Beta opted out', calls)
    assert 'Beta fact' not in repr(after)
    assert 'Uses Beta transitively' not in repr(after)
    assert 'Consent to share' not in repr(after)
    assert 'Alpha second thread' in repr(after)
    assert 'Consent to share' in browser.get('/api/conversations/' + alpha_chat).text


def test_history_limit_bounds_context_without_erasing_chat(setup):
    _, browser, calls, _, _ = setup
    owner = login(setup)
    chat = conversation(browser, owner)
    send(browser, owner, chat, 'Long-ago question', calls)
    send(browser, owner, chat, 'Recent question', calls)
    browser.post('/api/preferences', headers=owner, json={'history_turns': 1})
    one = send(browser, owner, chat, 'Use one turn', calls)
    assert [m['content'] for m in one] == ['Recent question', 'پاسخ آزمایشی', 'Use one turn']
    browser.post('/api/preferences', headers=owner, json={'history_turns': 0})
    none = send(browser, owner, chat, 'Use only this prompt', calls)
    assert none == [{'role': 'user', 'content': 'Use only this prompt'}]
    history = browser.get('/api/conversations/' + chat).json()['messages']
    assert len(history) == 8 and history[0]['content'] == 'Long-ago question'


def test_oversized_history_is_not_forwarded_or_dropped_from_the_saved_chat(setup):
    app, browser, calls, _, _ = setup
    owner = login(setup)
    chat = conversation(browser, owner)
    with app.state.store.connect() as db:
        db.executemany('INSERT INTO messages(conversation,role,content) VALUES (?,?,?)', [
            (chat, 'user', 'Older question'), (chat, 'assistant', 'ط' * 25000),
        ])
    assert send(browser, owner, chat, 'Continue with shorter context', calls) == [
        {'role': 'user', 'content': 'Continue with shorter context'},
    ]
    assert len(browser.get('/api/conversations/' + chat).json()['messages'][1]['content']) == 25000


def test_free_project_payload_respects_gateway_role_and_history_limits(setup):
    app, browser, calls, _, _ = setup
    owner = login(setup)
    record = project(browser, owner, 'No cost', instructions='Local instructions', history_turns=32)
    chat = conversation(browser, owner, record['id'])
    with app.state.store.connect() as db:
        db.executemany('INSERT INTO messages(conversation,role,content) VALUES (?,?,?)',
                       [(chat, role, f'{role} {turn}') for turn in range(15) for role in ('user', 'assistant')])
    outgoing = send(browser, owner, chat, 'Use the free model', calls, model='studio-free-chat')
    assert len(outgoing) == 23
    assert {m['role'] for m in outgoing} == {'assistant', 'user'}
    assert outgoing[0]['content'] == 'user 4'
    assert 'Local instructions' in outgoing[-1]['content']
    assert outgoing[-1]['content'].endswith('Use the free model')
