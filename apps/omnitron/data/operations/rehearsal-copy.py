"""Materialize a reviewed pair inside a root-only directory. Called under the native adoption lock."""
import errno
import fcntl
import hashlib
import os
from pathlib import Path
import re
import stat
import tempfile


ROOT = Path("/var/lib/omnitron-release-rehearsals")
TAGS = ("postgres-data", "minio-data")
DIR = os.O_DIRECTORY | os.O_RDONLY | os.O_NOFOLLOW
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")


class RehearsalRefusal(ValueError):
    pass


def require(value, reason):
    if not value:
        raise RehearsalRefusal(reason)


def private_dir(path):
    st = path.lstat()
    require(stat.S_ISDIR(st.st_mode) and (st.st_uid, st.st_gid, stat.S_IMODE(st.st_mode)) == (0, 0, 0o700),
            "A protected rehearsal directory is required")


def signature(st):
    return st.st_dev, st.st_ino, st.st_mode, st.st_nlink, st.st_mtime_ns, st.st_ctime_ns, st.st_size


def copy_bytes(source, target, length):
    # Preserve sparse extents on ordinary Linux filesystems. Reflinks also give the two copies distinct inodes.
    try:
        fcntl.ioctl(target, 0x40049409, source)  # Linux FICLONE
        return
    except OSError as exc:
        if exc.errno not in (errno.EOPNOTSUPP, errno.EXDEV, errno.EINVAL, errno.ENOTTY):
            raise
    with os.fdopen(os.dup(source), "rb", buffering=0) as reader, os.fdopen(os.dup(target), "wb", buffering=0) as writer:
        offset = 0
        while offset < length:
            try:
                start = os.lseek(source, offset, os.SEEK_DATA)
                end = min(os.lseek(source, start, os.SEEK_HOLE), length)
            except OSError as exc:
                if exc.errno == errno.ENXIO:
                    break
                if exc.errno not in (errno.EINVAL, errno.EOPNOTSUPP):
                    raise
                start, end = offset, length
            require(offset <= start < end, "Invalid data extent")
            reader.seek(start)
            writer.seek(start)
            remaining = end - start
            while remaining:
                block = reader.read(min(remaining, 1024 * 1024))
                require(block, "Source file changed during copying")
                if block.count(0) == len(block):
                    writer.seek(len(block), 1)
                else:
                    view = memoryview(block)
                    while view:
                        written = writer.write(view)
                        require(written, "Incomplete scratch write")
                        view = view[written:]
                remaining -= len(block)
            offset = end
        writer.truncate(length)


def attributes(source, target, st):
    os.fchown(target, st.st_uid, st.st_gid)
    os.fchmod(target, stat.S_IMODE(st.st_mode))
    wanted = set(os.listxattr(source))
    for name in set(os.listxattr(target)) - wanted:
        os.removexattr(target, name)
    for name in wanted:
        os.setxattr(target, name, os.getxattr(source, name))
    os.utime(target, ns=(st.st_atime_ns, st.st_mtime_ns))
    os.fsync(target)


