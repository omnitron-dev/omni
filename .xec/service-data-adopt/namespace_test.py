"""Real-kernel, GNU rsync acceptance inside the private networkless Linux fixture."""

import contextlib
import ctypes
import json
import os
from pathlib import Path
import signal
import struct
import subprocess
import sys
import tempfile
import time
import uuid
import endpoint as adopt

MAPS = {"uid_map": [[0, 995, 1], [1, 100000, 65536]], "gid_map": [[0, 984, 1], [1, 100000, 65536]]}


@contextlib.contextmanager
def namespace():
    ready_r, ready_w = os.pipe()
    release_r, release_w = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.close(ready_r)
        os.close(release_w)
        libc = ctypes.CDLL(None, use_errno=True)
        os.setgroups([])
        ret = libc.unshare(0x10000000)
        os.write(ready_w, b"1" if ret == 0 else str(ctypes.get_errno()).encode())
        if ret != 0:
            os._exit(1)
        os.read(release_r, 1)
        os.setresgid(0, 0, 0)
        os.setresuid(0, 0, 0)
        os.write(ready_w, b"Y")
        while True:
            signal.pause()
    os.close(ready_w)
    os.close(release_r)
    try:
        ok = os.read(ready_r, 16)
        assert ok == b"1", ok
        proc = Path("/proc") / str(pid)
        if (proc / "setgroups").exists():
            (proc / "setgroups").write_text("deny")
        for key, mapping in MAPS.items():
            (proc / key).write_text("".join(" ".join(map(str, r)) + "\n" for r in mapping))
        os.write(release_w, b"1")
        assert os.read(ready_r, 1) == b"Y"
        yield proc
    finally:
        os.close(ready_r)
        os.close(release_w)
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)


def acl(user, group):
    return struct.pack("<I", 2) + b"".join(
        struct.pack("<HHI", *row)
        for row in [
            (1, 6, 0xFFFFFFFF),
            (2, 4, user),
            (4, 4, 0xFFFFFFFF),
            (8, 4, group),
            (16, 4, 0xFFFFFFFF),
            (32, 0, 0xFFFFFFFF),
        ]
    )


