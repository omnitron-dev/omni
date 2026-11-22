"""The file acceptance set when both PostgreSQL clusters use independent physical transfers."""

import json
import os
import stat

SCOPE = "postgres-replicas"
TAGS = frozenset(("nominatim-flatnode", "nominatim-merged", "redis-data", "minio-data"))


def file_rows(spec, scope):
    if scope is None:
        return spec["volumes"]
    if scope != SCOPE:
        raise ValueError("Unknown service file scope")
    rows = [r for r in spec["volumes"] if r["tag"] in TAGS]
    if len(rows) != len(TAGS) or {r["tag"] for r in rows} != TAGS:
        raise ValueError("All four auxiliary service filesystems are required")
    return rows


def closed_for_files(state, stop, digest):
    # The unprivileged forced receiver can see this public revocation marker. Its parent is root-owned.
    path = state / "closed.json"
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as file:
        st = os.fstat(file.fileno())
        if not (
            stat.S_ISREG(st.st_mode)
            and st.st_nlink == 1
            and st.st_uid == 0
            and stat.S_IMODE(st.st_mode) == 0o644
            and 0 < st.st_size <= 1024
        ):
            return False
        return json.loads(file.read(1025)) == {"fileScope": SCOPE, "stop": stop, "sha256": digest}
