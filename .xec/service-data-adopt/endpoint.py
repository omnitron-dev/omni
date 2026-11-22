"""Restore a sealed identity-mapped donor into separately admitted, unattached rootless Docker volumes."""

import base64
import ctypes
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import signal
import socket
import stat
import struct
import subprocess
import sys
import time

STATE = Path("/var/lib/omnitron-service-data")
CONSENTS = Path("/etc/omnitron/service-data-adoptions")
PATH = "/usr/sbin:/usr/bin:/sbin:/bin"
UUID = re.compile("[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\\Z")
IDENTITY = [[0, 0, 4294967295]]
VALIDATOR_PROFILE = "omnitron-service-data-verify-v2"


def must(ok, message):
    if not ok:
        raise ValueError(message)


def safe_dir(path):
    must(path.resolve(strict=True) == path, "A physical administrative directory is required")
    for item in (path, *path.parents):
        st = item.lstat()
        must(
            stat.S_ISDIR(st.st_mode) and st.st_uid == 0 and not st.st_mode & 0o022,
            "Untrusted administrative directory",
        )
    return path


def read_file(path, limit=131072, disallowed_mode=0o027):
    safe_dir(path.parent)
    with os.fdopen(os.open(path, os.O_NOFOLLOW | os.O_NONBLOCK | os.O_RDONLY), "rb") as stream:
        st = os.fstat(stream.fileno())
        must(
            stat.S_ISREG(st.st_mode)
            and st.st_nlink == 1
            and st.st_uid == 0
            and not st.st_mode & disallowed_mode
            and 0 < st.st_size <= limit,
            "Untrusted administrative evidence",
        )
        data = stream.read(limit + 1)
        must(len(data) == st.st_size, "Administrative evidence changed")
        return data


def record(path):
    return json.loads(read_file(path))


def sha(value):
    return hashlib.sha256(json.dumps(value, separators=(",", ":"), sort_keys=True).encode()).hexdigest()


def load_checked_seed(state, digest):
    code = read_file(state / "receiver.py")
    must(
        hashlib.sha256(code).hexdigest() == digest,
        "The installed seed helper differs from the reviewed exporter",
    )
    previous = sys.argv
    try:
        sys.argv = ["verified-seed"]
        mod = {"__name__": "checked_seed", "SELF": code.decode()}
        exec(compile(code, "sealed-seed-helper", "exec"), mod)
        return mod
    finally:
        sys.argv = previous


def checked_grant(seed, binding):
    granted = record(CONSENTS / (seed["id"] + ".json"))
    must(
        set(granted)
        in ({"schema", "binding", "expires"}, {"schema", "binding", "expires", "validatorProfileSha256"})
        and (
            "validatorProfileSha256" not in granted
            or re.fullmatch("[a-f0-9]{64}", granted["validatorProfileSha256"])
        )
        and granted["schema"] == 1
        and granted["binding"] == sha(binding)
        and type(granted["expires"]) is int
        and granted["expires"] > time.time(),
        "A current independent local adoption grant is required",
    )
    return granted


def validator_security(grant, expected):
    must(
        grant.get("validatorProfileSha256") == expected,
        "Validator profile differs from the independent local admission",
    )
    if expected is None:
        return []
    policy = read_file(Path("/etc/apparmor.d") / VALIDATOR_PROFILE, limit=65536, disallowed_mode=0o022)
    profiles = Path("/sys/kernel/security/apparmor/profiles").read_text().splitlines()
    must(
        hashlib.sha256(policy).hexdigest() == expected and VALIDATOR_PROFILE + " (enforce)" in profiles,
        "The registered read-only validator profile must be installed and enforced",
    )
    return ["--security-opt", "apparmor=" + VALIDATOR_PROFILE]


def invoke(argv, timeout, action):
    child = subprocess.run(
        argv,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=timeout,
        env={"PATH": PATH, "LC_ALL": "C", "TZ": "UTC"},
    )
    must(child.returncode == 0, f"Native adoption failed during {action} (exit {child.returncode})")
    return child.stdout


