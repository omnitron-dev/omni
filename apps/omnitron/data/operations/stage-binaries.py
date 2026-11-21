"""Install the declared executables of a pinned upstream release on Linux."""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import stat
import sys
import tarfile
import tempfile
from urllib.parse import urlsplit
from urllib.request import build_opener, HTTPRedirectHandler


ROOT = Path("/opt/omnitron/binaries")
LIMIT = 1024 * 1024 * 1024


def component(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]{0,127}", value):
        raise ValueError("invalid release or executable name")
    return value


def https_url(value):
    url = urlsplit(value)
    if url.scheme != "https" or not url.hostname or url.username is not None or url.password is not None or url.fragment:
        raise ValueError("expected a public HTTPS archive URL without credentials")
    return value


class HTTPSRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return super().redirect_request(req, fp, code, msg, headers, https_url(newurl))


def read_spec(spec, machine):
    name, version = component(spec["name"]), component(spec["version"])
    archive = spec["archives"].get(machine)
    if not archive:
        raise ValueError("no declared release for architecture " + machine)
    https_url(archive["url"])
    if not re.fullmatch(r"[0-9a-f]{64}", archive["sha256"]):
        raise ValueError("expected a pinned SHA-256")
    prefix = archive["directory"].split("/") if archive["directory"] else []
    for part in prefix:
        component(part)
    executables = spec["executables"]
    if not isinstance(executables, list) or not executables or len(executables) != len(set(executables)):
        raise ValueError("expected distinct executable names")
    members = {"/".join(prefix + [component(exe)]): exe for exe in executables}
    return name, version, archive, members


def copy_hash(source, dest=None, limit=LIMIT):
    digest, count = hashlib.sha256(), 0
    while chunk := source.read(1024 * 1024):
        count += len(chunk)
        if count > limit:
            raise ValueError("release exceeds size limit")
        digest.update(chunk)
        if dest is not None:
            dest.write(chunk)
    return digest.hexdigest()


def check_path(path, directory, owner):
    info = path.lstat()
    expected = stat.S_ISDIR if directory else stat.S_ISREG
    if not expected(info.st_mode) or info.st_uid != owner or info.st_mode & 0o022:
        raise ValueError("unexpected type, owner or write permissions on " + str(path))
    if directory and not info.st_mode & stat.S_IXOTH:
        raise ValueError("service accounts cannot traverse " + str(path))


def verify_release(destination, archive, members, owner):
    check_path(destination, True, owner)
    receipt = destination / "release.json"
    check_path(receipt, False, owner)
    manifest = json.loads(receipt.read_text())
    if manifest.get("archive") != archive["sha256"] or set(manifest["executables"]) != set(members.values()):
        raise ValueError("installed release differs from declaration")
    for exe, digest in manifest["executables"].items():
        binary = destination / exe
        check_path(binary, False, owner)
        if not (binary.stat().st_mode & stat.S_IXUSR):
            raise ValueError("installed file is not executable")
        with binary.open("rb") as src:
            if copy_hash(src) != digest:
                raise ValueError("installed executable differs from release: " + exe)
    return manifest


def unpack(archive_file, directory, members):
    hashes = {}
    with tarfile.open(archive_file, mode="r|*") as bundle:
        for entry in bundle:
            wanted = members.get(entry.name.removeprefix("./"))
            if wanted is None:
                continue
            if wanted in hashes or not entry.isreg() or not 0 < entry.size <= LIMIT:
                raise ValueError("unexpected archive entry for " + wanted)
            target = directory / wanted
            with bundle.extractfile(entry) as source, target.open("xb") as dest:
                hashes[wanted] = copy_hash(source, dest, entry.size)
                os.fchmod(dest.fileno(), 0o755)
                dest.flush()
                os.fsync(dest.fileno())
    if set(hashes) != set(members.values()):
        raise ValueError("archive is missing a declared executable")
    return hashes


def stage_or_check(mode, spec, root=ROOT, owner=0):
    name, version, archive, members = read_spec(spec, platform.machine())
    destination = root / name / version
    if mode == "check":
        for directory in (root.parent, root, root / name):
            check_path(directory, True, owner)
        return verify_release(destination, archive, members, owner)
    for directory in (root.parent, root, root / name):
        try:
            directory.mkdir(mode=0o755)
        except FileExistsError:
            pass
        else:
            directory.chmod(0o755)
        check_path(directory, True, owner)
    lock = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if destination.exists() or destination.is_symlink():
            return verify_release(destination, archive, members, owner)
        with tempfile.TemporaryDirectory(prefix=".stage-", dir=destination.parent) as tmp:
            work = Path(tmp)
            download = work / "archive"
            with build_opener(HTTPSRedirect()).open(archive["url"], timeout=60) as source, download.open("xb") as dest:
                if copy_hash(source, dest) != archive["sha256"]:
                    raise ValueError("download differs from pinned SHA-256")
            release = work / "release"
            release.mkdir(mode=0o755)
            release.chmod(0o755)
            hashes = unpack(download, release, members)
            with (release / "release.json").open("x") as receipt:
                json.dump({"archive": archive["sha256"], "executables": hashes}, receipt)
                os.fchmod(receipt.fileno(), 0o644)
                receipt.flush()
                os.fsync(receipt.fileno())
            verify_release(release, archive, members, owner)
            contents = os.open(release, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(contents)
            finally:
                os.close(contents)
            release.rename(destination)
            os.fsync(lock)
            return {"archive": archive["sha256"], "executables": hashes}
    finally:
        os.close(lock)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("check", "stage"))
    parser.add_argument("declaration")
    args = parser.parse_args()
    try:
        if args.mode == "stage" and os.geteuid() != 0:
            raise PermissionError("installing system binaries requires root")
        print(json.dumps(stage_or_check(args.mode, json.loads(args.declaration)), sort_keys=True))
    except (OSError, ValueError, KeyError, TypeError, tarfile.TarError) as exc:
        sys.exit(str(exc))
