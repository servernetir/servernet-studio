# SPDX-License-Identifier: AGPL-3.0-only
import json
import os
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from servernet.hosted.config import MAX_CONFIG_BYTES, RuntimeConfigError, runtime_environment


def private_config(tmp_path, values):
    path = tmp_path / 'config.json'
    path.write_text(json.dumps(values), encoding='utf-8')
    path.chmod(0o600)
    return path


def test_missing_default_preserves_environment_deployment(tmp_path):
    values = {'SERVERNET_STUDIO_ORIGIN': 'https://studio.servernet.cloud'}
    assert runtime_environment(values, default_path=tmp_path / 'absent.json') == values


def test_environment_overrides_private_file_without_mutating_it(tmp_path):
    path = private_config(tmp_path, {'SERVERNET_STUDIO_ORIGIN': 'https://old.servernet.cloud',
                                   'SERVERNET_STUDIO_CLIENT_SECRET': 'fixture-secret-' + 'x' * 32})
    before = path.read_bytes()
    environment = {'SERVERNET_STUDIO_CONFIG': str(path), 'SERVERNET_STUDIO_ORIGIN': 'https://studio.servernet.cloud'}
    values = runtime_environment(environment)
    assert values['SERVERNET_STUDIO_ORIGIN'] == environment['SERVERNET_STUDIO_ORIGIN']
    assert values['SERVERNET_STUDIO_CLIENT_SECRET'].startswith('fixture-secret-')
    assert path.read_bytes() == before
    assert 'SERVERNET_STUDIO_CLIENT_SECRET' not in environment


@pytest.mark.parametrize('name', ['', 'relative.json', '/\x00invalid'])
def test_invalid_explicit_path_fails_closed(name):
    with pytest.raises(RuntimeConfigError):
        runtime_environment({'SERVERNET_STUDIO_CONFIG': name})


def test_missing_explicit_file_does_not_fall_back_to_environment(tmp_path):
    with pytest.raises(RuntimeConfigError, match='missing'):
        runtime_environment({'SERVERNET_STUDIO_CONFIG': str(tmp_path / 'absent'),
                             'SERVERNET_STUDIO_CLIENT_SECRET': 'fixture-' + 'x' * 32})


def test_default_file_disappearing_during_startup_does_not_fall_back(tmp_path, monkeypatch):
    path = private_config(tmp_path, {})
    real_open = os.open
    def remove_before_open(name, flags):
        path.unlink()
        return real_open(name, flags)
    monkeypatch.setattr(os, 'open', remove_before_open)
    with pytest.raises(RuntimeConfigError, match='missing'):
        runtime_environment({}, default_path=path)


def test_file_replacement_during_open_is_rejected(tmp_path, monkeypatch):
    path = private_config(tmp_path, {})
    replacement = tmp_path / 'replacement.json'
    replacement.write_text('{}')
    replacement.chmod(0o600)
    real_open = os.open
    def replace_before_open(name, flags):
        replacement.replace(path)
        return real_open(name, flags)
    monkeypatch.setattr(os, 'open', replace_before_open)
    with pytest.raises(RuntimeConfigError, match='changed'):
        runtime_environment({'SERVERNET_STUDIO_CONFIG': str(path)})


@pytest.mark.skipif(os.name != 'posix', reason='POSIX permission check')
def test_owner_read_only_config_is_supported(tmp_path):
    path = private_config(tmp_path, {'SERVERNET_STUDIO_ORIGIN': 'https://studio.servernet.cloud'})
    path.chmod(0o400)
    assert runtime_environment({'SERVERNET_STUDIO_CONFIG': str(path)})['SERVERNET_STUDIO_ORIGIN'].startswith('https://')


@pytest.mark.parametrize('value', [True, 12, None, {}, [], '', ' secret ', 'secret\nvalue', 'secret\x00value'])
def test_invalid_fields_cannot_be_silently_overridden(tmp_path, value):
    path = private_config(tmp_path, {'SERVERNET_STUDIO_CLIENT_SECRET': value})
    with pytest.raises(RuntimeConfigError):
        runtime_environment({'SERVERNET_STUDIO_CONFIG': str(path), 'SERVERNET_STUDIO_CLIENT_SECRET': 'valid-' + 'x' * 32})


@pytest.mark.parametrize('field', ['SERVERNET_STUDIO_GATEWAY', 'SERVERNET_STUDIO_CONSOLE', 'testing', 'secret-value-sentinel'])
def test_private_file_cannot_change_trusted_endpoints_or_test_mode(tmp_path, field):
    path = private_config(tmp_path, {field: 'secret-value-sentinel'})
    with pytest.raises(RuntimeConfigError) as error:
        runtime_environment({'SERVERNET_STUDIO_CONFIG': str(path)})
    assert field not in str(error.value)
    assert 'secret-value-sentinel' not in str(error.value)


@pytest.mark.parametrize('raw', [b'[]', b'{"secret-value-sentinel":', b'\xff',
    b'{"SERVERNET_STUDIO_ORIGIN":"https://one.servernet.cloud","SERVERNET_STUDIO_ORIGIN":"https://two.servernet.cloud"}'])