def maps_valid(rows):
    if not isinstance(rows, list) or not rows or rows[0][0] != 0 or rows[0][2] != 1:
        return False
    for i, row in enumerate(rows):
        if (
            len(row) != 3
            or any(type(v) is not int for v in row)
            or row[0] < 0
            or row[1] <= 0
            or row[2] <= 0
            or max(row[:2]) + row[2] > 0xFFFFFFFF
        ):
            return False
        for other in rows[:i]:
            if any(not (other[j] + other[2] <= row[j] or row[j] + row[2] <= other[j]) for j in (0, 1)):
                return False
    return True


def host_to_logical(host, ranges):
    for inside, outside, count in ranges:
        if outside <= host < outside + count:
            return inside + host - outside
    raise ValueError("An owner or named ACL entry cannot be represented by the destination user namespace")


def read_maps(process):
    return {
        name: [[int(v) for v in line.split()] for line in (process / name).read_text().splitlines()]
        for name in ("uid_map", "gid_map")
    }


def engine_identity(binding):
    maps = binding["maps"]
    must(
        set(maps) == {"uid_map", "gid_map"} and all(maps_valid(v) for v in maps.values()),
        "Invalid reviewed rootless maps",
    )
    proc = Path("/proc") / str(binding["enginePid"])
    must(
        type(binding["enginePid"]) is int
        and binding["enginePid"] > 1
        and (proc / "comm").read_text().strip() == "dockerd",
        "The observed rootless Docker process was replaced",
    )
    uid, gid = maps["uid_map"][0][1], maps["gid_map"][0][1]
    status = (proc / "status").read_text()

    def ids(label):
        return [int(v) for v in re.search(r"^" + label + r":([^\n]+)$", status, re.M)[1].split()]

    must(
        read_maps(proc) == maps
        and ids("Uid") == [uid] * 4
        and ids("Gid") == [gid] * 4
        and (proc / "ns/user").stat().st_ino != Path("/proc/self/ns/user").stat().st_ino,
        "The observed Docker user namespace was replaced",
    )
    run = Path("/run/user") / str(uid)
    sock = run / "docker.sock"
    d = run.lstat()
    ss = sock.lstat()
    must(
        run.resolve(strict=True) == run
        and stat.S_ISDIR(d.st_mode)
        and d.st_uid == uid
        and not d.st_mode & 0o022
        and stat.S_ISSOCK(ss.st_mode)
        and ss.st_uid == uid,
        "The socket is outside the reviewed rootless runtime",
    )
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
        probe.settimeout(10)
        probe.connect(str(sock))
        peer_pid, peer_uid, _ = struct.unpack(
            "3i", probe.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
        )
        must(peer_uid == uid, "Rootless Docker peer credentials differ")
        if peer_pid != binding["enginePid"]:
            # A socket activated by the user service manager must still be held by this exact dockerd.
            entries = [line.split(maxsplit=7) for line in (proc / "net/unix").read_text().splitlines()]
            listeners = {
                "socket:[" + v[6] + "]"
                for v in entries
                if len(v) == 8 and v[7] == str(sock) and v[4] == "0001" and int(v[3], 16) & 0x10000
            }
            owned = set()
            for file in (proc / "fd").iterdir():
                try:
                    owned.add(os.readlink(file))
                except FileNotFoundError:
                    pass
            must(
                len(listeners) == 1 and listeners <= owned,
                "The registered dockerd does not own the admitted socket",
            )
    return proc, sock, uid, gid


def docker_client(state, binding):
    _, sock, _, _ = engine_identity(binding)
    cfg = state / "client"
    cfg.mkdir(mode=0o700, exist_ok=True)
    safe_dir(cfg)

    def docker(*argv, timeout=90):
        what = "docker " + (" ".join(argv[:2]) if argv[0] == "volume" else argv[0])
        if "--entrypoint" in argv:
            what += " " + Path(argv[argv.index("--entrypoint") + 1]).name
        return (
            invoke(["docker", "--config", str(cfg), "--host", "unix://" + str(sock), *argv], timeout, what)
            .decode()
            .strip()
        )

    info = json.loads(
        docker("info", "--format", '{"root":{{json .DockerRootDir}},"security":{{json .SecurityOptions}}}')
    )
    data = Path(info["root"])
    must(
        "name=rootless" in info["security"]
        and data.is_absolute()
        and data.resolve(strict=True) == data
        and len(data.parts) > 2
        and data.parts[1] not in ("root", "etc", "proc", "sys", "dev"),
        "Unexpected rootless storage engine",
    )
    return docker, data


