"""Native isolated qualification of write-preserving application recovery."""
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import selectors
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid


PHASES = {
    "full": [("baseline", "incumbent"), ("candidate-write", "candidate"),
             ("recovery-read", "recovery"), ("recovery-write", "recovery"),
             ("recovery-replay", "recovery"), ("recovery-restart", "recovery")],
    "partial": [("baseline", "incumbent"), ("candidate-partial", "candidate"),
                ("recovery-complete", "recovery"), ("recovery-repeat", "recovery")],
}
GIB = 1024 ** 3
HEX = re.compile(r"[0-9a-f]{64}")


def check(condition, message):
    if not condition:
        raise ValueError(message)


def encoded(value):
    return json.dumps(value, separators=(",", ":"), sort_keys=True, ensure_ascii=False).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def unique(pairs):
    obj = dict(pairs)
    check(len(obj) == len(pairs), "Duplicate JSON key")
    return obj


def parse(data):
    return json.loads(data, object_pairs_hook=unique)


def clean_relative(name):
    check(isinstance(name, str) and len(name) <= 1024 and name.isprintable() and "\\" not in name and
          all(part not in ("", ".", "..") for part in name.split("/")), "Invalid relative path")
    return PurePosixPath(name)


def compiled_programs(archive, artifact, runtime):
    """Stream the immutable tar once; the host never extracts project code."""
    source = artifact["packageSource"]
    programs = source.get("migrationPrograms", [])
    check(len(programs) <= 64 and (not source["migrations"] or programs), "Missing declared migration program")
    expected = {str(clean_relative(p["release"])): p["releaseSha256"] for p in programs}
    check(len(programs) == len(expected), "Duplicate migration entry")
    closure_name = ".omnitron-closure.json"
    expected[closure_name] = artifact.get("closureSha256") or artifact["launch"]["closureSha256"]
    found, parents = set(), set()
    for name in expected:
        parents.update(str(v) for v in PurePosixPath(name).parents if str(v) != ".")
    count = size = 0
    with tarfile.open(archive, mode="r|gz") as tar:
        for member in tar:
            count += 1
            size += member.size
            check(count <= 160000 and 0 <= member.size and size <= 5 * GIB, "Expanded release exceeds limits")
            name = member.name.removeprefix("./")
            if name in ("", "."):
                continue
            clean_relative(name)
            if name in parents:
                check(member.isdir(), "Non-directory on compiled migration path")
            if name not in expected:
                continue
            check(name not in found and member.isreg() and 0 < member.size <= 16 * 1024 ** 2, "Unsafe or duplicate compiled entry")
            found.add(name)
            with tar.extractfile(member) as file:
                content = file.read()
            check(digest(content) == expected[name], "Compiled entry differs from its release: " + name)
            if name == closure_name:
                closure = parse(content)
                check(closure["protocol"] == 1 and closure["runtime"] == runtime, "Archive closure targets a different runtime")
    check(found == set(expected), "Missing compiled migration or application closure")


def checked_observation(raw, request):
    check(isinstance(raw, dict) and set(raw) == {"challenge", "phase", "history", "records", "verification"} and
          raw["challenge"] == request["challenge"] and raw["phase"] == request["phase"],
          "Probe returned an invalid observation or a stale challenge")
    rows = raw["history"]
    check(isinstance(rows, list) and 0 < len(rows) <= 4096 and all(isinstance(r, dict) and
          set(r) == {"name", "sha256"} and isinstance(r["name"], str) and 0 < len(r["name"]) <= 1024 and
          HEX.fullmatch(r["sha256"]) for r in rows) and len({r["name"] for r in rows}) == len(rows),
          "Invalid measured migration history")
    verification = raw["verification"]
    check(isinstance(verification, dict) and set(verification) == {"exitCode", "historySha256", "checkedMigrations"} and
          type(verification["exitCode"]) is int and verification["exitCode"] == 0 and
          type(verification["checkedMigrations"]) is int and verification["checkedMigrations"] == len(rows) and
          verification["historySha256"] == digest(encoded(rows)), "Native migration verification did not confirm this measured history")
    sets = raw["records"]
    check(isinstance(sets, dict) and set(sets) == set(request["recordSets"]), "Incomplete record coverage")
    for records in sets.values():
        check(isinstance(records, dict) and len(records) <= 512 and all(isinstance(i, str) and
              0 < len(i) <= 256 and i.isprintable() and isinstance(h, str) and HEX.fullmatch(h)
              for i, h in records.items()), "Invalid measured record identities or content digests")
    return {"history": rows, "records": sets}