def test_malformed_or_ambiguous_json_is_rejected_without_echoing_values(tmp_path, raw):
    path = private_config(tmp_path, {})
    path.write_bytes(raw)
    with pytest.raises(RuntimeConfigError) as error:
        runtime_environment({'SERVERNET_STUDIO_CONFIG': str(path)})
    assert 'secret-value-sentinel' not in str(error.value)


def test_empty_environment_override_is_rejected(tmp_path):
    path = private_config(tmp_path, {'SERVERNET_STUDIO_CLIENT_SECRET': 'fixture-' + 'x' * 32})
    with pytest.raises(RuntimeConfigError):
        runtime_environment({'SERVERNET_STUDIO_CONFIG': str(path), 'SERVERNET_STUDIO_CLIENT_SECRET': ''})


@pytest.mark.skipif(os.name != 'posix', reason='POSIX owner and permission checks')
@pytest.mark.parametrize('mode', [0o644, 0o640, 0o660, 0o700])
def test_shared_or_executable_file_is_rejected(tmp_path, mode):
    path = private_config(tmp_path, {})
    path.chmod(mode)
    with pytest.raises(RuntimeConfigError, match='mode'):
        runtime_environment({'SERVERNET_STUDIO_CONFIG': str(path)})


@pytest.mark.skipif(os.name != 'posix', reason='POSIX owner check')
def test_different_worker_owner_is_rejected(tmp_path, monkeypatch):
    path = private_config(tmp_path, {})
    monkeypatch.setattr(os, 'geteuid', lambda: path.stat().st_uid + 1)
    with pytest.raises(RuntimeConfigError, match='owner'):
        runtime_environment({'SERVERNET_STUDIO_CONFIG': str(path)})


def test_symlinks_in_file_or_parent_and_hardlinks_are_rejected(tmp_path):
    path = private_config(tmp_path, {})
    link = tmp_path / 'linked.json'
    link.symlink_to(path)
    parent = tmp_path / 'linked-directory'
    parent.symlink_to(tmp_path, target_is_directory=True)
    for name in (link, parent / path.name):
        with pytest.raises(RuntimeConfigError, match='symbolic'):
            runtime_environment({'SERVERNET_STUDIO_CONFIG': str(name)})
    os.link(path, tmp_path / 'hardlink.json')
    with pytest.raises(RuntimeConfigError, match='regular'):
        runtime_environment({'SERVERNET_STUDIO_CONFIG': str(path)})


def test_oversized_or_nonregular_config_is_rejected(tmp_path):
    path = private_config(tmp_path, {})
    path.write_bytes(b' ' * (MAX_CONFIG_BYTES + 1))
    with pytest.raises(RuntimeConfigError, match='size'):
        runtime_environment({'SERVERNET_STUDIO_CONFIG': str(path)})
    with pytest.raises(RuntimeConfigError, match='regular'):
        runtime_environment({'SERVERNET_STUDIO_CONFIG': str(tmp_path)})


def test_customer_app_starts_with_private_config_and_no_exported_secrets(tmp_path, monkeypatch):
    import servernet.hosted.config as config
    from servernet.hosted.app import configured_app

    fonts = tmp_path / 'fonts'
    fonts.mkdir()
    for name in ('IRANSans-web.woff2', 'IRANSans-Medium-web.woff2', 'IRANSans-Bold-web.woff2'):
        (fonts / name).write_bytes(b'fixture-font')
    values = {'SERVERNET_STUDIO_ORIGIN': 'https://studio.servernet.cloud',
        'SERVERNET_STUDIO_CLIENT_SECRET': 'fixture-' + 'x' * 32,
        'SERVERNET_STUDIO_ENCRYPTION_KEY': Fernet.generate_key().decode(),
        'SERVERNET_STUDIO_DB': str(tmp_path / 'state' / 'studio.db'),
        'SERVERNET_STUDIO_SOURCE_URL': 'https://github.com/servernetir/servernet-studio/tree/' + 'a' * 40,
        'SERVERNET_STUDIO_FONTS': str(fonts)}
    path = private_config(tmp_path, values)
    monkeypatch.setattr(config, 'DEFAULT_CONFIG', path)
    for name in (*config.FIELDS, 'SERVERNET_STUDIO_CONFIG'):
        monkeypatch.delenv(name, raising=False)
    with TestClient(configured_app(), base_url=values['SERVERNET_STUDIO_ORIGIN']) as client:
        health = client.get('/healthz')
        assert health.status_code == 200 and health.json()['desktop_auth_protocol'] == 1
        assert client.get('/api/session').status_code == 401
        assert client.get('/assets/fonts/IRANSans-Regular.woff2').content == b'fixture-font'
        assert values['SERVERNET_STUDIO_CLIENT_SECRET'] not in client.get('/legal').text
    assert Path(values['SERVERNET_STUDIO_DB']).is_file()
    assert all(name not in os.environ for name in config.FIELDS)