def volume_identity(docker, data, name, token):
    fmt = '{"name":{{json .Name}},"driver":{{json .Driver}},"opts":{{json .Options}},"labels":{{json .Labels}},"mount":{{json .Mountpoint}}}'
    v = json.loads(docker("volume", "inspect", "--format", fmt, name))
    p = data / "volumes" / name / "_data"
    must(
        v["name"] == name
        and v["driver"] == "local"
        and not v["opts"]
        and v["labels"].get("org.omnitron.service-adoption") == token
        and v["mount"] == str(p)
        and p.resolve(strict=True) == p
        and stat.S_ISDIR(p.lstat().st_mode),
        "Fresh target volume identity or operation label differs",
    )
    st = p.lstat()
    return p, [str(st.st_dev), str(st.st_ino)]


def unattached(docker, paths):
    for cid in docker("ps", "--all", "--no-trunc", "--quiet").splitlines():
        mounts = (
            json.loads(docker("inspect", "--type", "container", "--format", "{{json .Mounts}}", cid)) or []
        )
        for m in mounts:
            if not m.get("Source"):
                continue
            path = Path(m["Source"]).resolve()
            must(
                all(path != p and path not in p.parents and p not in path.parents for p in paths),
                "A container already references a target volume or a covering bind",
            )


def reserve(mod, seed, binding, state, docker, data, creating):
    token = sha(binding)
    rows = seed["volumes"]
    names = binding["volumes"]
    must(
        names == {r["tag"]: r["volume"] for r in rows},
        "Target volumes must be the six declared service roles and any reviewed PostgreSQL mounts",
    )
    intended = [data / "volumes" / name / "_data" for name in names.values()]
    unattached(docker, intended)
    journal = state / "volumes.json"
    if journal.exists():
        saved = record(journal)
        must(
            saved.get("binding") == token and set(saved["identities"]) <= set(names),
            "Another operation owns the reservation",
        )
    else:
        must(creating, "No target volume reservation exists")
        existing = set(docker("volume", "ls", "--quiet").splitlines())
        must(
            not existing.intersection(names.values()),
            "First admission requires new, unallocated target volume names",
        )
        saved = {"binding": token, "identities": {}}
        mod["ch"].write_record(journal, saved)
    paths = {}
    for tag, name in names.items():
        if tag not in saved["identities"]:
            must(creating, "Target volume reservation is incomplete")
            docker(
                "volume",
                "create",
                "--driver",
                "local",
                "--label",
                "org.omnitron.service-adoption=" + token,
                name,
            )
        path, pin = volume_identity(docker, data, name, token)
        if tag in saved["identities"]:
            must(saved["identities"][tag] == pin, "A reserved rootless volume was replaced")
        else:
            must(not any(path.iterdir()), "A newly reserved volume must be empty")
            saved["identities"][tag] = pin
            mod["ch"].write_record(journal, saved)
        paths[tag] = path
    unattached(docker, paths.values())
    return paths


def enter_namespace(proc, maps, directory):
    fd = os.open(proc / "ns/user", os.O_RDONLY)
    try:
        must(
            read_maps(proc) == maps and os.path.samestat(os.fstat(fd), (proc / "ns/user").stat()),
            "Docker namespace changed",
        )
        os.setgroups([])
        libc = ctypes.CDLL(None, use_errno=True)
        if libc.setns(fd, 0x10000000) != 0:
            raise OSError(ctypes.get_errno(), "Cannot enter the reviewed user namespace")
        os.setresgid(0, 0, 0)
        os.setresuid(0, 0, 0)
        must(
            read_maps(Path("/proc/self")) == maps
            and os.getuid() == os.getgid() == 0
            and not os.getgroups(),
            "Receiver did not enter the exact rootless mappings",
        )
        os.fchdir(directory)
    finally:
        os.close(fd)


