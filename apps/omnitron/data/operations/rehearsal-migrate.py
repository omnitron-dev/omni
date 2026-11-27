"""Run only on the pinned physical receiver, inside its adoption journal lock."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile


class TrialRefused(Exception):
    pass


def require(ok, code):
    if not ok:
        raise TrialRefused(code)


def identity(path):
    item = path.lstat()
    return [str(item.st_dev), str(item.st_ino)]


def hash_file(path, expected_size=None):
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_nlink == 1 and
                not before.st_mode & 0o022 and (expected_size is None or before.st_size == expected_size), "ARCHIVE_CHANGED")
        h = hashlib.file_digest(stream, "sha256")
        after = os.fstat(stream.fileno())
        require((before.st_ino, before.st_ctime_ns, before.st_size) == (after.st_ino, after.st_ctime_ns, after.st_size), "ARCHIVE_CHANGED")
        return h.hexdigest()


def export_postgres(docker, row, work, review):
    # Export a never-started container. All image-declared volumes are replaced by tmpfs at creation.
    image = row["image"]
    spec = json.loads(docker("image", "inspect", "--format", '{"id":{{json .Id}},"volumes":{{json .Config.Volumes}}}', image))
    require(spec["id"] == image and re.fullmatch(r"sha256:[0-9a-f]{64}", image), "POSTGRES_IMAGE_CHANGED")
    volumes = list(spec["volumes"] or {})
    require(set(volumes) <= {row["target"]} and all(re.fullmatch(r"/[a-zA-Z0-9/_-]+", name) and ".." not in name for name in volumes),
            "UNSUPPORTED_IMAGE_VOLUMES")
    flags = [arg for point in volumes for arg in ("--tmpfs", point + ":ro,nodev,nosuid,noexec")]
    cid = docker("create", "--pull", "never", "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt",
                 "no-new-privileges", "--label", "org.omnitron.migration-trial=" + review, *flags, "--entrypoint", "/bin/true", image)
    require(re.fullmatch(r"[0-9a-f]{64}", cid), "UNCONFIRMED_EXPORT_CONTAINER")
    fmt = '{"id":{{json .Id}},"image":{{json .Image}},"state":{{json .State.Status}},"label":{{json (index .Config.Labels "org.omnitron.migration-trial")}}}'
    expected = {"id": cid, "image": image, "state": "created", "label": review}
    require(json.loads(docker("inspect", "--type", "container", "--format", fmt, cid)) == expected, "UNCONFIRMED_EXPORT_CONTAINER")
    try:
        docker("export", "--output", str(work / "postgres.tar"), cid, timeout=900)
    finally:
        require(json.loads(docker("inspect", "--type", "container", "--format", fmt, cid)) == expected, "UNCONFIRMED_EXPORT_CONTAINER")
        docker("rm", cid)


def perform(wire, copier, mod, native, seed, binding, verified, paths, observed, verify_current, state, root=None, execute=None):
    plan = wire["plan"]
    copy = plan["copy"]
    op_id, review, phase = copy["operationId"], plan["digest"], wire["phase"]
    root = root or copier["ROOT"]
    require(os.geteuid() == 0 and copier["UUID"].fullmatch(op_id) and phase in ("status", "reserve", "run") and
            native["sha"]({k: v for k, v in plan.items() if k != "digest"}) == review and
            native["sha"]({k: v for k, v in copy.items() if k != "digest"}) == copy["digest"] and
            copy["seed"] == seed["id"] and copy["sourceStop"] == verified["stop"] and plan["receipt"]["review"] == copy["digest"] and
            plan["receipt"]["operationId"] == op_id and re.fullmatch(r"[0-9a-f]{64}", plan["archiveSha256"]), "REVIEW_CHANGED")
    ch = mod["ch"]
    operation = root / op_id
    ch.physical(operation, True)
    for item in (root, operation, operation / "volumes", state / "rehearsals"):
        copier["private_dir"](item)
    pin = native["record"](state / "rehearsals" / (op_id + ".json"))
    require(pin == {"review": copy["digest"], "root": identity(root), "operation": identity(operation), "receipt": plan["receipt"]} and
            native["record"](operation / "binding.json") == copy and native["record"](operation / "prepared.json") == plan["receipt"], "COPY_RESERVATION_CHANGED")
    for item in plan["receipt"]["copies"]:
        require(item["tag"] in copier["TAGS"] and identity(operation / "volumes" / item["tag"]) == [item["device"], item["inode"]], "COPY_ROOT_CHANGED")
    journal = state / "rehearsals" / (op_id + ".migration.json")
    started = operation / "migration-started.json"
    def generations():
        copier["check_private_mounts"](operation, paths)
        writers = ch.open_writers()
        for row in seed["volumes"]:
            if row["tag"] in copier["TAGS"]:
                mod["inventory"](operation / "volumes" / row["tag"], row, seed["volumes"], writers=writers, metadata_only=True)
        return {name: mod["stage_stamp"](operation / "volumes", [{"tag": tag}])
                for name, tag in (("postgres","postgres-data"), ("minio","minio-data"))}

    def save(status, **details):
        record = {"review": review, "state": status, **details}
        ch.write_record(journal, record)
        return record

    saved = json.loads(native["read_file"](journal, limit=3 * 1024 * 1024)) if os.path.lexists(journal) else None
    if saved is not None:
        require(saved.get("review") == review and saved.get("state") in ("staging", "unconfirmed", "refused", "verified"), "TRIAL_RESERVATION_CHANGED")
        if saved["state"] != "staging":
            require(native["record"](started) == {"review": review}, "TRIAL_RESERVATION_CHANGED")
        if saved["state"] == "verified":
            require(saved["receipt"]["generations"] == generations(), "PRIVATE_TRIAL_DATA_CHANGED")
        if saved["state"] != "staging":
            return saved
    if os.path.lexists(started):
        require(native["record"](started) == {"review": review}, "TRIAL_RESERVATION_CHANGED")
        return {"review": review, "state": "unconfirmed", "reason": "NATIVE_COMPLETION_UNCONFIRMED"}
    if phase == "status":
        return saved or {"review": review, "state": "available"}
    require(phase != "run" or saved, "TRIAL_NOT_RESERVED")
    # Only fresh copies can enter this path. Terminal/ambiguous attempts above are never rerun or restored.
    copier["prepare_working_pair"](copy, mod, native, seed, binding, verified, paths, observed, verify_current, state,
                                   root=root, previous_receipt=plan["receipt"])
    if phase == "reserve":
        return saved or save("staging")
    archive = operation / ("candidate-" + plan["archiveSha256"] + ".tar.gz")
    require(hash_file(archive, plan["archiveBytes"]) == plan["archiveSha256"], "ARCHIVE_CHANGED")
    # Commit before spawning anything. A dead owner can leave an ambiguous attempt, never permission to run it twice.
    ch.write_record(started, {"review": review})
    save("unconfirmed", reason="NATIVE_COMPLETION_UNCONFIRMED")
    try:
        if execute is None:
            receipt = run_trial(wire, native, seed, binding, state, operation, archive)
        else:
            receipt = execute(plan, operation, archive)
    except TrialRefused as error:
        return save("refused", reason=str(error))
    verify_current()
    minio = next(row for row in plan["receipt"]["copies"] if row["tag"] == "minio-data")
    receipt["generations"] = generations()
    require(receipt["generations"]["minio"] == minio["generation"], "PRIVATE_OBJECT_STORAGE_CHANGED")
    return save("verified", receipt=receipt)


def run_trial(wire, native, seed, binding, state, operation, archive):
    plan, node_pid = wire["plan"], wire["nodePid"]
    require(type(node_pid) is int and node_pid > 1, "RUNTIME_UNAVAILABLE")
    # Capture the exact pinned executable before entering a fresh PID namespace.
    with tempfile.TemporaryDirectory(prefix=".private-trial-", dir=operation) as directory:
        work = Path(directory)
        runner, executable = work / "sandbox.py", work / "node"
        runner.write_text(wire["sandbox"])
        with open("/proc/" + str(node_pid) + "/exe", "rb") as src, executable.open("xb") as out:
            import shutil
            shutil.copyfileobj(src, out, 1024 * 1024)
        executable.chmod(0o555)
        require(hash_file(executable) == plan["target"]["executableSha256"], "RUNTIME_CHANGED")
        postgres = next(row for row in seed["volumes"] if row["tag"] == "postgres-data")
        docker, _ = native["docker_client"](state, binding)
        export_postgres(docker, postgres, work, plan["digest"])
        (work / "plan.json").write_text(json.dumps(plan))
        # The container never starts. The database and candidate run only in these private namespaces.
        args = ["/usr/bin/timeout", "--kill-after=10", "3660", "/usr/bin/unshare", "--pid", "--fork",
                "--mount", "--propagation", "private", "--mount-proc", "--net", "/usr/bin/setpriv", "--pdeathsig", "KILL",
                "/usr/bin/python3", "-I", str(runner),
                str(work), str(operation / "volumes/postgres-data"), str(archive)]
        child = subprocess.run(args, env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL": "C"},
                               stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=3700)
        require(child.returncode == 0 and len(child.stdout) < 3 * 1024 * 1024, "PRIVATE_EXECUTION_FAILED")
        result = json.loads(child.stdout)
        if "refused" in result:
            require(isinstance(result["refused"], str) and re.fullmatch(r"[A-Z_]{1,80}", result["refused"]), "INVALID_PRIVATE_RESULT")
            raise TrialRefused(result["refused"])
        return result


if __name__ == "__main__":
    wire = json.load(sys.stdin)
    observer, copier = {"__name__": "physical_observer"}, {"__name__": "private_copy"}
    exec(compile(wire["observer"], "physical-restore.py", "exec"), observer)
    exec(compile(wire["copy"], "rehearsal-copy.py", "exec"), copier)
    print(json.dumps(observer["inspect"]("receiver", wire["probe"], lambda *args: perform(wire, copier, *args))))