def main(out, seeds=None, token="namespace"):
    assert os.geteuid() == 0 and Path("/etc/hostname").read_text().strip() == "service-data-fixture"
    assert set(os.listdir("/sys/class/net")) == {"lo"} and Path(out).is_mount()
    if token.startswith("sourcenative"):
        from cold_test import fixture

        return fixture(Path(out))
    if token.startswith("enginefull"):
        from engine_test import run_fixture

        return run_fixture(Path(out), Path(seeds), token)
    os.umask(0o077)
    work = Path(tempfile.mkdtemp(dir="/srv", prefix="service-adoption-fixture-"))
    work.chmod(0o711)
    original = work / "original"
    original.mkdir()
    child = original / "payload"
    child.write_bytes(b"synthetic service bytes")
    os.chown(child, 12345, 23456)
    child.chmod(0o640)
    os.setxattr(child, "user.service-fixture", b"opaque\x01attribute")
    os.setxattr(child, "system.posix_acl_access", acl(77, 88))
    os.link(child, original / "hard-link")
    original.chmod(0o750)
    os.setxattr(original, "system.posix_acl_default", acl(43, 44))
    (original / "pg_tblspc").mkdir()
    (original / "pg_tblspc/1234").symlink_to("/srv/tablespace")
    partial = original / "flatnode"
    f = partial.open("wb")
    f.seek(2 * 1024**2)
    f.write(b"end")
    f.close()
    stage = work / "stage"
    stage.mkdir()
    os.chown(stage, 65534, 65534)
    stage.chmod(0o700)
    tag = "postgres-data"
    seed = {"id": str(uuid.uuid4())}
    binding = {"seed": seed["id"], "maps": MAPS}
    cons = Path("/etc/omnitron/service-data-adoptions")
    cons.mkdir(mode=0o700, parents=True, exist_ok=True)
    grant = cons / (seed["id"] + ".json")
    grant.write_text(json.dumps(dict(schema=1, binding=adopt.sha(binding), expires=int(time.time()) + 900)))
    wrapper = work / "stage-rsh"
    wrapper.write_text(
        '#!/usr/bin/python3\nimport os,shlex,sys\na=sys.argv[2:];assert a[:2]==["rsync","--server"] and a[-2:]==[".","."]\nos.environ["SSH_ORIGINAL_COMMAND"]=shlex.join(a)\nos.execv("/usr/bin/setpriv",["setpriv","--reuid=65534","--regid=65534","--clear-groups","/usr/bin/rrsync","-wo","-munge","-no-lock",'
        + repr(str(stage))
        + "])\n"
    )
    wrapper.chmod(0o755)
    subprocess.run(
        [
            "rsync",
            "-aHAXS",
            "--numeric-ids",
            "-M--fake-super",
            "-M--modify-window=-1",
            "-e",
            str(wrapper),
            str(original) + "/",
            "stage-local:.",
        ],
        check=True,
    )
    target = work / "fresh"
    target.mkdir()
    os.chown(target, 995, 984)
    target.chmod(0o700)
    state = work / "state"
    state.mkdir()
    with namespace() as proc:
        st = target.lstat()
        pin = [str(st.st_dev), str(st.st_ino)]
        module = str(Path(adopt.__file__).resolve())
        (state / "adopt.py").write_text(
            "import importlib.util,json,sys,traceback\nfrom pathlib import Path\ns=importlib.util.spec_from_file_location('tested',"
            + repr(module)
            + ");m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\n"
            + "assert sys.argv[1:4]=="
            + repr(["_receive", seed["id"], tag])
            + "\nPath("
            + repr(str(Path(out) / (token + ".flags")))
            + ").write_text(json.dumps(sys.argv[4:]))\n"
            + "try:m.receive_into_namespace(Path("
            + repr(str(proc))
            + "),"
            + repr(MAPS)
            + ",Path("
            + repr(str(target))
            + "),"
            + repr(pin)
            + ",sys.argv[4:])\n"
            + "except BaseException:Path("
            + repr(str(Path(out) / (token + ".error")))
            + ").write_text(traceback.format_exc());raise\n"
        )
        adopt.sync_tree(state, seed, binding, stage, tag, False)
        adopt.sync_tree(state, seed, binding, stage, tag, True)
        logical = {"uid_map": adopt.IDENTITY, "gid_map": adopt.IDENTITY}
        assert adopt.metadata(original, logical) == adopt.metadata(target, MAPS)
        assert (target / "payload").read_bytes() == child.read_bytes()
        assert (target / "payload").stat().st_uid == 112344 and (target / "payload").stat().st_gid == 123455
        assert target.stat().st_uid == 995 and target.stat().st_gid == 984
        assert (target / "payload").samefile(target / "hard-link") and (
            target / "pg_tblspc/1234"
        ).readlink() == Path("/srv/tablespace")
        assert os.getxattr(target / "payload", "user.service-fixture") == b"opaque\x01attribute"
        check = adopt.logical_acl(os.getxattr(target / "payload", "system.posix_acl_access"), MAPS)
        assert [2, 4, 77] in check and [8, 4, 88] in check and [16, 4, 0xFFFFFFFF] in check
        defaults = adopt.logical_acl(os.getxattr(target, "system.posix_acl_default"), MAPS)
        assert [2, 4, 43] in defaults and [8, 4, 44] in defaults
        assert (target / "flatnode").stat().st_blocks * 512 < (target / "flatnode").stat().st_size // 2
        (target / "payload").chmod(0o600)
        try:
            adopt.sync_tree(state, seed, binding, stage, tag, True)
        except ValueError:
            pass
        else:
            raise AssertionError("Loss of the source mode or ACL was accepted")
    print(
        "GNU rsync and Linux user namespace restored distinct UID/GID, named access/default ACLs, mask, xattr, hard link, sparse data and PostgreSQL link; metadata tampering rejected.",
        flush=True,
    )


if __name__ == "__main__":
    main(*sys.argv[1:])