def receiver_args(args):
    must(
        len(args) >= 6
        and args[:3] == ["service-local", "rsync", "--server"]
        and "--sender" not in args
        and args[-2:] == [".", "."],
        "Only the local restoring rsync receiver is accepted",
    )
    # The rsync client encodes short transfer options before e. and protocol capabilities after it.
    must(
        re.fullmatch(r"-[nHlogDtprSXAcx]+e\.[A-Za-z0-9]+", args[3]), "Unexpected local rsync transfer flags"
    )
    allowed = {
        "--super",
        "--numeric-ids",
        "--delete-delay",
        "--fsync",
        "--partial-dir=.rsync-partial",
        "--partial-dir",
        ".rsync-partial",
        "--log-format=X",
        "--log-format=%i",
        "--modify-window=-1",
        "--no-devices",
        "--no-specials",
    }
    must(
        all(a in allowed for a in args[4:-2]),
        "Unexpected local rsync receiver option",
    )
    if "--partial-dir" in args:
        must(args[args.index("--partial-dir") + 1] == ".rsync-partial", "Unexpected local resume directory")
    return ["rsync", *args[2:]]


def receive_into_namespace(proc, maps, path, pin, args):
    command = receiver_args(args)
    directory = os.open(path, os.O_DIRECTORY | os.O_RDONLY | os.O_NOFOLLOW)
    try:
        st = os.fstat(directory)
        must(pin == [str(st.st_dev), str(st.st_ino)], "Destination directory changed")
        enter_namespace(proc, maps, directory)
    finally:
        os.close(directory)
    os.execve("/usr/bin/rsync", command, {"PATH": PATH, "LC_ALL": "C"})


def local_receive(op, tag, args):
    must(UUID.fullmatch(op), "Invalid local restore operation")
    root = safe_dir(STATE / op)
    state = safe_dir(root / "adoption")
    seed = record(root / "spec.json")
    binding = record(state / "binding.json")
    checked_grant(seed, binding)
    must(
        seed["id"] == op
        and binding["spec"] == sha(seed)
        and tag in binding["volumes"]
        and hashlib.sha256(read_file(state / "adopt.py")).hexdigest()
        == record(state / "tool.json")["sha256"],
        "Foreign restore worker",
    )
    docker, data = docker_client(state, binding)
    path, pin = volume_identity(docker, data, binding["volumes"][tag], sha(binding))
    must(
        record(state / "volumes.json")["identities"][tag] == pin,
        "Volume was replaced before namespace entry",
    )
    proc = engine_identity(binding)[0]
    receive_into_namespace(proc, binding["maps"], path, pin, args)


def sync_tree(state, seed, binding, root, tag, check):
    import selectors

    transport = shlex.join(["/usr/bin/python3", "-I", str(state / "adopt.py"), "_receive", seed["id"], tag])
    args = [
        "/usr/bin/rsync",
        "-aHAXSx",
        "--numeric-ids",
        "--fake-super",
        "--munge-links",
        "--checksum",
        "--fsync",
        "--no-devices",
        "--no-specials",
        "--delete-delay",
        "--partial-dir=.rsync-partial",
        "-M--modify-window=-1",
        "-e",
        transport,
    ]
    if check:
        args += ["--dry-run", "--itemize-changes", "--out-format=%i"]
    args += ["--", str(root) + "/", "service-local:."]
    lease = checked_grant(seed, binding)
    child = subprocess.Popen(
        args,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        env={"PATH": PATH, "LC_ALL": "C"},
    )
    changed = False
    try:
        observed = 0
        with selectors.DefaultSelector() as poll:
            poll.register(child.stdout, selectors.EVENT_READ)
            while True:
                must(time.time() < lease["expires"], "Local adoption approval expired")
                if time.monotonic() >= observed:
                    must(checked_grant(seed, binding) == lease, "Local adoption approval changed")
                    observed = time.monotonic() + 2
                if not poll.select(0.5):
                    continue
                data = os.read(child.stdout.fileno(), 65536)
                if not data:
                    break
                changed = True
        code = child.wait(timeout=10)
        must(
            code == 0 and not (check and changed),
            "Native ownership, ACL, xattr or data restore differs for "
            + tag
            + " (rsync "
            + str(code)
            + ")",
        )
    finally:
        child.stdout.close()
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL)
        child.wait()


