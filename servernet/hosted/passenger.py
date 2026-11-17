# SPDX-License-Identifier: AGPL-3.0-only
"""Passenger WSGI entry support for HTTP/SSE deployments without Docker."""
import asyncio
import threading

from a2wsgi import ASGIMiddleware


class PassengerApplication:
    def __init__(self, app):
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self.loop.run_forever, name='servernet-asgi', daemon=True)
        self.thread.start()
        self.closed = False
        self.lifespan = app.router.lifespan_context(app)
        try:
            asyncio.run_coroutine_threadsafe(self.lifespan.__aenter__(), self.loop).result(timeout=15)
            self.middleware = ASGIMiddleware(app, loop=self.loop, wait_time=5)
        except BaseException:
            self.loop.call_soon_threadsafe(self.loop.stop)
            self.thread.join(timeout=5)
            self.loop.close()
            raise

    def __call__(self, environ, start_response):
        if self.closed:
            raise RuntimeError('Studio worker has stopped.')
        return self.middleware(environ, start_response)

    def close(self):
        if self.closed:
            return
        self.closed = True
        try:
            asyncio.run_coroutine_threadsafe(self.lifespan.__aexit__(None, None, None), self.loop).result(timeout=10)
        finally:
            self.loop.call_soon_threadsafe(self.loop.stop)
            self.thread.join(timeout=5)
            self.loop.close()
