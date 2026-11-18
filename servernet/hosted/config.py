# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026 ServerNet contributors
"""Read private runtime settings without exporting credentials to Passenger."""
from __future__ import annotations

import json
import os
import stat
from pathlib import Path
from typing import Mapping

FIELDS = frozenset({
    'SERVERNET_STUDIO_ORIGIN', 'SERVERNET_STUDIO_CLIENT_SECRET',
    'SERVERNET_STUDIO_ENCRYPTION_KEY', 'SERVERNET_STUDIO_DB',
    'SERVERNET_STUDIO_SOURCE_URL', 'SERVERNET_STUDIO_FONTS',
    'SERVERNET_STUDIO_GMAIL_CLIENT_ID', 'SERVERNET_STUDIO_GMAIL_CLIENT_SECRET',
})
MAX_CONFIG_BYTES = 16 * 1024
DEFAULT_CONFIG = Path(__file__).resolve().parents[1] / 'runtime' / 'config.json'


class RuntimeConfigError(ValueError):
    """Messages deliberately contain neither configuration values nor paths."""


def _valid_file(info):
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise RuntimeConfigError('Studio runtime configuration must be a private regular file.')
    if os.name == 'posix' and (info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) not in (0o400, 0o600)):
        raise RuntimeConfigError('Studio runtime configuration requires its worker owner and mode 0600 or 0400.')
    if info.st_size > MAX_CONFIG_BYTES:
        raise RuntimeConfigError('Studio runtime configuration exceeds the size limit.')


def _pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise RuntimeConfigError('Duplicate Studio runtime configuration fields are not allowed.')
        result[key] = value
    return result


def _validate(values):
    if not isinstance(values, dict) or values.keys() - FIELDS:
        raise RuntimeConfigError('Studio runtime configuration contains unsupported fields.')
    for value in values.values():
        if (not isinstance(value, str) or not value or len(value) > 8192 or value != value.strip()
                or any(ord(char) < 32 or ord(char) == 127 for char in value)):
            raise RuntimeConfigError('Studio runtime configuration fields require nonempty, single-line strings.')
    return values


def _read_private(path: Path, *, required: bool):
    if not path.is_absolute():
        raise RuntimeConfigError('Studio runtime configuration requires an absolute file path.')
    observed = False
    try:
        # Refuse symlinks in both the filename and its containing path. Checking
        # the opened descriptor again also rejects replacement during the read.
        for component in (path, *path.parents):
            if component.is_symlink():
                raise RuntimeConfigError('Studio runtime configuration must not use symbolic links.')
        before = path.lstat()
        observed = True
        _valid_file(before)
        flags = os.O_RDONLY | getattr(os, 'O_CLOEXEC', 0) | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
        descriptor = os.open(path, flags)
        try:
            opened = os.fstat(descriptor)
            _valid_file(opened)
            if (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino):
                raise RuntimeConfigError('Studio runtime configuration changed during startup; restart the worker.')
            with os.fdopen(descriptor, 'rb', closefd=False) as stream:
                raw = stream.read(MAX_CONFIG_BYTES + 1)
        finally:
            os.close(descriptor)
    except FileNotFoundError:
        if not required and not observed:
            return {}
        raise RuntimeConfigError('The configured Studio runtime file is missing.') from None
    except OSError:
        raise RuntimeConfigError('Cannot read the private Studio runtime configuration.') from None
    if len(raw) > MAX_CONFIG_BYTES:
        raise RuntimeConfigError('Studio runtime configuration exceeds the size limit.')
    try:
        return _validate(json.loads(raw.decode('utf-8'), object_pairs_hook=_pairs))
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError):
        raise RuntimeConfigError('Studio runtime configuration must be valid UTF-8 JSON.') from None


def runtime_environment(environ: Mapping[str, str] | None = None, *, default_path: Path | None = None):
    """Environment overrides file fields; an explicit missing file fails closed.

    An absent default private file preserves existing Docker/environment-only
    deployments. The optional file cannot override endpoints or test mode.
    """
    environ = os.environ if environ is None else environ
    explicit = 'SERVERNET_STUDIO_CONFIG' in environ
    if explicit:
        name = environ['SERVERNET_STUDIO_CONFIG']
        if not isinstance(name, str) or not name or '\x00' in name or name != name.strip():
            raise RuntimeConfigError('Studio runtime configuration requires a valid absolute file path.')
        path = Path(name)
    else:
        path = DEFAULT_CONFIG if default_path is None else default_path
    values = _read_private(path, required=explicit)
    values.update({key: environ[key] for key in FIELDS if key in environ})
    return _validate(values)