def logical_acl(raw, maps):
    must(
        len(raw) >= 4 and (len(raw) - 4) % 8 == 0 and struct.unpack_from("<I", raw)[0] == 2,
        "Invalid Linux POSIX ACL",
    )
    result = []
    for kind, mode, identifier in struct.iter_unpack("<HHI", raw[4:]):
        must(kind in (1, 2, 4, 8, 16, 32) and mode <= 7, "Unknown POSIX ACL entry")
        if kind in (2, 8):
            identifier = host_to_logical(identifier, maps["uid_map" if kind == 2 else "gid_map"])
        else:
            must(identifier == 0xFFFFFFFF, "Invalid unnamed ACL identity")
        result.append([kind, mode, identifier])
    return result


def metadata(root, maps, writers=frozenset()):
    audit = hashlib.sha256()

    def visit(path, name, device):
        st = path.lstat()
        must(st.st_dev == device, "Nested destination filesystem")
        must((st.st_dev, st.st_ino) not in writers, "A decoded target has an active native writer")
        uid = host_to_logical(st.st_uid, maps["uid_map"])
        gid = host_to_logical(st.st_gid, maps["gid_map"])
        attrs = {}
        for key in sorted(os.listxattr(path, follow_symlinks=False)):
            must(not key.startswith("user.rsync.%"), "Decoded file retained rsync backup metadata")
            value = os.getxattr(path, key, follow_symlinks=False)
            attrs[key] = (
                logical_acl(value, maps)
                if key in ("system.posix_acl_access", "system.posix_acl_default")
                else hashlib.sha256(value).hexdigest()
            )
        audit.update(
            os.fsencode(name) + b"\0" + bytes.fromhex(sha([uid, gid, st.st_mode, st.st_mtime_ns, attrs]))
        )
        if stat.S_ISDIR(st.st_mode):
            for entry in sorted(os.listdir(path), key=os.fsencode):
                visit(path / entry, name + "/" + entry, device)

    visit(root, "", root.lstat().st_dev)
    return audit.hexdigest()


