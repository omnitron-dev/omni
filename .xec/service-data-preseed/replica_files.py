"""Manage four file trees under the original six-volume grant and its unmodified forced receiver."""

import hashlib
import os
import selectors
import signal
import stat
import subprocess
import sys
import time

from service_file_scope import SCOPE, TAGS, closed_for_files, file_rows


def sync(m, spec, state, roots, rows, grant, verify):
    # The installed sender takes its volume list and its grant digest from the same object.
    # Keep its exact rsync and pinned SSH argument builders, admitting the original complete spec.
    channel = m["ch"]
    channel.account_name = m["account_name"]
    ssh = channel.ssh_command(spec, state)

    def admitted():
        m["demand"](
            time.time() < grant["expires"] and not m["closed"](state), "Source grant expired or closed"
        )

    for row in rows:
        args = m["rsync_args"](roots[row["tag"]], row, ssh[-2], ssh[:-2], spec["rateKiB"], True, verify)
        admitted()
        child = subprocess.Popen(
            args,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
            env={"PATH": m["SAFE_PATH"], "LC_ALL": "C"},
        )
        try:
            changed = False
            with selectors.DefaultSelector() as poll:
                poll.register(child.stdout, selectors.EVENT_READ)
                while True:
                    admitted()
                    if poll.select(0.5):
                        if not os.read(child.stdout.fileno(), 65536):
                            break
                        changed = True
            m["demand"](
                child.wait(timeout=10) == 0 and not (verify and changed),
                "The cold rsync or its metadata and checksum comparison failed for " + row["tag"],
            )
            admitted()
        finally:
            child.stdout.close()
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL)
            child.wait()


def validate_services(m, spec, state, roots, persistence):
    demand = m["demand"]
    for root, path in (("nominatim-flatnode", "flatnode.file"), ("minio-data", ".minio.sys/format.json")):
        demand(stat.S_ISREG((roots[root] / path).lstat().st_mode), "Missing flatnode or MinIO format")
    redis = roots["redis-data"]
    files = [
        p
        for p in (redis / "dump.rdb", redis / "appendonly.aof", *redis.glob("*/*.manifest"))
        if os.path.lexists(p)
    ]
    demand(
        files and all(stat.S_ISREG(p.lstat().st_mode) for p in files),
        "Missing or irregular Redis persistence",
    )
    if persistence == "rdb":
        demand(redis / "dump.rdb" in files, "The admitted Redis RDB is missing")
        with (redis / "dump.rdb").open("rb") as f:
            h = hashlib.sha256()
            for block in iter(lambda: f.read(1024**2), b""):
                h.update(block)
        demand(
            m["local_record"](state, "redis-final.json")
            == {"schema": 1, "spec": m["sha"](spec), "stop": m["STOP"], "sha256": h.hexdigest()},
            "The final fenced Redis SAVE must match these bytes",
        )
    else:
        demand(
            persistence == "aof" and any(p.name != "dump.rdb" for p in files),
            "The admitted Redis AOF is missing",
        )
    row = next(r for r in spec["volumes"] if r["tag"] == "redis-data")
    for p in files:
        m["run_validator"](
            row,
            redis,
            "redis-check-rdb" if p.name == "dump.rdb" else "redis-check-aof",
            "/input/" + str(p.relative_to(redis)),
        )


def checked_receipt(m, spec, receipt):
    m["demand"](
        receipt.get("fileScope") == SCOPE
        and receipt["id"] == spec["id"]
        and receipt["spec"] == m["sha"](spec)
        and receipt["stop"] == m["STOP"]
        and set(receipt["trees"]) == TAGS
        and receipt["sha256"] == m["sha"](receipt["trees"]),
        "The exact four-tree cold receipt and source fence are required",
    )


