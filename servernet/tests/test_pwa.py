# SPDX-License-Identifier: AGPL-3.0-only
import struct
from pathlib import Path

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from servernet.hosted.app import Settings, create_app


def test_public_install_assets_do_not_require_or_create_a_session(tmp_path):
    web = Path(__file__).parents[1] / 'web'
    assets = web / 'public'
    settings = Settings(origin='https://studio.servernet.test', client_secret='fixture-secret-' + 'x' * 32,
        encryption_key=Fernet.generate_key().decode(), database=tmp_path / 'studio.db',
        source_url='https://github.com/servernetir/servernet-studio', testing=True, assets=assets)
    with TestClient(create_app(settings), base_url=settings.origin, follow_redirects=False) as browser:
        response = browser.get('/manifest.webmanifest')
        assert response.status_code == 200
        assert response.headers['content-type'] == 'application/manifest+json'
        assert response.headers['cache-control'] == 'no-store'
        assert 'set-cookie' not in response.headers
        manifest = response.json()
        assert manifest['id'] == manifest['start_url'] == manifest['scope'] == '/'
        assert manifest['display'] == 'standalone'
        assert manifest['prefer_related_applications'] is False
        assert manifest['name'] == 'ServerNet Studio'
        assert manifest['short_name']
        assert {icon['sizes'] for icon in manifest['icons']} == {'192x192', '512x512'}
        icons = [(icon['src'], int(icon['sizes'].split('x')[0])) for icon in manifest['icons']]
        icons.append(('/icons/studio-180.png', 180))
        for path, size in icons:
            assert path.startswith('/icons/') and not path.startswith('//')
            image = browser.get(path)
            assert image.status_code == 200
            assert image.headers['content-type'] == 'image/png'
            assert image.headers['cache-control'] == 'no-store'
            assert 'set-cookie' not in image.headers
            assert image.content[:8] == b'\x89PNG\r\n\x1a\n'
            assert struct.unpack('>II', image.content[16:24]) == (size, size)
        assert browser.get('/api/session').status_code == 401
        assert browser.get('/api/conversations').status_code == 401
        for worker in ('/sw.js', '/service-worker.js'):
            assert browser.get(worker).status_code == 404
    html = (web / 'index.html').read_text(encoding='utf-8')
    assert 'rel="manifest" href="/manifest.webmanifest"' in html
    assert 'rel="apple-touch-icon" href="/icons/studio-180.png"' in html