def validate_services(seed, binding, paths, docker, security):
    rows = {r["tag"]: r for r in seed["volumes"]}

    def tool(tag, command, *args, work=None):
        st = paths[tag].stat()
        uid = host_to_logical(st.st_uid, binding["maps"]["uid_map"])
        gid = host_to_logical(st.st_gid, binding["maps"]["gid_map"])
        return docker(
            "run",
            "--rm",
            "--pull",
            "never",
            "--network",
            "none",
            "--read-only",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            *security,
            "--user",
            f"{uid}:{gid}",
            *(["--tmpfs", "/data:ro,nosuid,nodev,noexec,size=4096,mode=0555"] if work else []),
            "--env",
            "LC_ALL=C",
            "--mount",
            "type=bind,source=" + str(work) + ",target=/work"
            if work is not None
            else "type=volume,source=" + binding["volumes"][tag] + ",target=/input,readonly",
            "--entrypoint",
            command,
            rows[tag]["image"],
            *args,
            timeout=21600,
        )

    clusters = {}
    for tag, kind, version, command in [
        ("postgres-data", "postgres", "17", "pg_controldata"),
        ("nominatim-data", "nominatim", "14", "/usr/lib/postgresql/14/bin/pg_controldata"),
    ]:
        root = paths[tag]
        must(
            (root / "PG_VERSION").read_text().strip() == version
            and not os.path.lexists(root / "postmaster.pid"),
            "Unclean PostgreSQL data directory",
        )
        control = tool(tag, command, "/input")
        system = re.search(r"^Database system identifier:\s*([0-9]+)\s*$", control, re.M)
        redo = re.search(r"^Latest checkpoint's REDO WAL file:\s*([A-F0-9]{24})\s*$", control, re.M)
        size = re.search(r"^Bytes per WAL segment:\s*([0-9]+)\s*$", control, re.M)
        must(
            system
            and system[1] == seed["clusters"][kind]
            and re.search(r"^Database cluster state:\s*shut down\s*$", control, re.M)
            and redo
            and size,
            "Decoded PostgreSQL identity, shutdown or checkpoint differs",
        )
        wal = paths.get(kind + "-wal", root / "pg_wal") / redo[1]
        w = wal.lstat()
        must(stat.S_ISREG(w.st_mode) and w.st_size == int(size[1]), "Incomplete final checkpoint WAL")
        clusters[kind] = system[1]
    must(
        (paths["nominatim-flatnode"] / "flatnode.file").is_file()
        and (paths["nominatim-data"] / "import-finished").is_file()
        and (paths["minio-data"] / ".minio.sys" / "format.json").is_file(),
        "Missing Nominatim flatnode/import or MinIO layout",
    )
    redis = paths["redis-data"]
    available = [
        p for p in [redis / "dump.rdb", redis / "appendonly.aof", *redis.glob("*/*.manifest")] if p.exists()
    ]
    must(available, "No decoded Redis persistence")
    for p in available:
        must(stat.S_ISREG(p.lstat().st_mode), "Unexpected Redis persistence file type")
        if p.name == "dump.rdb":
            tool("redis-data", "redis-check-rdb", "/input/dump.rdb")
        else:
            from redis_aof import check_copy

            check_copy(
                redis,
                p.relative_to(redis),
                binding["maps"]["gid_map"][0][1],
                lambda work, name: tool("redis-data", "redis-check-aof", "/work/" + name, work=work),
            )
    return clusters


def evidence(seed, binding, cold, sealed, mod, root):
    mod["validate_scope"](seed)
    kinds = {r["tag"] for r in seed["volumes"]}
    must(
        binding["schema"] == 1
        and binding["seed"] == seed["id"]
        and binding["spec"] == sha(seed)
        and set(binding["donorMaps"]) == kinds
        and all(v == {"uid_map": IDENTITY, "gid_map": IDENTITY} for v in binding["donorMaps"].values()),
        "A complete identity-mapped donor is required",
    )
    must(
        record(root / "spec.json") == seed
        and record(root / "sealed.json") == sealed
        and sealed["sealed"] is True
        and sealed["id"] == seed["id"] == cold["id"]
        and sealed["stop"] == cold["stop"]
        and sealed["spec"] == cold["spec"] == sha(seed)
        and sealed["sha256"] == cold["sha256"] == sha(cold["trees"])
        and set(cold["trees"]) == kinds
        and mod["closed"](root),
        "The receiver has not sealed this exact fenced data set",
    )
    channel = mod["ch"]
    must(
        channel.fingerprint(channel.key_text(channel.HOST_KEY)) == seed["receiverFingerprint"],
        "Receiver SSH host changed",
    )
    stage = mod["stage_identity"](seed, mod["local_record"](root, "receiver.json"))
    st = stage.lstat()
    must(
        sealed["stage"] == str(stage) and stat.S_IMODE(st.st_mode) == 0o700 and st.st_uid == 0,
        "The sealed stage is open or replaced",
    )
    observed = record(root / "observed.json")
    must(
        observed["stop"] == cold["stop"]
        and observed["cold"] == cold["sha256"]
        and observed["snapshot"] == mod["stage_stamp"](stage, seed["volumes"]),
        "The sealed stage changed after its checksum audit",
    )
    return stage