def action(m, phase, spec, state):
    rows = file_rows(spec, SCOPE)
    stamp = m["stage_stamp"]
    demand, record, channel = m["demand"], m["local_record"], m["ch"]
    stop, receipt = m["STOP"], m["RECEIPT"]
    common = {"id": spec["id"], "spec": m["sha"](spec), "stop": stop, "fileScope": SCOPE}
    if phase != "cold":
        checked_receipt(m, spec, receipt)
    if phase in ("cold", "source-check"):
        # Only source_roots consumes the projection. All authorizations use the unmodified spec.
        def fenced_roots():
            roots, originals = m["source_roots"]({**spec, "volumes": rows}, state, False)
            m["check_cold"](spec, roots, originals)
            return roots

        grant = m["source_authority"](spec, state)
        roots = fenced_roots()
        admission = record(state, "source-admission.json")
        demand(admission["spec"] == common["spec"], "The complete source was never admitted")
        if phase == "source-check":
            demand(receipt == record(state, "cold-files.json"), "Foreign four-tree cold evidence")
        expected = stamp(state / "exports", rows)
        if phase == "source-check":
            demand(
                record(state, "cold-files-stamp.json")
                == {"receipt": m["sha"](receipt), "snapshot": expected},
                "A fenced source tree changed after the cold receipt",
            )
        writers = channel.open_writers()
        for r in rows:
            m["inventory"](roots[r["tag"]], r, rows, writers=writers, metadata_only=True)
        sync(m, spec, state, roots, rows, grant, phase == "source-check")
        if phase == "cold":
            validate_services(m, spec, state, roots, admission["redisPersistence"])
            writers = channel.open_writers()
            trees = {r["tag"]: m["inventory"](roots[r["tag"]], r, rows, writers=writers) for r in rows}
            receipt = {**common, "trees": trees, "sha256": m["sha"](trees)}
        fenced_roots()
        m["source_authority"](spec, state)
        writers = channel.open_writers()
        for r in rows:
            m["inventory"](roots[r["tag"]], r, rows, writers=writers, metadata_only=True)
        demand(
            stamp(state / "exports", rows) == expected,
            "The fenced source changed during checksum verification",
        )
        if phase == "cold":
            channel.write_record(
                state / "cold-files-stamp.json", {"receipt": m["sha"](receipt), "snapshot": expected}
            )
            channel.write_record(state / "cold-files.json", receipt)
            return receipt
        return {**common, "sha256": receipt["sha256"]}

    grant = record(state, "receiver.json")
    demand(grant["spec"] == common["spec"], "Receiver grant changed")
    stage = m["stage_identity"](spec, grant)
    observed = {**common, "cold": receipt["sha256"], "snapshot": stamp(stage, rows)}
    if phase == "receiver-observe":
        demand(not m["closed"](state), "Receiver is already closed")
        m["receiver_setup"](spec, state, m["permit"](state, spec, "receiver"))
        channel.write_record(state / "observed-files.json", observed)
        return observed
    demand(
        phase == "seal" and record(state, "observed-files.json") == observed,
        "Selected stage changed around the native checksum comparison",
    )
    os.chmod(stage, 0o700)
    demand(set(os.listdir(stage)) == {r["tag"] for r in spec["volumes"]}, "Unreviewed stage directory")
    for r in rows:
        demand(
            m["inventory"](stage / r["tag"], r, rows, receiver=True) == receipt["trees"][r["tag"]],
            "Sealed file tree differs for " + r["tag"],
        )
    demand(stamp(stage, rows) == observed["snapshot"], "The selected stage changed during sealing")
    result = {**common, "sha256": receipt["sha256"], "stage": str(stage), "sealed": True}
    channel.write_record(state / "sealed-files.json", result)
    return result


def run(m):
    def dispatch(phase, spec, state):
        m["demand"](
            phase in ("cold", "source-check", "receiver-observe", "seal") and m["UUID"].fullmatch(m["STOP"]),
            "Expected a reviewed fenced four-tree action",
        )
        if phase == "cold":
            m["demand"](
                m["RECEIPT"] is None
                and isinstance(m["GRANTS"], dict)
                and set(m["GRANTS"]) == {"source", "receiver"},
                "Both original endpoint admissions are required",
            )
            m["ch"].lower_source_priority()
        else:
            m["demand"](
                m["GRANTS"] is None and isinstance(m["RECEIPT"], dict), "The source cold receipt is required"
            )
        if phase == "seal":
            checked_receipt(m, spec, m["RECEIPT"])
            marker = {"fileScope": SCOPE, "stop": m["STOP"], "sha256": m["RECEIPT"]["sha256"]}
            # Validate the observation before interrupting transfer; compare its snapshot again inside the lock.
            seen = m["local_record"](state, "observed-files.json")
            m["demand"](
                all(
                    seen.get(k) == v
                    for k, v in {
                        "stop": m["STOP"],
                        "fileScope": SCOPE,
                        "spec": m["sha"](spec),
                        "cold": m["RECEIPT"]["sha256"],
                    }.items()
                ),
                "A current observation is required",
            )
            try:
                with (state / "closed.json").open("xb") as output:
                    os.fchmod(output.fileno(), 0o644)
                    output.write(m["ch"].canonical(marker))
                    output.flush()
                    os.fsync(output.fileno())
                m["ch"].sync_directory(state)
            except FileExistsError:
                m["demand"](
                    closed_for_files(state, m["STOP"], m["RECEIPT"]["sha256"]),
                    "Receiver was closed by another operation",
                )
        return m["locked"](state, lambda: action(m, phase, spec, state))

    m["run_action"] = dispatch
    try:
        m["main"]()
    except (ValueError, m["ch"].Refusal) as error:
        sys.exit(str(error))
    except Exception as error:
        sys.exit("Four-tree service endpoint stopped (" + type(error).__name__ + ")")
