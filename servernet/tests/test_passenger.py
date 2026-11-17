# SPDX-License-Identifier: AGPL-3.0-only
import asyncio
import io
from contextlib import asynccontextmanager
from wsgiref.util import setup_testing_defaults

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from servernet.hosted.passenger import PassengerApplication
from test_hosted import setup


def request(app, path, query=''):
    environ = {}
    setup_testing_defaults(environ)
    environ.update({'REQUEST_METHOD':'GET', 'PATH_INFO':path, 'QUERY_STRING':query,
                    'SERVER_NAME':'studio.servernet.test', 'SERVER_PORT':'443',
                    'wsgi.url_scheme':'https', 'wsgi.input':io.BytesIO(b''),
                    'REMOTE_ADDR':'127.0.0.1', 'HTTP_HOST':'studio.servernet.test'})
    result = {}
    def start(status, headers, exc_info=None):
        result.update(status=int(status.split()[0]), headers=dict(headers))
    return result, iter(app(environ, start))


def test_passenger_starts_and_closes_asgi_lifespan():
    state = {'open':False}
    @asynccontextmanager
    async def lifespan(app):
        state['open']=True
        yield
        state['open']=False
    app=FastAPI(lifespan=lifespan)
    @app.get('/')
    async def home():return {'ok':True}
    worker=PassengerApplication(app)
    assert state['open']
    result, body=request(worker,'/')
    assert b'"ok":true' in b''.join(body) and result['status']==200
    worker.close()
    assert not state['open'] and not worker.thread.is_alive()
    worker.close()


def test_passenger_streams_before_later_events_are_released():
    app=FastAPI()
    state={'second':False}
    event=asyncio.Event()
    @app.get('/stream')
    async def stream():
        async def generate():
            yield 'data: first\n\n'
            await asyncio.wait_for(event.wait(),timeout=3)
            state['second']=True
            yield 'data: second\n\n'
        return StreamingResponse(generate(),media_type='text/event-stream')
    worker=PassengerApplication(app)
    try:
        result, body=request(worker,'/stream')
        assert next(body)==b'data: first\n\n'
        assert not state['second']
        worker.loop.call_soon_threadsafe(event.set)
        assert b'data: second\n\n' in b''.join(body)
        assert result['status']==200
    finally:worker.close()


def test_passenger_preserves_customer_auth_and_console_redirect(setup):
    worker=PassengerApplication(setup[0])
    try:
        result, body=request(worker,'/api/session')
        b''.join(body)
        assert result['status']==401
        result, body=request(worker,'/healthz')
        assert b'"desktop_auth_protocol":1' in b''.join(body) and result['status']==200
        result, body=request(worker,'/auth/start','lang=tr&method=google')
        b''.join(body)
        assert result['status']==302
        assert result['headers']['location'].startswith('https://console.servernet.cloud/tr/login/studio?')
        assert 'HttpOnly' in result['headers']['set-cookie']
    finally:worker.close()