def perform(phase, seed, binding, cold, sealed, digest, profile_sha, program):
    must(
        sys.platform == "linux"
        and os.geteuid() == 0
        and phase in ("restore", "verify")
        and UUID.fullmatch(seed["id"]),
        "Registered Linux receiver administration is required",
    )
    root = safe_dir(STATE / seed["id"])
    security = validator_security(checked_grant(seed, binding), profile_sha)
    mod = load_checked_seed(root, digest)
    stage = evidence(seed, binding, cold, sealed, mod, root)
    channel = mod["ch"]
    state = root / "adoption"
    state.mkdir(mode=0o700, exist_ok=True)
    safe_dir(state)
    with channel.lock(state / "operation.lock", True):
        for file, value in [
            ("binding.json", binding),
            ("tool.json", {"sha256": hashlib.sha256(program).hexdigest()}),
        ]:
            if (state / file).exists():
                must(
                    record(state / file) == value,
                    "A different binding or worker already owns this adoption",
                )
            elif phase == "restore":
                channel.write_record(state / file, value)
            else:
                raise ValueError("No matching restore journal")
        if not os.path.lexists(state / "adopt.py"):
            must(phase == "restore", "No installed restore worker")
            channel.write_file(state / "adopt.py", program, 0o500)
        must(read_file(state / "adopt.py") == program, "The installed local receiver differs")
        docker, data = docker_client(state, binding)
        paths = reserve(mod, seed, binding, state, docker, data, phase == "restore")
        mark = {
            "seed": seed["id"],
            "binding": sha(binding),
            "stop": cold["stop"],
            "sha256": cold["sha256"],
            "identities": record(state / "volumes.json")["identities"],
        }
        if phase == "verify":
            must(record(state / "restored.json") == mark, "The exact restored volume set is required")
        else:
            must(
                not (state / "verified.json").exists(),
                "The verified target volumes are closed to restoration",
            )
        logical = {}
        stamps = (
            {tag: mod["stage_stamp"](p.parent, [{"tag": p.name}]) for tag, p in paths.items()}
            if phase == "verify"
            else {}
        )
        writers = channel.open_writers() if phase == "verify" else set()
        for row in seed["volumes"]:
            tag = row["tag"]
            target = paths[tag]
            checked_grant(seed, binding)
            unattached(docker, paths.values())
            sync_tree(state, seed, binding, stage / tag, tag, phase == "verify")
            if phase == "verify":
                must(
                    mod["inventory"](target, row, seed["volumes"], writers=writers) == cold["trees"][tag],
                    "Decoded target bytes or topology differ for " + tag,
                )
                logical[tag] = metadata(target, binding["maps"], writers)
        result = dict(mark)
        if phase == "verify":
            result.update(
                verified=True,
                metadata=logical,
                clusters=validate_services(seed, binding, paths, docker, security),
                validatorProfileSha256=profile_sha,
            )
        evidence(seed, binding, cold, sealed, mod, root)
        validator_security(checked_grant(seed, binding), profile_sha)
        rechecked, config = docker_client(state, binding)
        must(
            config == data and reserve(mod, seed, binding, state, rechecked, data, False) == paths,
            "Target engine or physical data tree changed",
        )
        if phase == "verify":
            must(
                all(
                    mod["stage_stamp"](p.parent, [{"tag": p.name}]) == stamps[tag]
                    for tag, p in paths.items()
                ),
                "Target content or metadata changed across the native schema and ownership checks",
            )
        channel.write_record(state / ("verified.json" if phase == "verify" else "restored.json"), result)
        return {**result, "volumes": binding["volumes"], "restored": True}


def main():
    os.umask(0o077)
    must(sys.platform == "linux" and os.geteuid() == 0, "Linux receiver administration is required")
    if sys.argv[1] == "_receive":
        local_receive(sys.argv[2], sys.argv[3], sys.argv[4:])
    else:
        values = json.loads(gzip.decompress(base64.b64decode(sys.argv[2], validate=True)))
        program = globals().get("SELF")
        must(isinstance(program, bytes), "Use the reviewed adoption Pipeline")
        print(json.dumps(perform(sys.argv[1], *values, program), separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except ValueError as error:
        sys.exit(str(error))
    except Exception as error:
        sys.exit("Rootless adoption stopped (" + type(error).__name__ + ")")