def compare_observations(values, added, prior):
    """Compare the actual database observations across fresh process boundaries."""
    check(len(added) >= 2, "Partial qualification requires at least two new migrations")
    # A migrator can record a checksum of its SQL or compiled up/down methods.
    # The pinned release carries the independent checksum of the source file.
    # Compare the database's observed checksums with the same database format.
    baseline_history = values["full"]["baseline"]["history"]
    baseline_names = {r["name"] for r in baseline_history}
    affected_directories = {str(PurePosixPath(name).parent) for name in added}
    check(baseline_names.issubset(prior) and {p for p in prior if str(PurePosixPath(p).parent) in affected_directories}
          .issubset(baseline_names), "Baseline history does not cover the affected release migration inventories")
    migrated_history = values["full"]["candidate-write"]["history"]
    new_history = migrated_history[len(baseline_history):]
    check(migrated_history[:len(baseline_history)] == baseline_history and
          [r["name"] for r in new_history] == added, "Observed candidate migration sequence differs")
    for scenario, phases in PHASES.items():
        seen = values[scenario]
        baseline = seen["baseline"]["history"]
        check(not set(added) & {r["name"] for r in baseline}, "Baseline already has candidate migrations")
        check(any(seen["baseline"]["records"].values()), "No baseline records were seeded")
        previous = None
        for phase, _ in phases:
            item = seen[phase]
            additions = [] if phase == "baseline" else new_history[:1] if phase == "candidate-partial" else new_history
            expected = baseline + additions
            check(item["history"] == expected, scenario + "/" + phase + ": migration history changed")
            if previous is not None:
                for name, before in previous["records"].items():
                    after = item["records"][name]
                    check(all(after.get(k) == v for k, v in before.items()), phase + ": a protected record changed")
                    if phase in ("candidate-write", "recovery-write"):
                        check(len(after) > len(before), phase + ": missing new record in " + name)
                    elif phase not in ("candidate-partial", "recovery-complete"):
                        check(before == after, phase + ": unexpected record or duplicate write in " + name)
                if phase == "candidate-partial":
                    check(any(len(item["records"][n]) > len(rows) for n, rows in previous["records"].items()),
                          "Partial migration produced no new probe record")
            previous = item
        check(seen["baseline"]["history"] == values["full"]["baseline"]["history"],
              "Independent baselines disagree about the migration history")


