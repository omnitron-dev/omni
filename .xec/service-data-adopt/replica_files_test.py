"""Run the four ordinary file Pipeline phases on the disposable two-engine Linux fixture."""

import ctypes
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

import endpoint as adopt


TAGS = {"nominatim-flatnode", "nominatim-merged", "redis-data", "minio-data"}
HISTORIC = "1774d8587171e5481ba010493223470fdc6e737f858806dd4d9ae3238edde3ff"


def call(argv, **options):
    return subprocess.check_output(list(map(str, argv)), text=True, timeout=180, **options).strip()


def save(out, name, obj):
    (out / ("files-" + name + ".json")).write_text(json.dumps(obj))


def load(out, name):
    return json.loads((out / ("files-" + name + ".json")).read_text())


def prepare_authorities(out, full, base, source, rootless, m):
    source.mkdir(mode=0o700)
    storage = base / "source-engine"
    sock = Path("/run/docker.sock")
    assert not sock.exists()
    with (base / "source-docker.log").open("w") as log:
        server = subprocess.Popen(
            [
                "dockerd",
                "--host",
                "unix://" + str(sock),
                "--data-root",
                str(storage),
                "--exec-root",
                str(base / "source-exec"),
                "--pidfile",
                str(base / "source.pid"),
                "--storage-driver=vfs",
                "--bridge=none",
                "--iptables=false",
                "--ip6tables=false",
                "--ip-masq=false",
                "--userland-proxy=false",
            ],
            stdout=log,
            stderr=log,
            start_new_session=True,
        )
    for _ in range(120):
        assert server.poll() is None
        if sock.is_socket() and subprocess.run(["docker", "info"], capture_output=True).returncode == 0:
            break
        time.sleep(0.3)
    assert call(["docker", "info", "--format", "{{.DockerRootDir}}"]) == str(storage)
    spec = {**full, "id": str(uuid.uuid4()), "receiverPort": 48529, "rateKiB": 65536}
    spec["volumes"] = [{**r, "volume": "files-" + spec["id"][:8] + "-" + r["tag"]} for r in full["volumes"]]
    assert spec["sourceIp"] == "192.0.2.10" and spec["receiverIp"] == "192.0.2.20"
    for addr in (spec["sourceIp"], spec["receiverIp"]):
        call(["ip", "addr", "replace", addr + "/32", "dev", "lo"])
    helper = (out / "seed-program.py").read_bytes()
    assert hashlib.sha256(helper).hexdigest() == HISTORIC
    tools = Path("/var/lib/omnitron-service-data-tools")
    tools.mkdir(mode=0o700, exist_ok=True)
    installed = tools / HISTORIC
    if not installed.exists():
        with installed.open("xb") as f:
            f.write(helper)
            os.fchmod(f.fileno(), 0o500)
    assert adopt.read_file(installed) == helper and installed.stat().st_mode & 0o777 == 0o500
    channel = m["ch"]
    donor_key = base / "donor-host"
    call(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", donor_key])
    donor_pub = donor_key.with_suffix(".pub")
    spec["sourceFingerprint"] = channel.fingerprint(channel.key_text(donor_pub))
    assert spec["receiverFingerprint"] == channel.fingerprint(channel.key_text(channel.HOST_KEY))
    volumes = spec["volumes"]
    for parent, tag, target in (
        ("postgres-data", "postgres-wal", "/mnt/wal"),
        ("nominatim-data", "nominatim-tblspc-12345", "/mnt/tablespace"),
    ):
        row = next(r for r in volumes if r["tag"] == parent)
        volumes.append({**row, "tag": tag, "target": target, "volume": row["volume"] + "-external"})
    redis_image = next(r["image"] for r in volumes if r["tag"] == "redis-data")
    with subprocess.Popen([*rootless, "image", "save", redis_image], stdout=subprocess.PIPE) as image:
        subprocess.run(["docker", "image", "load"], stdin=image.stdout, stdout=subprocess.DEVNULL, check=True)
        image.stdout.close()
        assert image.wait() == 0
    exports = source / "exports"
    exports.mkdir(mode=0o700)
    for row in volumes:
        tag, name = row["tag"], row["volume"]
        call(["docker", "volume", "create", name])
        path = Path(call(["docker", "volume", "inspect", "--format", "{{.Mountpoint}}", name]))
        assert path == storage / "volumes" / name / "_data" and not any(path.iterdir())
        if tag in TAGS:
            call(["rsync", "-aHAXS", "--numeric-ids", str(base / tag) + "/", str(path) + "/"])
        else:
            os.mkfifo(path / "pg-file-read-tripwire")
        st = path.stat()
        row.update(device=str(st.st_dev), inode=str(st.st_ino))
        target = exports / tag
        target.mkdir(mode=0o700)
        call(["mount", "--bind", path, target])
        call(["mount", "-o", "remount,bind,ro,nosuid,nodev,noexec", target])
    m["validate_scope"](spec)
    source_grant = channel.issue_offer(spec, source, {"manifest": m["sha"](spec)})
    public = source_grant["publicKey"]
    expires = int(time.time()) + 3400
    grant = dict(schema=1, spec=adopt.sha(spec), expires=expires, key=public)
    channel.write_record(source / "source.json", grant)
    channel.write_record(source / "spec.json", spec)
    (source / "session.lock").touch(mode=0o600)
    # Recreate the persisted admission that preceded warm staging in the separate baseline fixture.
    admitted = dict(spec=adopt.sha(spec), expires=expires, keySha256=channel.fingerprint(public))
    source_admit = dict(**admitted, side="source", redisPersistence="aof")
    channel.write_record(source / "source-admission.json", source_admit)
    consents = Path("/etc/omnitron/service-data-grants")
    consents.mkdir(mode=0o700, parents=True, exist_ok=True)
    channel.write_record(consents / (spec["id"] + ".json"), {**grant, "key": public, "side": "receiver"})
    # Receiver bootstrap and every subsequently invoked forced SSH receiver are the immutable original.
    m["bootstrap"](spec, "receiver")


def prepare(out):
    full = json.loads((out / "fixture-spec.json").read_text())
    base = Path(full["stageParent"])
    assert base.parent == Path("/srv") and base.name.startswith("service-adoption-full-")
    source = base / "source-endpoint"
    m = adopt.load_checked_seed(adopt.STATE / full["id"], HISTORIC)
    engine = json.loads((out / "engine-report.json").read_text())
    rootless = ["docker", "--host", "unix:///run/user/" + str(engine["uid"]) + "/docker.sock"]
    if not (source / "spec.json").is_file():
        prepare_authorities(out, full, base, source, rootless, m)
    assert call(["docker", "info", "--format", "{{.DockerRootDir}}"]) == str(base / "source-engine")
    spec = adopt.record(source / "spec.json")
    state = adopt.STATE / spec["id"]
    assert m["local_record"](state, "spec.json") == spec
    receiver = m["local_record"](state, "receiver-admission.json")
    source_admit = m["local_record"](source, "source-admission.json")
    donor_pub = base / "donor-host.pub"
    volumes = spec["volumes"]
    redis_image = next(r["image"] for r in volumes if r["tag"] == "redis-data")
    fixture_redis = (base / "redis-data").stat()
    watch = [
        str(base / "source-engine" / "volumes" / r["volume"] / "_data")
        for r in volumes
        if r["tag"] not in TAGS
    ]
    stage = Path(receiver["stage"])
    for row in volumes:
        tag = row["tag"]
        if tag in TAGS:
            stale = stage / tag / "obsolete-warm-file"
            stale.write_bytes(b"stale")
            owner = (stage / tag).stat()
            os.chown(stale, owner.st_uid, owner.st_gid)
        else:
            if not (stage / tag / "pg-warm-tripwire").is_fifo():
                os.mkfifo(stage / tag / "pg-warm-tripwire")
            watch.append(str(stage / tag))
            call([*rootless, "volume", "create", row["volume"]])
            target = Path(
                call([*rootless, "volume", "inspect", "--format", "{{.Mountpoint}}", row["volume"]])
            )
            if not (target / "hold").is_fifo():
                os.mkfifo(target / "hold")
            (target / "hold").chmod(0o444)
            watch.append(str(target))
            # Keep both PGDATA volumes in real running containers; separately attached WAL/tablespace exist too.
            if tag in ("nominatim-data", "postgres-data") and not call(
                [*rootless, "ps", "-q", "--filter", "volume=" + row["volume"]]
            ):
                cid = call(
                    [
                        *rootless,
                        "run",
                        "-d",
                        "--network",
                        "none",
                        "--read-only",
                        "--cap-drop",
                        "ALL",
                        "--security-opt",
                        "no-new-privileges",
                        "--security-opt",
                        "apparmor=" + adopt.VALIDATOR_PROFILE,
                        "--mount",
                        "type=volume,source=" + row["volume"] + ",target=/input,readonly",
                        "--user",
                        f"{fixture_redis.st_uid}:{fixture_redis.st_gid}",
                        "--entrypoint",
                        "redis-check-rdb",
                        redis_image,
                        "/input/hold",
                    ]
                )
                time.sleep(0.3)
                assert call([*rootless, "inspect", "--format", "{{.State.Running}}", cid]) == "true"
    ssh = base / "sshd.fixture"
    ssh.write_text(
        "\n".join(
            [
                "Port " + str(spec["receiverPort"]),
                "ListenAddress " + spec["receiverIp"],
                "HostKey /etc/ssh/ssh_host_ed25519_key",
                "PidFile " + str(base / "sshd.pid"),
                "PermitRootLogin no",
                "PasswordAuthentication no",
                "KbdInteractiveAuthentication no",
                "UsePAM yes",
                "PermitUserEnvironment no",
                "AuthorizedKeysFile %h/.ssh/authorized_keys",
                "AllowUsers " + m["account_name"](spec),
                "LogLevel ERROR",
            ]
        )
        + "\n"
    )
    Path("/run/sshd").mkdir(mode=0o755, exist_ok=True)
    call(["/usr/sbin/sshd", "-f", ssh])
    assert call(
        [
            "/usr/bin/ssh-keyscan",
            "-4",
            "-T",
            "4",
            "-t",
            "ed25519",
            "-p",
            spec["receiverPort"],
            spec["receiverIp"],
        ],
        stderr=subprocess.DEVNULL,
    )
    observe = json.loads((out / "fixture-namespaces.json").read_text())
    donor = next(s for s in observe["steps"] if s["name"] == "source-volume-namespace")
    donor["output"] = json.dumps(
        {"maps": {r["tag"]: {"uid_map": adopt.IDENTITY, "gid_map": adopt.IDENTITY} for r in volumes}}
    )
    for side, fname in (("source", "source-bootstrap"), ("receiver", "bootstrap")):
        boot = json.loads((out / ("fixture-" + fname + ".json")).read_text())
        step = next(s for s in boot["steps"] if s["name"] == "bootstrap-" + side)
        obj = {"spec": adopt.sha(spec), "side": side}
        if side == "receiver":
            obj["stage"] = str(stage)
        step["output"] = json.dumps(obj)
        save(out, fname, boot)
    save(out, "spec", spec)
    save(out, "namespaces", observe)
    save(out, "grants", {"source": source_admit, "receiver": receiver})
    save(out, "stop", str(uuid.uuid4()))
    save(out, "physical", dict(source=str(source), donorPub=str(donor_pub), state=str(state), watch=watch))


def command(step, spec, state):
    cmd = ["/bin/sh", "-ec", step["run"]]
    if step["nodeId"] == spec["sourceNode"]:
        cmd = [
            "unshare",
            "--mount",
            "--propagation",
            "private",
            "--",
            "/bin/sh",
            "-ec",
            'mount --rbind "$1" "$2"; mount --bind "$3" /etc/ssh/ssh_host_ed25519_key.pub; exec /bin/sh -ec "$4"',
            "fixture",
            state["source"],
            state["state"],
            state["donorPub"],
            step["run"],
        ]
    return cmd


def execute(out, phase):
    spec = load(out, "spec")
    state = load(out, "physical")
    roots = [Path(p) for p in state["watch"]]
    assert len(roots) == 12
    libc = ctypes.CDLL(None, use_errno=True)
    fd = libc.inotify_init1(os.O_NONBLOCK | os.O_CLOEXEC)
    assert fd >= 0
    # Read/open, content changes, metadata updates, rename/delete and directory changes on all excluded roots.
    for root in roots:
        assert libc.inotify_add_watch(fd, os.fsencode(root), 0x00000FFF & ~0x10) >= 0
    graph = load(out, phase + "-pipeline")
    reports = {}
    for step in graph["steps"]:
        if step.get("nodeId") is None:
            continue
        cmd = command(step, spec, state)
        if phase in ("restore", "verify"):
            binding = load(out, "binding")["binding"]
            assert set(binding["volumes"]) == TAGS
            grant = dict(schema=1, binding=adopt.sha(binding), expires=int(time.time()) + 1500)
            if phase == "verify":
                grant["validatorProfileSha256"] = (
                    (out / "fixture-validator-profile.sha256").read_text().strip()
                )
            adopt.CONSENTS.mkdir(mode=0o700, parents=True, exist_ok=True)
            dest = adopt.CONSENTS / (spec["id"] + ".json")
            dest.write_text(json.dumps(grant))
            dest.chmod(0o600)
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=500)
        assert result.returncode == 0, (step["name"], result.stderr[-1500:])
        reports[step["name"]] = json.loads(result.stdout)
    try:
        events = os.read(fd, 65536)
    except BlockingIOError:
        events = b""
    finally:
        os.close(fd)
    assert not events, "A PostgreSQL payload directory was opened or changed by " + phase
    acceptance = reports[phase]
    assert acceptance["fileScope"] == "postgres-replicas" and "clusters" not in acceptance
    if phase == "cold":
        assert set(acceptance["trees"]) == TAGS
    if phase in ("restore", "verify"):
        assert set(acceptance["identities"]) == set(acceptance["volumes"]) == TAGS
    if phase == "verify":
        for name in ("postgres-data", "nominatim-data"):
            e = json.loads((out / "engine-report.json").read_text())
            cli = ["docker", "--host", "unix:///run/user/" + str(e["uid"]) + "/docker.sock"]
            v = next(r["volume"] for r in spec["volumes"] if r["tag"] == name)
            assert len(call([*cli, "ps", "--filter", "volume=" + v, "-q"]).splitlines()) == 1
        assert acceptance["verified"] and set(acceptance["metadata"]) == TAGS
        stage = Path(load(out, "seal")["stage"])
        assert all(not (stage / tag / "obsolete-warm-file").exists() for tag in TAGS)
        assert not (Path(state["state"]) / "sealed.json").exists()
        target_name = binding["volumes"]["minio-data"]
        target = Path(call([*cli, "volume", "inspect", "--format", "{{.Mountpoint}}", target_name]))
        assert (target / "fixture-object").is_file()
        (target / "fixture-object").write_bytes(b"changed selected receiver object")
        verify = next(s for s in graph["steps"] if s["name"] == "verify")
        rejected = subprocess.run(command(verify, spec, state), capture_output=True, text=True, timeout=240)
        assert rejected.returncode != 0 and "differs for minio-data" in rejected.stderr, rejected.stderr
        source_name = binding["volumes"]["nominatim-merged"]
        donor = Path(call(["docker", "volume", "inspect", "--format", "{{.Mountpoint}}", source_name]))
        (donor / "source.osm.pbf").write_bytes(b"changed selected source")
        audit = next(s for s in load(out, "seal-pipeline")["steps"] if s["name"] == "source-check")
        changed = subprocess.run(command(audit, spec, state), capture_output=True, text=True, timeout=90)
        assert changed.returncode != 0 and "changed after the cold receipt" in changed.stderr, changed.stderr

    save(out, phase, acceptance)
    save(
        out,
        phase + "-proof",
        {
            "scope": acceptance["fileScope"],
            "registeredEndpointSteps": list(reports),
            "excludedRootsWatched": len(roots),
            "excludedFilesystemEvents": 0,
            **(
                {"changedTargetRejected": True, "changedSourceStampRejected": True}
                if phase == "verify"
                else {}
            ),
            "receipt": adopt.sha(acceptance),
        },
    )


if __name__ == "__main__":
    out, seeds, request = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
    assert os.geteuid() == 0 and Path("/etc/hostname").read_text().strip() == "service-data-fixture"
    assert out.is_mount() and (seeds / "scope.py").is_file() and set(os.listdir("/sys/class/net")) == {"lo"}
    name = request.rstrip("0123456789")
    if name == "prepare":
        prepare(out)
    elif name in ("cold", "seal", "restore", "verify"):
        execute(out, name)
    else:
        raise ValueError("Unknown fixture operation")
