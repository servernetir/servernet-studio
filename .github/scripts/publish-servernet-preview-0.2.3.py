# SPDX-License-Identifier: AGPL-3.0-only
"""One-shot, unsigned evaluation release from the exact already-built CI run."""

import argparse
import hashlib
import json
import os
import plistlib
import shutil
import stat
import struct
import subprocess
import tempfile
import time
import urllib.parse
import zipfile
from pathlib import Path, PurePosixPath


REPO = 'servernetir/servernet-studio'
REPO_ID = 1461108069
SOURCE = '39f2dd7b1cd1cae454c2759ad6baa0f1f9dcd528'
RUN = 44340339485
TAG = 'studio-v0.2.3-unsigned-preview-39f2dd7'
PREFIX = 'ServerNet-Studio-UNSIGNED-TEST-0.2.3-'
WINDOWS = PREFIX + 'win-x64.exe'
MAC_INTEL = PREFIX + 'mac-x64.zip'
MAC_ARM = PREFIX + 'mac-arm64.zip'
ASSETS = {
    WINDOWS: (121812941, '9aaa520b56217df80a59d4b703a0b8dab7f7fee55d28ab6bcc9e1d7e06412b90'),
    MAC_INTEL: (123773360, '5f55bd44be4cf625172b4eaecd6842ca468d76576dff3c666063c61c11e2766c'),
    MAC_ARM: (117834848, 'fd27fd255ccc39be0a20f3bf665743b26e26558ee53af75d44277622dad7fb46'),
}
ARTIFACTS = {
    14443951169: ('servernet-windows-x64-UNSIGNED-TEST', 121948794,
                  '605d5736eb169906ca21bd34466e42ff179a721aa044f3c23cab96e7142811fc', (WINDOWS,)),
    14444320803: ('servernet-macos-UNSIGNED-TEST', 241346840,
                  '4211816ea47facbbb1c2d0cfd089c5025b45b023627a35b9a53ac503ae8e65c3', (MAC_INTEL, MAC_ARM)),
}
JOBS = {
    'contracts',
    'packages (windows-2022, --win --x64, windows-x64)',
    'packages (macos-15-intel, --mac --arm64 --x64, macos)',
    'native-mac (macos-15-intel, x64, mac)',
    'native-mac (macos-15, arm64, mac-arm64)',
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verify_bytes(path, size, sha):
    require(path.is_file() and path.stat().st_size == size and digest(path) == sha,
            f'Pinned bytes did not match: {path.name}')


def unpack_artifact(archive, metadata, directory):
    _, size, sha, files = metadata
    verify_bytes(archive, size, sha)
    expected = set(files) | {name + '.blockmap' for name in files}
    with zipfile.ZipFile(archive) as zipped:
        entries = zipped.infolist()
        require(len(entries) == len(expected) and {entry.filename for entry in entries} == expected,
                'Unexpected archive entries')
        for entry in entries:
            mode = stat.S_IFMT(entry.external_attr >> 16)
            require(not entry.is_dir() and mode in (0, stat.S_IFREG) and not (entry.flag_bits & 1),
                    'Archive member must be an unencrypted ordinary file')
            require(0 < entry.file_size <= 250_000_000, 'Archive member size rejected')
            if entry.filename in ASSETS:
                require(entry.file_size == ASSETS[entry.filename][0], 'Pinned member size changed')
        require(zipped.testzip() is None, 'Artifact ZIP failed CRC')
        for name in files:
            path = directory / name
            with zipped.open(name) as member, path.open('xb') as target:
                shutil.copyfileobj(member, target)
            verify_bytes(path, *ASSETS[name])


def verify_windows(path):
    with path.open('rb') as exe:
        header = exe.read(64)
        require(header[:2] == b'MZ', 'Missing Windows executable header')
        exe.seek(struct.unpack_from('<I', header, 60)[0])
        require(exe.read(6) == b'PE\0\0\x4c\x01', 'Unexpected Windows NSIS executable format')


def verify_mac(path, cpu):
    bundle = 'ServerNet Studio.app/'
    frameworks = {
        'Electron Framework': ('Electron Framework', 'Helpers', 'Libraries', 'Resources'),
        'Mantle': ('Mantle', 'Resources'),
        'ReactiveObjC': ('ReactiveObjC', 'Resources'),
        'Squirrel': ('Squirrel', 'Resources'),
    }
    links = {}
    for framework, names in frameworks.items():
        base = bundle + 'Contents/Frameworks/' + framework + '.framework/'
        links[base + 'Versions/Current'] = 'A'
        links.update({base + name: 'Versions/Current/' + name for name in names})
    with zipfile.ZipFile(path) as zipped:
        entries = zipped.infolist()
        require(len(entries) == 601 and len({entry.filename for entry in entries}) == len(entries),
                'Unexpected macOS ZIP records')
        actual_links = set()
        for entry in entries:
            name = entry.filename
            require(name.startswith(bundle) and '\\' not in name and '..' not in PurePosixPath(name).parts,
                    'macOS archive path escaped the app bundle')
            mode = stat.S_IFMT(entry.external_attr >> 16)
            require(mode in (0, stat.S_IFREG, stat.S_IFDIR, stat.S_IFLNK) and not (entry.flag_bits & 1),
                    'macOS archive contains an unexpected file type')
            if mode == stat.S_IFLNK:
                require(name in links and zipped.read(entry).decode('utf-8') == links[name],
                        'Unexpected macOS framework symlink')
                actual_links.add(name)
        require(actual_links == set(links), 'macOS framework links changed')
        require(zipped.testzip() is None, 'macOS ZIP failed CRC')
        contents = bundle + 'Contents/'
        info = plistlib.loads(zipped.read(contents + 'Info.plist'))
        require(info['CFBundleIdentifier'] == 'cloud.servernet.studio' and
                info['CFBundleShortVersionString'] == '0.2.3' and
                info['CFBundleExecutable'] == 'ServerNet Studio', 'Unexpected application metadata')
        with zipped.open(contents + 'MacOS/ServerNet Studio') as binary:
            require(binary.read(8) == struct.pack('<II', 0xFEEDFACF, cpu), 'Unexpected native architecture')
        require(zipped.getinfo(contents + 'Resources/app.asar').file_size > 0, 'Missing Studio frontend')


def prepare_assets(directory, archives):
    for artifact_id, archive in archives.items():
        unpack_artifact(archive, ARTIFACTS[artifact_id], directory)
    verify_windows(directory / WINDOWS)
    verify_mac(directory / MAC_INTEL, 0x01000007)
    verify_mac(directory / MAC_ARM, 0x0100000C)
    checksums = directory / 'SHA256SUMS.txt'
    checksums.write_text(''.join(f'{ASSETS[name][1]}  {name}\n' for name in sorted(ASSETS)), encoding='utf-8')
    return {**ASSETS, checksums.name: (checksums.stat().st_size, digest(checksums))}


def gh_api(endpoint, *args, **kwargs):
    return subprocess.run(['gh', 'api', endpoint, '-H', 'X-GitHub-Api-Version:2022-11-28', *args],
                          check=True, **kwargs)


def read_api(endpoint):
    return json.loads(gh_api(endpoint, capture_output=True).stdout)


def write_api(endpoint, method, body):
    return json.loads(gh_api(endpoint, '--method', method, '--input', '-',
                             input=json.dumps(body).encode(), capture_output=True).stdout)


def verify_run(wait=False):
    repo = read_api(f'repos/{REPO}')
    require(repo['id'] == REPO_ID and repo['private'] is False, 'Wrong destination repository')
    deadline = time.monotonic() + 25 * 60
    while True:
        run = read_api(f'repos/{REPO}/actions/runs/{RUN}')
        require(run['id'] == RUN and run['head_sha'] == SOURCE and run['head_branch'] == 'develop' and
                run['event'] == 'push' and run['path'] == '.github/workflows/servernet-desktop.yml',
                'Unexpected workflow provenance')
        if run['status'] == 'completed':
            require(run['conclusion'] == 'success', 'The exact source CI run did not succeed')
            break
        require(wait and time.monotonic() < deadline, 'The pinned CI run is still pending')
        print('Waiting for the pinned CI run to complete its native launch checks.', flush=True)
        time.sleep(20)
    jobs = read_api(f'repos/{REPO}/actions/runs/{RUN}/jobs?filter=latest&per_page=100')['jobs']
    require(len(jobs) == len(JOBS) and {job['name'] for job in jobs} == JOBS and
            all(job['conclusion'] == 'success' for job in jobs), 'All five package/startup checks must pass')
    for artifact_id, (name, size, sha, _) in ARTIFACTS.items():
        artifact = read_api(f'repos/{REPO}/actions/artifacts/{artifact_id}')
        workflow = artifact['workflow_run']
        require(artifact['name'] == name and artifact['size_in_bytes'] == size and
                artifact['digest'] == 'sha256:' + sha and artifact['expired'] is False and
                workflow['id'] == RUN and workflow['head_sha'] == SOURCE and
                workflow['head_repository_id'] == workflow['repository_id'] == REPO_ID,
                'Unexpected or expired artifact record')


def publish(directory, assets):
    endpoint = f'repos/{REPO}'
    tag_endpoint = f'{endpoint}/git/ref/tags/{TAG}'
    tag_probe = subprocess.run(['gh', 'api', tag_endpoint], capture_output=True, text=True)
    require(tag_probe.returncode != 0 and '(HTTP 404)' in tag_probe.stderr,
            'Expected tag to be absent (one-shot publication)')
    existing = gh_api(f'{endpoint}/releases?per_page=100', '--paginate', '--jq',
                      f'.[] | select(.tag_name == "{TAG}") | .id', capture_output=True).stdout.strip()
    require(not existing, 'A release or draft already exists for this preview')
    write_api(f'{endpoint}/git/refs', 'POST', {'ref': 'refs/tags/' + TAG, 'sha': SOURCE})
    tag = read_api(tag_endpoint)['object']
    require(tag['type'] == 'commit' and tag['sha'] == SOURCE, 'Tag did not resolve to the pinned source')
    body = (
        '**Unsigned evaluation preview.** Windows has no Authenticode signature; macOS uses ad hoc '
        'signatures and is not notarized. Follow your operating system’s normal security guidance. '
        'A signed official installer is a separate release.\n\n'
        'Windows x64: EXE. macOS: choose the Apple Silicon (arm64) or Intel (x64) ZIP. '
        'Verify the file against SHA256SUMS.txt.\n\n'
        f'Source: `{SOURCE}`. Original package build and all native startup checks: '
        f'https://github.com/{REPO}/actions/runs/{RUN}. Interactive installation and billing acceptance '
        'have not been recorded for a signed public installer. This preview is not an update feed.'
    )
    release = write_api(f'{endpoint}/releases', 'POST', {
        'tag_name': TAG, 'target_commitish': SOURCE,
        'name': 'ServerNet Studio 0.2.3 – UNSIGNED preview', 'body': body,
        'draft': True, 'prerelease': True, 'make_latest': 'false',
    })
    release_id = release['id']
    require(type(release_id) is int and release_id > 0 and release['draft'] and release['prerelease'] and
            release['tag_name'] == TAG,
            'Unexpected draft release record')
    release_endpoint = f'{endpoint}/releases/{release_id}'
    for name, (size, sha) in sorted(assets.items()):
        upload = f'https://uploads.github.com/{release_endpoint}/assets?name={urllib.parse.quote(name)}'
        result = json.loads(gh_api(upload, '--method', 'POST', '-H', 'Content-Type:application/octet-stream',
                                   '--input', str(directory / name), capture_output=True).stdout)
        require(result['name'] == name and result['state'] == 'uploaded' and result['size'] == size and
                result['digest'] == 'sha256:' + sha, f'Uploaded bytes not verified: {name}')
    uploaded = read_api(release_endpoint + '/assets?per_page=100')
    require(len(uploaded) == len(assets) and {item['name']: (item['size'], item['digest']) for item in uploaded} ==
            {name: (size, 'sha256:' + sha) for name, (size, sha) in assets.items()}, 'Unexpected draft assets')
    require(read_api(tag_endpoint)['object']['sha'] == SOURCE, 'Source tag changed before publication')
    public = write_api(release_endpoint, 'PATCH', {'draft': False, 'prerelease': True, 'make_latest': 'false'})
    require(not public['draft'] and public['prerelease'] and public['tag_name'] == TAG,
            'Prerelease state failed verification')
    print(f'Published and verified the unsigned preview {TAG} from {SOURCE}.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify-archives', nargs=2, metavar=('WINDOWS_ZIP', 'MAC_ZIP'), type=Path,
                        help='Offline verification mode; do not publish')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='servernet-preview-') as temporary:
        directory = Path(temporary)
        if args.verify_archives:
            prepare_assets(directory, dict(zip(ARTIFACTS, args.verify_archives, strict=True)))
            print('All pinned preview archives and package bytes verified offline.')
            return
        require(os.environ.get('GITHUB_REPOSITORY') == REPO and os.environ.get('GITHUB_REF') == 'refs/heads/develop' and
                os.environ.get('GITHUB_EVENT_NAME') == 'push' and os.environ.get('GITHUB_ACTIONS') == 'true',
                'Only the scoped develop push workflow may publish')
        verify_run(wait=True)
        archives = {}
        for artifact_id in ARTIFACTS:
            archive = directory / f'ci-{artifact_id}.zip'
            with archive.open('xb') as stream:
                gh_api(f'repos/{REPO}/actions/artifacts/{artifact_id}/zip', stdout=stream)
            archives[artifact_id] = archive
        assets = prepare_assets(directory, archives)
        verify_run()
        publish(directory, assets)


if __name__ == '__main__':
    main()
