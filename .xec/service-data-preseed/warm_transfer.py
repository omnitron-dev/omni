"""Observe a registered warm rsync and bound its inactivity to the reviewed budget and both grants."""

import base64
from collections import Counter
import gzip
import json
import re
import sys
import threading
import time


ERRORS = {
    "timed-out": rb"timed? ?out|timeout in data send/receive|I/O timeout",
    "no-space": rb"No space left on device|Disk quota exceeded",
    "connection-reset": rb"Connection reset by peer|connection unexpectedly closed",
    "broken-pipe": rb"Broken pipe",
    "source-vanished": rb"file has vanished|vanished before it could be transferred",
    "permission": rb"Permission denied|Operation not permitted",
    "filesystem-io": rb"Input/output error|Read-only file system",
    "short-source-read": rb"read errors mapping|file has changed|short read",
    "unsupported": rb"Operation not supported|not supported on this filesystem",
    "ssh-auth": rb"Host key verification failed|Permission denied \(publickey",
    "remote-closed": rb"Restricted rsync receiver failed|Receiver authority expired",
    "allocation": rb"out of memory|Cannot allocate memory",
    "xattrs": rb"rsync_xal_|failed to set extended attribute|setxattr",
    "partial-transfer": rb"partial transfer|some files/attrs were not transferred",
    "protocol": rb"protocol data stream|unexplained error",
    "terminated": rb"received SIG|Killed by signal",
}
PATTERNS = {name: re.compile(pattern, re.I) for name, pattern in ERRORS.items()}


def idle_budget(requested, grants, now):
    if type(requested) is not int or not 90 <= requested <= 1800 or set(grants) != {"source", "receiver"}:
        raise ValueError(
            "Expected two registered grants and a warm idle budget between 90 and 1800 seconds"
        )
    remaining = int(min(value["expires"] for value in grants.values()) - now)
    if remaining < 1:
        raise ValueError("The original transfer grant expired")
    return min(requested, remaining)


def counted_errors(stream, counts, codes):
    for line in iter(lambda: stream.readline(8192), b""):
        counts["frames"] += 1
        for name, pattern in PATTERNS.items():
            if pattern.search(line):
                counts[name] += 1
        for role in (b"sender", b"generator", b"receiver"):
            if b"[" + role + b"=" in line or b"[" + role + b"]" in line:
                counts["role-" + role.decode()] += 1
        codes.update(int(n) for n in re.findall(rb"\bcode (\d{1,3})\b", line, re.I))


def emit(value):
    print(json.dumps(value, separators=(",", ":")), file=sys.stderr, flush=True)


class WarmSubprocess:
    """Keep the installed helper's process handling, collecting only numeric codes and known error classes."""

    def __init__(self, native, tags):
        self.native = native
        self.tags = tags

    def __getattr__(self, name):
        return getattr(self.native, name)

    def Popen(self, argv, **options):
        if argv[0] != "/usr/bin/rsync":
            return self.native.Popen(argv, **options)
        tag = argv[-1].rsplit(":", 1)[-1].rstrip("/")
        if (
            tag not in self.tags
            or any(flag in argv for flag in ("--dry-run", "--checksum", "--delete-delay"))
            or options.get("stderr") != self.native.DEVNULL
        ):
            raise ValueError("Unexpected registered warm transfer")
        budget = int(next(x for x in argv if x.startswith("--timeout=")).split("=")[1])
        emit({"warmVolume": tag, "event": "started", "idleSeconds": budget})
        child = self.native.Popen(argv, **{**options, "stderr": self.native.PIPE})
        counts, codes = Counter(), set()

        def read_errors():
            with child.stderr as stream:
                counted_errors(stream, counts, codes)

        audit = threading.Thread(target=read_errors, daemon=True)
        audit.start()
        native_wait = child.wait
        reported = False

        def wait(*args, **kwargs):
            nonlocal reported
            status = native_wait(*args, **kwargs)
            if not reported:
                audit.join(timeout=3)
                reported = True
                closed = not audit.is_alive()
                emit(
                    {
                        "warmVolume": tag,
                        "event": "completed",
                        "rsyncExit": status,
                        "diagnostics": dict(counts) if closed else {},
                        "rsyncCodes": sorted(codes) if closed else [],
                        "streamClosed": closed,
                    }
                )
            return status

        child.wait = wait
        return child


def install(seed, spec, requested):
    original_args = seed["rsync_args"]

    def warm_args(root, row, remote, transport, rate, cold, verify=False):
        if cold or verify:
            raise ValueError("The reviewed idle budget applies only to warm seeding")
        args = original_args(root, row, remote, transport, rate, cold, verify)
        if [a for a in args if a.startswith("--timeout=")] != ["--timeout=90"]:
            raise ValueError("The installed rsync idle policy differs")
        args[args.index("--timeout=90")] = "--timeout=" + str(
            idle_budget(requested, seed["GRANTS"], time.time())
        )
        return args

    seed["rsync_args"] = warm_args
    seed["subprocess"] = WarmSubprocess(seed["subprocess"], {r["tag"] for r in spec["volumes"]})


def run(seed, requested):
    if (
        len(sys.argv) != 4
        or sys.argv[1] != "seed"
        or seed["STOP"] is not None
        or seed["RECEIPT"] is not None
    ):
        raise ValueError("Expected the original seed action and its two current warm grants")
    spec = json.loads(gzip.decompress(base64.b64decode(sys.argv[2], validate=True)))
    install(seed, spec, requested)
    try:
        seed["main"]()
    except (ValueError, seed["ch"].Refusal) as error:
        sys.exit(str(error))
    except Exception as error:
        sys.exit("Service data endpoint stopped (" + type(error).__name__ + ")")
