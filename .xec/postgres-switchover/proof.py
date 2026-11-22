"""Native PostgreSQL witnesses for a physical, pre-write switchover."""
import array
import fcntl
import hashlib
import os
import re
import stat


def require(condition, message):
    if not condition:
        raise ValueError(message)


def lsn(text):
    require(isinstance(text, str) and re.fullmatch(r"[0-9A-F]{1,8}/[0-9A-F]{1,8}", text), "Invalid WAL position")
    high, low = text.split("/")
    return (int(high, 16) << 32) | int(low, 16)


def system_id(value):
    require(isinstance(value, str) and re.fullmatch(r"[1-9][0-9]{0,19}", value)
            and int(value) < 2**64, "Invalid PostgreSQL system identifier")
    return value


def control_fields(text):
    return {key: value.strip() for line in text.splitlines() if ":" in line
            for key, value in [line.split(":", 1)]}


def terminal(control, record):
    fields = control_fields(control)
    require(fields.get("Database cluster state") == "shut down", "The source requires a clean primary shutdown")
    identifier = system_id(fields.get("Database system identifier"))
    position = fields["Latest checkpoint location"]
    timeline = int(fields["Latest checkpoint's TimeLineID"])
    match = re.fullmatch(
        r"rmgr:\s*XLOG\s+len \(rec/tot\):[^\n]+?\blsn:\s*([0-9A-F]+/[0-9A-F]+),[^\n]*?"
        r"\bdesc:\s*CHECKPOINT_SHUTDOWN\b[^\n]*?\btli (\d+);[^\n]+", record.strip()
    )
    require(match and lsn(match[1]) == lsn(position) and int(match[2]) == timeline and 0 < timeline < 2**32,
            "Native WAL does not identify the terminal shutdown checkpoint on the source timeline")
    return {"systemIdentifier": identifier, "timeline": timeline, "shutdownCheckpointLsn": position}


def identity(reply):
    fields = reply.strip().split("|")
    require(len(fields) == 4 and fields[3] == "" and fields[1].isdecimal(),
            "Expected one native physical IDENTIFY_SYSTEM result")
    identifier = system_id(fields[0])
    timeline = int(fields[1])
    require(0 < timeline < 2**32 and lsn(fields[2]) > 0, "Invalid native timeline or WAL position")
    return {"systemIdentifier": identifier, "timeline": timeline, "lsn": fields[2]}


def applied(stop, identify_reply, in_recovery):
    peer = identity(identify_reply)
    require(in_recovery is True and stop["systemIdentifier"] == peer["systemIdentifier"]
            and stop["timeline"] == peer["timeline"]
            and lsn(peer["lsn"]) > lsn(stop["shutdownCheckpointLsn"]),
            "The isolated standby has not replayed the terminal checkpoint on the fenced source timeline")
    return peer


def promoted(before, identify_reply, in_recovery, history):
    peer = identity(identify_reply)
    rows = [line.split(None, 2) for line in history.splitlines() if line.strip() and not line.lstrip().startswith("#")]
    require(in_recovery is False and before["systemIdentifier"] == peer["systemIdentifier"]
            and before["timeline"] < peer["timeline"] and rows and len(rows[-1]) >= 2
            and rows[-1][0] == str(before["timeline"]) and lsn(before["lsn"]) <= lsn(rows[-1][1]) <= lsn(peer["lsn"]),
            "The private primary must descend directly from the witnessed standby at or beyond its replay point")
    return {**peer, "forkLsn": rows[-1][1]}


def file_digest(root, name, maximum):
    fd = os.open(root / name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        st = os.fstat(fd)
        require(stat.S_ISREG(st.st_mode) and st.st_nlink == 1 and st.st_size <= maximum,
                "Invalid native PostgreSQL evidence file")
        digest = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
        end = os.fstat(fd)
        require((end.st_dev, end.st_ino, end.st_ctime_ns, end.st_size) ==
                (st.st_dev, st.st_ino, st.st_ctime_ns, st.st_size), "Native PostgreSQL evidence changed during the read")
    return {"sha256": digest.hexdigest(), "bytes": st.st_size}


def inode_flags(fd):
    # Linux FS_IOC_{GET,SET}FLAGS encodes the native sizeof(long).
    size = array.array("l").itemsize
    value = array.array("l", [0])
    fcntl.ioctl(fd, 0x80006601 | (size << 16), value)
    return value[0]


IMMUTABLE = 0x10
