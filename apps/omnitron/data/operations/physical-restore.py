"""Read the native cold/adopt journals and the enrolled, stopped volumes. Writes nothing."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import zlib

STATE = Path("/var/lib/omnitron-service-data")


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def trusted_program(path, expected):
    # Only execute a previously qualified installed helper. Read and compile the same bytes.
    for parent in path.parents:
        st = parent.lstat()
        require(stat.S_ISDIR(st.st_mode) and st.st_uid == 0 and not st.st_mode & 0o022,
                "Untrusted native journal directory")
    fd = os.open(path, os.O_NOFOLLOW | os.O_NONBLOCK | os.O_RDONLY)
    with os.fdopen(fd, "rb") as stream:
        st = os.fstat(fd)
        require(stat.S_ISREG(st.st_mode) and st.st_nlink == 1 and st.st_uid == 0
                and not st.st_mode & 0o022 and 0 < st.st_size <= 131072, "Untrusted installed verifier")
        code = stream.read(st.st_size + 1)
        require(len(code) == st.st_size and hashlib.sha256(code).hexdigest() == expected,
                "Installed physical verifier differs")
    return code


def qualified_seed(code):
    # The historical seed was qualified as exact bytes. The current emitter embeds two gzip modules.
    if hashlib.sha256(code).hexdigest() == "1774d8587171e5481ba010493223470fdc6e737f858806dd4d9ae3238edde3ff":
        return True

    def module(match):
        unpack = zlib.decompressobj(16 + zlib.MAX_WBITS)
        raw = unpack.decompress(base64.b64decode(match[2], validate=True), 131073)
        require(len(raw) <= 131072 and unpack.eof and not unpack.unused_data, "Invalid packed native module")
        return match[1] + b"sha256:" + hashlib.sha256(raw).hexdigest().encode() + match[1]

    normalized, count = re.subn(rb"""(['"])(H4sI[A-Za-z0-9+/]*={0,2})\1""", module, code)
    return count == 2 and hashlib.sha256(normalized).hexdigest() == "ef17e268419c7a62684364b02ed7b4353a7358583464fd9f0e44e323b8a78c21"


def load_program(path, expected, seed=False):
    code = trusted_program(path, expected)
    if seed:
        require(qualified_seed(code), "Unqualified installed native seed")
    namespace = {"__name__": "checked_physical_worker", "__file__": str(path), "SELF": code.decode()}
    # The native seed loader otherwise parses its command-line grant arguments on import.
    previous = sys.argv
    try:
        sys.argv = ["checked-physical-worker"]
        exec(compile(code, str(path), "exec"), namespace)
    finally:
        sys.argv = previous
    return namespace


def marker(root, name):
    # The enclosing descriptor and each directory component stay on the verified volume.
    directory = os.open(root, os.O_DIRECTORY | os.O_NOFOLLOW | os.O_RDONLY)
    try:
        for part in name.split("/")[:-1]:
            child = os.open(part, os.O_DIRECTORY | os.O_NOFOLLOW | os.O_RDONLY, dir_fd=directory)
            os.close(directory)
            directory = child
        fd = os.open(name.split("/")[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        with os.fdopen(fd, "rb") as stream:
            st = os.fstat(fd)
            require(stat.S_ISREG(st.st_mode) and 0 < st.st_size <= 1024 * 1024, "Invalid native control file")
            data = stream.read(st.st_size + 1)
            end = os.fstat(fd)
            require(len(data) == st.st_size and (end.st_ctime_ns, end.st_size) == (st.st_ctime_ns, st.st_size),
                    "Native control file changed")
        if name == ".minio.sys/format.json":
            # This native workflow binds one MinIO drive. A member of an erasure set is insufficient.
            fmt = json.loads(data)
            xl = fmt.get("xl") or {}
            uuid = r"[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}"
            require(fmt.get("version") == "1" and fmt.get("format") == "xl-single" and xl.get("version") == "3"
                    and re.fullmatch(uuid, fmt.get("id", "")) and re.fullmatch(uuid, xl.get("this", ""))
                    and xl.get("sets") == [[xl["this"]]], "Expected one independently complete native MinIO drive")
        return hashlib.sha256(data).hexdigest()
    finally:
        os.close(directory)


def audit(mod, seed, paths, expected_tree, metadata=None):
    rows = seed["volumes"]
    stamps = lambda: {tag: mod["stage_stamp"](p.parent, [{"tag": p.name}]) for tag, p in paths.items()}
    before = stamps()
    writers = mod["ch"].open_writers()
    trees = {r["tag"]: mod["inventory"](paths[r["tag"]], r, rows, writers=writers) for r in rows}
    require(mod["sha"](trees) == expected_tree, "Current physical contents differ from the stopped source")
    if metadata:
        native, binding, expected = metadata
        for tag, root in paths.items():
            require(native["metadata"](root, binding["maps"], writers) == expected[tag],
                    "Receiver ownership, ACLs or extended attributes changed")
    result = {"postgres": marker(paths["postgres-data"], "global/pg_control"),
              "nominatim": marker(paths["nominatim-data"], "global/pg_control"),
              "minio": marker(paths["minio-data"], ".minio.sys/format.json")}
    require(before == stamps(), "Physical generation changed during inspection")
    return {"controls": result, "generation": before, "trees": expected_tree}


def inspect(side, proof):
    require(sys.platform == "linux" and os.geteuid() == 0 and side in ("source", "receiver")
            and re.fullmatch(r"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}", proof["seed"]),
            "Registered Linux administration and a native seed are required")
    root = STATE / proof["seed"]
    mod = load_program(root / "receiver.py", proof["seedWorker"], seed=True)
    read = lambda name: mod["local_record"](root, name)
    seed = read("spec.json")
    mod["validate_scope"](seed)
    require(seed["id"] == proof["seed"] and mod["sha"](seed) == proof["spec"]
            and mod["ch"].fingerprint(mod["ch"].key_text(mod["ch"].HOST_KEY)) == seed[side + "Fingerprint"],
            "Registered host or locally admitted specification differs")

    if side == "source":
        def source():
            cold = read("cold.json")
            require(mod["sha"](cold) == proof["cold"] and "fileScope" not in cold, "Donor cold stop receipt differs")
            paths, originals = mod["source_roots"](seed, root, False)
            mod["check_cold"](seed, paths, originals)
            result = audit(mod, seed, paths, cold["sha256"])
            require((paths, originals) == mod["source_roots"](seed, root, False) and cold == read("cold.json"),
                    "Donor volume identity or stop receipt changed")
            mod["check_cold"](seed, paths, originals)
            return result
        return mod["locked"](root, source)

    state = root / "adoption"
    native = load_program(state / "adopt.py", proof["adoptWorker"])
    with mod["ch"].lock(state / "operation.lock"):
        binding, verified = (native["record"](state / name) for name in ("binding.json", "verified.json"))
        sealed = read("sealed.json")
        def check():
            require(native["sha"](binding) == proof["binding"] and native["sha"](verified) == proof["journal"]
                    and native["sha"](sealed) == proof["sealed"] and mod["closed"](root) and verified["verified"] is True
                    and not any("fileScope" in obj for obj in (binding, verified, sealed))
                    and native["record"](state / "tool.json") == {"sha256": proof["adoptWorker"]}
                    and native["record"](state / "volumes.json") == {"binding": proof["binding"], "identities": verified["identities"]},
                    "Current receiver journals differ from the approved verification")
            native["validator_security"](native["checked_grant"](seed, binding), verified["validatorProfileSha256"])
            docker, data = native["docker_client"](state, binding)
            return native["reserve"](mod, seed, binding, state, docker, data, False)
        paths = check()
        result = audit(mod, seed, paths, verified["sha256"], (native, binding, verified["metadata"]))
        require(paths == check() and binding == native["record"](state / "binding.json")
                and verified == native["record"](state / "verified.json") and sealed == read("sealed.json"),
                "Receiver registration or adoption changed")
        return result


if __name__ == "__main__":
    try:
        proof = json.loads(base64.b64decode(sys.argv[2], validate=True))
        print(json.dumps(inspect(sys.argv[1], proof), separators=(",", ":")))
    except Exception as error:
        # Administrative diagnostics must not include the contents of journals or application data.
        sys.exit("Physical restore observation refused (" + type(error).__name__ + ")")
