"""Run Redis's read-write-open AOF checker on an independent, memory-backed copy."""

import hashlib
import os
from pathlib import Path
import stat
import tempfile


def ensure(condition, message):
    if not condition:
        raise ValueError(message)


def signature(st):
    return (st.st_dev, st.st_ino, st.st_mode, st.st_size, st.st_mtime_ns, st.st_ctime_ns)


def file_hash(path):
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as f:
        digest = hashlib.sha256()
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
        return digest.digest()


def memory_available():
    available = next(
        int(line.split()[1]) * 1024
        for line in Path("/proc/meminfo").read_text().splitlines()
        if line.startswith("MemAvailable:")
    )
    for line in Path("/proc/self/cgroup").read_text().splitlines():
        _, controllers, name = line.split(":", 2)
        if controllers and "memory" not in controllers.split(","):
            continue
        base = Path("/sys/fs/cgroup") if not controllers else Path("/sys/fs/cgroup/memory")
        relative = Path(name.lstrip("/"))
        ensure(".." not in relative.parts, "Unresolvable memory cgroup")
        current = base / relative
        ensure(current.is_dir(), "The validator's memory cgroup must be observable")
        limits = ("memory.max", "memory.high") if not controllers else ("memory.limit_in_bytes",)
        usage = "memory.current" if not controllers else "memory.usage_in_bytes"
        for group in (current, *current.parents):
            for filename in limits:
                limit = group / filename
                if limit.is_file():
                    value = limit.read_text().strip()
                    if value != "max":
                        available = min(available, max(0, int(value) - int((group / usage).read_text())))
            if group == base:
                break
    return available


def capacity(shm, remaining, reserve):
    free = os.statvfs(shm)
    mem = memory_available()
    space = free.f_bavail * free.f_frsize
    ensure(
        remaining <= space and remaining + reserve <= mem,
        f"Insufficient Redis AOF scratch: {remaining} bytes pending, {space} bytes free in tmpfs, "
        f"{mem} bytes available within host/cgroup limits, {reserve} bytes reserved",
    )


def check_copy(root, relative, daemon_gid, validate):
    file = root / relative
    ensure(
        not Path(relative).is_absolute()
        and ".." not in Path(relative).parts
        and file.resolve(strict=True) == file
        and root.resolve(strict=True) == root,
        "Invalid cold Redis AOF path",
    )
    before_dir = signature(file.parent.stat())
    if file.name.endswith(".manifest"):
        members = sorted(
            (p for p in file.parent.iterdir() if stat.S_ISREG(p.lstat().st_mode)), key=os.fsencode
        )
    else:
        ensure(file == root / "appendonly.aof", "Unexpected single Redis AOF")
        members = [file]
    recorded = {p: signature(p.lstat()) for p in members}
    ensure(
        file in recorded
        and all(stat.S_ISREG(s[2]) and s[0] == root.stat().st_dev for s in recorded.values()),
        "The Redis manifest and its segments must be native regular files",
    )
    shm = Path("/dev/shm")
    ensure(
        shm.resolve(strict=True) == shm
        and any(
            line.split()[4] == "/dev/shm" and line.split(" - ", 1)[1].split()[0] == "tmpfs"
            for line in Path("/proc/self/mountinfo").read_text().splitlines()
        ),
        "A native memory-backed scratch filesystem is required",
    )
    page = os.sysconf("SC_PAGESIZE")
    required = sum(((s[3] + page - 1) // page + 1) * page for s in recorded.values()) + 4 * page
    reserve = max(512 * 1024**2, required)
    capacity(shm, required, reserve)
    ensure(os.statvfs(shm).f_favail >= len(members) + 2, "Insufficient inodes in Redis AOF scratch")
    uid, gid = root.stat().st_uid, root.stat().st_gid
    with tempfile.TemporaryDirectory(dir=shm, prefix="omnitron-redis-verify-") as temporary:
        parent = Path(temporary)
        os.chown(parent, 0, daemon_gid)
        parent.chmod(0o710)
        work = parent / "data"
        work.mkdir(mode=0o700)
        sums = {}
        copied = 0
        next_check = 0
        for p, s in recorded.items():
            dst = work / p.name
            fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, "rb") as source, dst.open("xb") as output:
                ensure(signature(os.fstat(source.fileno())) == s, "Redis AOF member changed before copying")
                digest = hashlib.sha256()
                left = s[3]
                while left:
                    if copied >= next_check:
                        capacity(shm, required - copied, reserve)
                        next_check = copied + 16 * 1024**2
                    chunk = source.read(min(1024 * 1024, left))
                    ensure(chunk, "Redis AOF member became shorter during copying")
                    output.write(chunk)
                    digest.update(chunk)
                    copied += len(chunk)
                    left -= len(chunk)
                ensure(source.read(1) == b"", "Redis AOF member grew during copying")
                output.flush()
                ensure(
                    signature(os.fstat(source.fileno())) == s
                    and not os.path.samestat(os.fstat(source.fileno()), os.fstat(output.fileno())),
                    "Redis AOF member changed or shares its source inode",
                )
                os.fchown(output.fileno(), uid, gid)
                os.fchmod(output.fileno(), 0o600)
                sums[p.name] = digest.digest()
        os.chown(work, uid, gid)
        result = validate(work, file.name)
        ensure(
            set(os.listdir(work)) == set(sums)
            and all(file_hash(work / name) == v for name, v in sums.items()),
            "Redis validator changed the independent working files",
        )
        ensure(
            signature(file.parent.stat()) == before_dir
            and all(signature(p.lstat()) == s for p, s in recorded.items()),
            "Canonical Redis AOF or its directory changed during validation",
        )
        return result