def already_copied(source, destination, st):
    # On retry, trust an existing file only after reopening both contents and metadata.
    # Never change the attributes of an inode we have not just created.
    try:
        target = os.open(destination, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return False
    try:
        other = os.fstat(target)
        require(stat.S_ISREG(other.st_mode) and not os.path.samestat(st, other), "Unrecognized scratch entry")
        attrs = lambda fd: {name: os.getxattr(fd, name) for name in os.listxattr(fd)}
        facts = lambda s: (s.st_size, s.st_mode, s.st_uid, s.st_gid, s.st_mtime_ns)
        if facts(other) != facts(st) or attrs(source) != attrs(target):
            return False
        def digest(fd):
            with os.fdopen(os.dup(fd), "rb") as reader:
                reader.seek(0)
                check = hashlib.sha256()
                for block in iter(lambda: reader.read(1024 * 1024), b""):
                    check.update(block)
                reader.seek(0)
                return check.digest()
        return digest(target) == digest(source) and signature(other) == signature(os.fstat(target))
    finally:
        os.close(target)


def copy_tree(root, dest, work):
    # Atomically replace only our unpublished scratch files. A process exit leaves a resumable reservation.
    aliases = {}
    def visit(src, dst):
        before = os.fstat(src)
        for name in sorted(os.listdir(src), key=os.fsencode):
            st = os.stat(name, dir_fd=src, follow_symlinks=False)
            require(st.st_dev == before.st_dev, "A nested data mount requires its own rehearsal")
            if stat.S_ISDIR(st.st_mode):
                child = os.open(name, DIR, dir_fd=src)
                try:
                    require(os.path.samestat(st, os.fstat(child)), "Source directory changed")
                    dst_child = dst / name
                    dst_child.mkdir(mode=0o700, exist_ok=True)
                    require(stat.S_ISDIR(dst_child.lstat().st_mode), "Scratch directory was replaced")
                    visit(child, dst_child)
                finally:
                    os.close(child)
            else:
                require(stat.S_ISREG(st.st_mode), "This rehearsal requires regular service data without external links")
                child = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=src)
                try:
                    require(signature(st) == signature(os.fstat(child)), "Source file changed")
                    if work.exists():
                        work.unlink()
                    first = aliases.get((st.st_dev, st.st_ino))
                    if first is not None:
                        os.link(first, work, follow_symlinks=False)
                    elif already_copied(child, dst / name, st):
                        require(signature(st) == signature(os.fstat(child)), "Source changed during resume")
                        if st.st_nlink > 1:
                            aliases[(st.st_dev, st.st_ino)] = dst / name
                        continue
                    else:
                        target = os.open(work, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                        try:
                            copy_bytes(child, target, st.st_size)
                            attributes(child, target, st)
                        finally:
                            os.close(target)
                        if st.st_nlink > 1:
                            aliases[(st.st_dev, st.st_ino)] = dst / name
                    require(signature(st) == signature(os.fstat(child)), "Source file changed during copying")
                    os.replace(work, dst / name)
                    # Replacing two hard links to the same scratch inode is a no-op on Linux.
                    if work.exists():
                        work.unlink()
                finally:
                    os.close(child)
        require(signature(before) == signature(os.fstat(src)), "Source directory changed during copying")
        target = os.open(dst, DIR)
        try:
            attributes(src, target, before)
        finally:
            os.close(target)
    source = os.open(root, DIR)
    try:
        visit(source, dest)
    finally:
        os.close(source)


def mounts():
    for line in Path("/proc/self/mountinfo").read_text().splitlines():
        fields = line.split()
        decode = lambda value: re.sub(r"\\([0-7]{3})", lambda match: chr(int(match[1], 8)), value)
        point = Path(decode(fields[4]))
        yield point, fields[2], Path(decode(fields[3]))


def mount_location(path):
    # mountinfo's root plus the path within the mount also identifies bind aliases.
    parts = [(len(point.parts), device, base / path.relative_to(point)) for point, device, base in mounts()
             if path.is_relative_to(point)]
    require(parts, "Cannot identify physical mount")
    _, device, address = max(parts, key=lambda item: item[0])
    return device, address


def check_private_mounts(operation, paths):
    op_device, op_location = mount_location(operation)
    for point, mount_device, mount_root in mounts():
        require(not point.is_relative_to(operation) and not (mount_device == op_device and mount_root.is_relative_to(op_location)),
                "A foreign mount exposes or overlays private rehearsal data")
        require(not any(point != paths[tag] and point.is_relative_to(paths[tag]) for tag in TAGS),
                "A separate mount below a reviewed source requires its own rehearsal")


def prepare_working_pair(plan, mod, native, seed, binding, verified, paths, observed, verify_current, state, root=ROOT, previous_receipt=None):
    ch = mod["ch"]
    require(os.geteuid() == 0 and UUID.fullmatch(plan["operationId"]) and UUID.fullmatch(plan["verifyRunId"]) and plan["protocol"] == 1
            and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,254}", plan["release"]) and ".." not in plan["release"]
            and all(re.fullmatch(r"[a-f0-9]{64}", plan[k]) for k in ("manifestSha256", "prepared", "selectionDigest", "ownerDigest", "proofDigest"))
            and type(plan["sourceRevision"]) is int and plan["sourceRevision"] >= 0
            and plan["seed"] == seed["id"] and plan["sourceStop"] == verified["stop"] and plan["receiver"]["nodeId"] == seed["receiverNode"]
            and plan["receiver"]["host"] == seed["receiverIp"] and plan["receiver"]["fingerprint"] == seed["receiverFingerprint"]
            and (plan["project"], plan["stack"]) == (seed["project"], seed["stack"])
            and plan["digest"] == native["sha"]({k: v for k, v in plan.items() if k != "digest"}), "Invalid rehearsal binding")
    rows = {row["tag"]: row for row in seed["volumes"]}
    expected = {row["tag"]: row for row in plan["volumes"]}
    require(set(expected) == set(TAGS) and len(plan["volumes"]) == len(TAGS) and not any(
        tag.startswith("postgres-") and tag != "postgres-data" for tag in rows), "Only a self-contained primary PostgreSQL and MinIO pair is supported")
    require(type(plan["logicalBytes"]) is int and plan["logicalBytes"] == sum(expected[tag]["bytes"] for tag in TAGS),
            "Reviewed rehearsal size differs")
    for tag in TAGS:
        fact, st = expected[tag], paths[tag].lstat()
        require(stat.S_ISDIR(st.st_mode) and fact["receiver"] == {"device": str(st.st_dev), "inode": str(st.st_ino)}
                and fact["receiverGeneration"] == observed["generation"][tag] and fact["volume"] == binding["volumes"][tag]
                and fact["source"] == {key: rows[tag][key] for key in ("device", "inode")}
                and fact["metadataSha256"] == verified["metadata"][tag],
                "Reviewed receiver volume identity changed")
    ch.physical(root.parent, True)
    ch.physical(state, True)
    def independent(one, two):
        device, location = mount_location(one)
        other, address = mount_location(two)
        return device != other or not (location.is_relative_to(address) or address.is_relative_to(location))
    require(independent(state, root) and all(independent(root, src) and independent(state, src) for src in paths.values()),
            "Rehearsal storage overlaps a protected service volume or its administrative journal")
    ledger = state / "rehearsals"
    if previous_receipt is None:
        ledger.mkdir(mode=0o700, exist_ok=True)
        ch.sync_directory(state)
    private_dir(ledger)
    entry = ledger / (plan["operationId"] + ".json")
    previous = native["record"](entry) if entry.exists() else None
    require(not entry.exists() or isinstance(previous, dict), "Unknown native rehearsal reservation")
    if previous_receipt is not None:
        require(previous and previous.get("receipt") == previous_receipt, "The recorded controller receipt could not be reopened")
    def identity(path):
        st = path.lstat()
        return [str(st.st_dev), str(st.st_ino)]
    if previous is not None:
        require(previous.get("review") == plan["digest"] and root.exists() and previous["root"] == identity(root),
                "The reviewed scratch filesystem or original intent changed")
    root.mkdir(mode=0o700, exist_ok=True)
    private_dir(root)
    operation = root / plan["operationId"]
    check_private_mounts(operation, paths)
    # Publishing the initial intent is serialized even with two controllers.
    with ch.lock(root / ".reservations", create=True):
        if not operation.exists():
            require(previous is None, "The reserved rehearsal directory was removed")
            pending = Path(tempfile.mkdtemp(prefix=".reservation-", dir=root))
            ch.write_record(pending / "binding.json", plan)
            os.rename(pending, operation)
            ch.sync_directory(root)
    private_dir(operation)
    with ch.lock(operation / "copy.lock", create=True):
        check_private_mounts(operation, paths)
        require(native["record"](operation / "binding.json") == plan, "Another review owns this operation")
        pin = {"review": plan["digest"], "root": identity(root), "operation": identity(operation)}
        if previous is None:
            require(set(os.listdir(operation)) <= {"binding.json", "copy.lock"}, "Missing native reservation for existing private data")
            ch.write_record(entry, pin)
        else:
            require(all(previous.get(k) == v for k, v in pin.items()), "The original private rehearsal reservation changed")
        volumes = operation / "volumes"
        receipt = operation / "prepared.json"
        saved = native["record"](receipt) if receipt.exists() else None
        if previous and "receipt" in previous:
            require(saved == previous["receipt"], "The published scratch receipt was removed or replaced")
        require(not receipt.exists() or isinstance(saved, dict) and saved.get("review") == plan["digest"], "Unknown prior scratch receipt")
        if saved is None and not volumes.exists():
            st = os.statvfs(operation)
            require(st.f_bavail * st.f_frsize >= plan["logicalBytes"], "Insufficient scratch capacity for the reviewed logical bytes")
            volumes.mkdir(mode=0o700)
        private_dir(volumes)
        copies = []
        for tag in TAGS:
            dest = volumes / tag
            if saved is None:
                dest.mkdir(mode=0o700, exist_ok=True)
            require(stat.S_ISDIR(dest.lstat().st_mode) and not os.path.samestat(dest.lstat(), paths[tag].lstat()), "Scratch volume aliases its original")
            if saved is None:
                copy_tree(paths[tag], dest, operation / ".partial")
            fact = expected[tag]
            tree = mod["inventory"](dest, rows[tag], seed["volumes"], writers=ch.open_writers())
            require(tree == {k: fact[k] for k in ("files", "bytes", "sha256")}
                    and native["metadata"](dest, binding["maps"]) == fact["metadataSha256"], "Private rehearsal contents or metadata differ")
            inode = dest.lstat()
            copies.append({"tag": tag, "device": str(inode.st_dev), "inode": str(inode.st_ino),
                           "generation": mod["stage_stamp"](volumes, [{"tag": tag}])})
        result = {"operationId": plan["operationId"], "review": plan["digest"], "copies": copies}
        require(saved is None or result == saved, "Prepared rehearsal data changed; an existing rehearsal cannot be overwritten")
        verify_current()
        check_private_mounts(operation, paths)
        require(all(copy["generation"] == mod["stage_stamp"](volumes, [{"tag": copy["tag"]}]) for copy in copies),
                "Private rehearsal data changed during final verification")
        if saved is None:
            ch.sync_directory(volumes)
            ch.write_record(receipt, result)
        if not previous or "receipt" not in previous:
            ch.write_record(entry, {**pin, "receipt": result})
        return result