class Inputs:
    """Copy only digest-addressed regular files through a pinned staging directory."""
    def __init__(self, private):
        self.root = private
        self.total = 0
        self.paths = {}
        flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_DIRECTORY
        self.fd = os.open(Path.home(), flags)
        try:
            for part in (".omnitron", "recovery-inputs"):
                next_fd = os.open(part, flags, dir_fd=self.fd)
                os.close(self.fd)
                self.fd = next_fd
        except BaseException:
            os.close(self.fd)
            raise

    def copy(self, sha, limit):
        check(HEX.fullmatch(sha), "Invalid staged blob identity")
        if sha in self.paths:
            path = self.paths[sha]
            check(path.stat().st_size <= limit, "Input exceeds its role limit")
            return path
        with os.fdopen(os.open(sha, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW, dir_fd=self.fd), "rb") as source:
            info = os.fstat(source.fileno())
            check(stat.S_ISREG(info.st_mode) and 0 <= info.st_size <= limit and self.total + info.st_size <= 8 * GIB,
                  "Unsafe or oversized staged blob")
            space = os.statvfs(self.root)
            check(space.f_bavail * space.f_frsize >= info.st_size + GIB, "Insufficient scratch space on QA node")
            path = self.root / sha
            hasher = hashlib.sha256()
            size = 0
            with path.open("xb") as output:
                while chunk := source.read(1024 * 1024):
                    size += len(chunk)
                    check(size <= info.st_size, "Staged input grew")
                    hasher.update(chunk)
                    output.write(chunk)
            check(size == info.st_size and hasher.hexdigest() == sha, "Staged blob differs from the admitted bytes")
            self.total += size
            self.paths[sha] = path
            path.chmod(0o444)
            return path

    def release(self, item, role):
        out = self.root / role
        out.mkdir(mode=0o755)
        manifest = self.copy(item["manifestSha256"], 16 * 1024 ** 2)
        data = parse(manifest.read_bytes())
        artifacts = data["artifacts"]
        check(data["id"] == item["id"] and data["project"]["commit"] == item["commit"] and
              {a["app"]: a["sha256"] for a in artifacts} == item["artifacts"] and
              len(artifacts) == len(item["artifacts"]), "Release archive membership differs")
        os.link(manifest, out / "manifest.json")
        archives = out / "artifacts"
        archives.mkdir(mode=0o755)
        for artifact in artifacts:
            app = artifact["app"]
            check(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", app), "Invalid application name")
            blob = self.copy(artifact["sha256"], GIB)
            check(blob.stat().st_size == artifact["bytes"], "Archive size differs from manifest")
            compiled_programs(blob, artifact, data["builtWith"]["target"])
            os.link(blob, archives / (app + ".tgz"))
        index = item["staticsIndexSha256"]
        check(bool(data.get("statics")) == bool(index), "Static release index is missing or unexpected")
        if index:
            raw = self.copy(index, 4 * 1024 ** 2).read_bytes()
            entries = parse(raw)
            check(isinstance(entries, dict) and 0 < len(entries) == data["statics"]["files"] <= 32768,
                  "Static index coverage differs")
            static = out / "statics"
            static.mkdir(mode=0o755)
            size = 0
            for name, record in entries.items():
                target = static / clean_relative(name)
                check(set(record) == {"sha256", "bytes"}, "Unexpected static index entry")
                blob = self.copy(record["sha256"], 128 * 1024 ** 2)
                check(blob.stat().st_size == record["bytes"], "Incorrect static member size")
                size += record["bytes"]
                target.parent.mkdir(mode=0o755, exist_ok=True, parents=True)
                os.link(blob, target)
            check(size == data["statics"]["bytes"], "Static bytes differ from manifest")
        return out, data


def docker(args, payload=None, timeout=15, limit=512 * 1024):
    rootless = Path("/run/user") / str(os.getuid()) / "docker.sock"
    socket = rootless if rootless.is_socket() else Path("/var/run/docker.sock")
    check(socket.is_socket(), "Local QA Docker socket unavailable")
    proc = subprocess.Popen(["/usr/bin/docker", "--host", "unix://" + str(socket), *args], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            env={"PATH": "/usr/bin:/bin", "HOME": str(Path.home())})
    result = bytearray()
    deadline = time.monotonic() + timeout
    try:
        if payload:
            proc.stdin.write(encoded(payload))
        proc.stdin.close()
        with selectors.DefaultSelector() as poll:
            poll.register(proc.stdout, selectors.EVENT_READ)
            while True:
                remaining = deadline - time.monotonic()
                check(remaining > 0 and poll.select(remaining), "QA command timed out")
                buf = os.read(proc.stdout.fileno(), 16384)
                if not buf:
                    break
                result.extend(buf)
                check(len(result) <= limit, "Probe output exceeds budget")
        check(proc.wait(timeout=max(0.01, deadline-time.monotonic())) == 0, "QA Docker command failed: " + args[0])
        return bytes(result)
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.wait()
        proc.stdout.close()
        proc.stdin.close()


def verify_runtime(info, target, observed):
    check(target == observed and target["platform"] == "linux" and
          info["Architecture"] == {"x64": "amd64", "arm64": "arm64"}.get(target["arch"]) and
          HEX.fullmatch(target["executableSha256"]), "QA executable, platform, ABI or libc differs from the release")


def exercise(spec, roles, probe, manifests, runtime_program):
    image = spec["probe"]["image"]
    info = parse(docker(["image", "inspect", "--format", "{{json .}}", image]))
    check(info["Id"] == image and info["Os"] == "linux" and not info["Config"].get("Volumes"),
          "Expected pinned Linux image without implicit writable volumes")
    observed = parse(docker(["run", "--rm", "--pull=never", "--network=none", "--read-only", "--cap-drop=ALL",
                             "--security-opt=no-new-privileges", "--user=65532:65532", "--pids-limit=16",
                             "--memory=256m", "--memory-swap=256m", "--cpus=1", "--log-driver=none", "--no-healthcheck",
                             "--entrypoint=/usr/bin/timeout", image, "--signal=KILL", "15", "/usr/bin/env", "-i",
                             "PATH=/usr/bin:/bin", "/usr/bin/node", "--input-type=module", "-e", runtime_program], timeout=20))
    for manifest in manifests.values():
        verify_runtime(info, manifest["builtWith"]["target"], observed)
    values, summaries = {}, []
    challenge = secrets.token_hex(24)
    for scenario, phases in PHASES.items():
        values[scenario] = {}
        volume = "omni-qualification-" + str(uuid.uuid4())
        # Keep synthetic DB state across containers in a bounded, fresh tmpfs.
        docker(["volume", "create", "--driver", "local", "--opt", "type=tmpfs", "--opt", "device=tmpfs",
                "--opt", "o=size=1536m,nosuid,nodev,mode=1777", volume])
        holder = volume + "-holder"
        try:
            # Docker unmounts a local tmpfs volume after the last container
            # exits. A read-only holder keeps this specific mount alive while
            # the application processes are replaced between phases.
            docker(["run", "-d", "--rm", "--name", holder, "--network=none", "--read-only", "--pull=never",
                    "--user=65532:65532", "--cap-drop=ALL", "--security-opt=no-new-privileges",
                    "--pids-limit=4", "--memory=16m", "--memory-swap=16m", "--cpus=0.1",
                    "--no-healthcheck", "--log-driver=none", "--mount",
                    "type=volume,readonly,src=" + volume + ",dst=/state,volume-nocopy",
                    "--entrypoint=/usr/bin/sleep", image, "1750"])
            for phase, role in phases:
                name = "omni-probe-" + str(uuid.uuid4())
                request = {"protocol": 1, "scenario": scenario, "phase": phase, "challenge": challenge,
                           "recordSets": spec["probe"]["recordSets"], "addedMigrations": spec["addedMigrations"],
                           "releaseId": spec[role]["id"], "manifestSha256": spec[role]["manifestSha256"]}
                try:
                    raw = docker(["run", "--rm", "--name", name, "--pull=never", "--network=none", "--read-only",
                                  "--cap-drop=ALL", "--security-opt=no-new-privileges", "--user=65532:65532",
                                  "--pids-limit=160", "--memory=3g", "--memory-swap=3g", "--cpus=2",
                                  "--log-driver=none", "--no-healthcheck", "--tmpfs", "/tmp:rw,nosuid,nodev,size=512m,mode=1777",
                                  "--mount", "type=bind,readonly,src=" + str(roles[role]) + ",dst=/input",
                                  "--mount", "type=bind,readonly,src=" + str(probe) + ",dst=/probe.py",
                                  "--mount", "type=volume,src=" + volume + ",dst=/state,volume-nocopy",
                                  "--env", "HOME=/tmp", "--entrypoint=/usr/bin/timeout", "-i", image,
                                  "--signal=KILL", "155", "/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "HOME=/tmp",
                                  "/usr/bin/python3", "-I", "-B", "/probe.py"], request, 165)
                except (ValueError, OSError, subprocess.SubprocessError) as error:
                    raise ValueError(scenario + "/" + phase + ": " + str(error)) from error
                finally:
                    # A disconnected CLI can leave the receiver process running.
                    # A fresh UUID scopes this cleanup to the specific phase.
                    remaining = docker(["ps", "-aq", "--filter", "name=^/" + name + "$"]).strip()
                    if remaining:
                        docker(["rm", "-f", name])
                observed = checked_observation(parse(raw), request)
                values[scenario][phase] = observed
                summaries.append({"phase": scenario + "/" + phase, "sha256": digest(encoded(observed))})
        finally:
            if docker(["ps", "-aq", "--filter", "name=^/" + holder + "$"]).strip():
                docker(["rm", "-f", holder])
            docker(["volume", "rm", volume])
    return values, {"protocol": 1, "challenge": challenge, "phases": summaries, "inputs": digest(encoded(spec))}


def main(spec, runtime_program):
    check(sys.platform == "linux", "Linux QA node required")
    os.umask(0o022)
    with tempfile.TemporaryDirectory(prefix="omni-recovery-", dir="/var/tmp") as scratch:
        inputs = Inputs(Path(scratch))
        roles, manifests = {}, {}
        try:
            for role in ("incumbent", "candidate", "recovery"):
                roles[role], manifests[role] = inputs.release(spec[role], role)
            probe = inputs.copy(spec["probe"]["sha256"], 256 * 1024)
        finally:
            os.close(inputs.fd)
        candidate = manifests["candidate"]["migrations"]
        live = manifests["incumbent"]["migrations"]
        claimed = spec["addedMigrations"]
        check(manifests["recovery"]["migrations"] == candidate and all(candidate.get(k) == h for k, h in live.items()) and
              sorted(set(candidate) - set(live)) == sorted(claimed), "Staged migration inventories differ")
        values, receipt = exercise(spec, roles, probe, manifests, runtime_program)
        compare_observations(values, claimed, live)
        print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    def cancel(signum, frame):
        raise InterruptedError("QA qualification cancelled")
    signal.signal(signal.SIGTERM, cancel)
    try:
        main(parse(base64.b64decode(sys.argv[2], validate=True)), base64.b64decode(sys.argv[1], validate=True).decode())
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print("Recovery qualification failed: " + str(error)[:300], file=sys.stderr)
        sys.exit(1)
