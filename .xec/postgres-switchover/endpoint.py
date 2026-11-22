"""Collect site-native evidence and promote only isolated, reviewed PostgreSQL candidates."""
import base64
import gzip
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
from contextlib import contextmanager
from pathlib import Path

from pg_switch_proof import (
    IMMUTABLE, applied, control_fields, file_digest, identity, inode_flags, promoted, require, terminal,
)

MAJORS = {"postgres": 17, "nominatim": 14}
SOCKET = "/run/omnitron-pg"
TIMEOUT = 90
ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL": "C"}


def command(args, env, timeout=TIMEOUT):
    try:
        proc = subprocess.run(args, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ValueError("Native PostgreSQL or Docker operation did not complete") from exc
    operation = args[args.index("--entrypoint") + 1] if "--entrypoint" in args else "docker " + args[1]
    require(proc.returncode == 0, f"{operation} exited with status {proc.returncode}")
    return proc.stdout.decode().strip()


class Engine:
    def __init__(self, uid):
        socket = Path("/run/docker.sock" if uid == 0 else f"/run/user/{uid}/docker.sock")
        st = socket.lstat()
        require(stat.S_ISSOCK(st.st_mode) and st.st_uid == uid, "Unexpected Docker socket owner")
        self.env = {**ENV, "DOCKER_HOST": "unix://" + str(socket)}
        self.image_volumes = {}
        self.root = Path(self.run("info", "--format", "{{.DockerRootDir}}"))
        security = json.loads(self.run("info", "--format", "{{json .SecurityOptions}}"))
        require(("name=rootless" in security) == (uid != 0) and self.root.is_absolute()
                and self.root.resolve(strict=True) == self.root, "Incorrect Docker engine or data root")

    def run(self, *args, timeout=TIMEOUT):
        return command(["/usr/bin/docker", *args], self.env, timeout)

    def volume(self, row):
        mount = json.loads(self.run("volume", "inspect", "--format", "{{json .}}", row["volume"]))
        path = self.root / "volumes" / row["volume"] / "_data"
        require(mount.get("Name") == row["volume"] and mount.get("Driver") == "local" and not mount.get("Options")
                and mount.get("Mountpoint") == str(path) and path.resolve(strict=True) == path,
                "The reviewed native volume changed")
        info = path.stat()
        require([str(info.st_dev), str(info.st_ino)] == [row["device"], row["inode"]],
                "The physical PostgreSQL volume changed")
        return path

    def containers(self, all_containers):
        args = ["ps", "--no-trunc", "--quiet"]
        if all_containers:
            args.append("--all")
        return self.run(*args).splitlines()

    def mounts(self, cid):
        return json.loads(self.run("inspect", "--type", "container", "--format", "{{json .Mounts}}", cid))

    def defaults(self, image):
        if image not in self.image_volumes:
            self.image_volumes[image] = json.loads(self.run("image", "inspect", "--format", "{{json .Config.Volumes}}", image)) or {}
        return self.image_volumes[image]


def overlaps(path, other):
    return path == other or path in other.parents or other in path.parents


def attachments(engine, roots, holder=None):
    ids = [cid for cid in engine.containers(holder is not None) if cid != holder]
    for index in range(0, len(ids), 128):
        batch = ids[index:index + 128]
        lines = engine.run("inspect", "--type", "container", "--format", "{{json .Mounts}}", *batch).splitlines()
        require(len(lines) == len(batch), "Incomplete container attachment inventory")
        for line in lines:
            for mount in json.loads(line):
                if mount.get("Source") and (holder or mount.get("RW")):
                    source = Path(mount["Source"]).resolve()
                    require(not any(overlaps(root, source) for root in roots),
                            "Another container has access to the physical PostgreSQL volume")


def image_path(major):
    return f"PATH=/usr/lib/postgresql/{major}/bin:/usr/local/bin:/usr/bin:/bin"


def layout(root, major):
    version = root / "PG_VERSION"
    require(stat.S_ISREG(version.lstat().st_mode) and version.stat().st_size <= 4
            and version.read_text().strip() == str(major), "PostgreSQL major differs from the review")
    for line in Path("/proc/self/mountinfo").read_text().splitlines():
        mounted = Path(re.sub(r"\\([0-7]{3})", lambda m: chr(int(m[1], 8)), line.split()[4]))
        require(root not in mounted.parents, "Nested PGDATA mounts require an independent physical review")
    for name in ("pg_wal", "pg_tblspc"):
        path = root / name
        require(stat.S_ISDIR(path.lstat().st_mode) and path.stat().st_dev == root.stat().st_dev,
                "External WAL and tablespaces require a separate physical review")
    require(not any((root / "pg_tblspc").iterdir()), "The reviewed scope has no external tablespaces")


def source_program(engine, row, major, name, *args):
    root = engine.volume(row)
    owner = root.stat()
    volumes = engine.defaults(row["image"])
    cmd = ["run", "--rm", "--pull", "never", "--network", "none", "--read-only", "--cap-drop", "ALL",
           "--security-opt", "no-new-privileges", "--user", f"{owner.st_uid}:{owner.st_gid}",
           "--mount", f"type=volume,source={row['volume']},target={row['target']},readonly,volume-nocopy"]
    for target in sorted(set(volumes) - {row["target"]}):
        require(target.startswith("/") and "," not in target and ":" not in target
                and not overlaps(Path(target), Path(row["target"])), "Unexpected image volume")
        cmd.extend(["--tmpfs", target + ":ro,noexec,nosuid,nodev,size=4096"])
    return engine.run(*cmd, "--entrypoint", name, "-e", image_path(major), "-e", "LC_ALL=C", row["image"], *args)


@contextmanager
def physical_fence(root):
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        def check():
            require(os.path.samestat(root.lstat(), os.fstat(fd)) and inode_flags(fd) & IMMUTABLE
                    and not os.path.lexists(root / "postmaster.pid"), "The persistent source PGDATA fence is open")
        check()
        yield
        check()
    finally:
        os.close(fd)


def source_witness(engine, row, major):
    root = engine.volume(row)
    layout(root, major)
    with physical_fence(root):
        attachments(engine, [root])
        control = source_program(engine, row, major, "pg_controldata", row["target"])
        fields = control_fields(control)
        record = source_program(engine, row, major, "pg_waldump", "-p", row["target"] + "/pg_wal",
                                "-t", fields["Latest checkpoint's TimeLineID"], "-s",
                                fields["Latest checkpoint location"], "-n", "1")
        proof = terminal(control, record)
        if major == 14:
            proof["importFinished"] = {**file_digest(root, "import-finished", 1024 * 1024),
                                       "mtimeNs": str((root / "import-finished").stat().st_mtime_ns)}
        attachments(engine, [root])
        require(engine.volume(row) == root, "Source volume changed")
    return {**proof, "major": major, "image": row["image"], "volume": row["volume"],
            "device": row["device"], "inode": row["inode"], "writerFence": "immutable-pgdata"}


def verified_profile(declaration):
    if declaration is None:
        return None
    name = declaration["name"]
    require(re.fullmatch(r"omnitron-[a-z0-9-]{1,64}", name), "Invalid PostgreSQL observer AppArmor profile")
    path = Path("/etc/apparmor.d") / name
    for parent in path.parents:
        st = parent.lstat()
        require(stat.S_ISDIR(st.st_mode) and st.st_uid == 0 and not st.st_mode & 0o022, "Unsafe AppArmor profile directory")
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), "rb") as f:
        st = os.fstat(f.fileno())
        require(stat.S_ISREG(st.st_mode) and st.st_uid == 0 and st.st_nlink == 1 and not st.st_mode & 0o022
                and st.st_size <= 256 * 1024 and hashlib.sha256(f.read()).hexdigest() == declaration["sha256"],
                "The reviewed AppArmor profile changed")
    require(name + " (enforce)" in Path("/sys/kernel/security/apparmor/profiles").read_text().splitlines(),
            "The private PostgreSQL AppArmor profile must be enforcing")
    return name


def running_postmaster(pid, root, socket, target, profile):
    require(type(pid) is int and pid > 1, "Private postmaster PID is missing")
    fd = os.open(f"/proc/{pid}", os.O_DIRECTORY | os.O_RDONLY | os.O_NOFOLLOW)
    try:
        proc = Path(f"/proc/self/fd/{fd}")
        require(Path(os.readlink(proc / "exe")).name == "postgres"
                and os.path.samestat((proc / "root" / target.lstrip("/")).stat(), root.stat())
                and os.path.samestat((proc / "root" / SOCKET.lstrip("/")).stat(), socket.stat()),
                "The running postmaster does not own both reviewed mounts")
        enabled = Path("/sys/module/apparmor/parameters/enabled")
        if profile or (enabled.exists() and enabled.read_text().strip().upper() == "Y"):
            label = proc / "attr/apparmor/current"
            if not label.exists():
                label = proc / "attr/current"
            require(label.read_text().strip() == (profile or "docker-default") + " (enforce)",
                    "The actual postmaster has a different kernel security label")
    finally:
        os.close(fd)


class Candidate:
    def __init__(self, engine, bind, row, major, generation, profile, phase):
        self.engine, self.bind, self.row, self.major = engine, bind, row, major
        self.generation, self.profile, self.phase = generation, profile, phase
        self.root = engine.volume(bind)
        self.socket_name = f"omnitron-pg-socket-{generation}-{major}"
        self.socket = engine.volume({"volume": self.socket_name, "device": bind["socketDevice"], "inode": bind["socketInode"]})
        self.check()
        layout(self.root, major)

    def check(self):
        cid = self.bind["container"]
        fmt = ('{"id":{{json .Id}},"image":{{json .Image}},"state":{{json .State.Status}},"entry":{{json .Path}},'
               '"pid":{{json .State.Pid}},'
               '"net":{{json .HostConfig.NetworkMode}},"networks":{{json .NetworkSettings.Networks}},'
               '"ports":{{json .HostConfig.PortBindings}},"restart":{{json .HostConfig.RestartPolicy.Name}},'
               '"pidMode":{{json .HostConfig.PidMode}},"privileged":{{json .HostConfig.Privileged}},'
               '"caps":{{json .HostConfig.CapDrop}},"opt":{{json .HostConfig.SecurityOpt}},'
               '"added":{{json .HostConfig.CapAdd}},"devices":{{json .HostConfig.Devices}},'
               '"requests":{{json .HostConfig.DeviceRequests}},"ipc":{{json .HostConfig.IpcMode}},'
               '"ro":{{json .HostConfig.ReadonlyRootfs}},"apparmor":{{json .AppArmorProfile}},"labels":{{json .Config.Labels}}}')
        c = json.loads(self.engine.run("inspect", "--type", "container", "--format", fmt, cid))
        live = self.phase != "base"
        options = set(c["opt"] or [])
        allowed = {"no-new-privileges", "no-new-privileges=true"}
        if self.profile:
            allowed.add("apparmor=" + self.profile)
        require(c["id"] == cid and c["image"] == self.row["image"]
                and (c["state"] == "running" if live else c["state"] in ("created", "exited"))
                and c["entry"] in ("postgres", "/usr/local/bin/postgres", f"/usr/lib/postgresql/{self.major}/bin/postgres")
                and c["net"] == "none" and set(c["networks"] or {}) <= {"none"} and not c["ports"]
                and c["restart"] in ("", "no") and c["privileged"] is False and not c["pidMode"]
                and c["ro"] is True and "ALL" in {cap.upper() for cap in c["caps"] or []}
                and not c["added"] and not c["devices"] and not c["requests"] and c["ipc"] in ("", "private")
                and options <= allowed and bool(options & {"no-new-privileges", "no-new-privileges=true"})
                and (c["apparmor"] in ("", self.profile) and "apparmor=" + self.profile in options
                     if self.profile else c["apparmor"] in ("", "docker-default"))
                and c["labels"].get("omnitron.pg-switchover") == self.generation, "Candidate is not private and pinned")
        mounts = self.engine.mounts(cid)
        for name, path, target in [(self.bind["volume"], self.root, self.row["target"]), (self.socket_name, self.socket, SOCKET)]:
            matches = [m for m in mounts if m.get("Destination") == target]
            require(len(matches) == 1 and matches[0].get("Type") == "volume" and matches[0].get("Name") == name
                    and matches[0].get("RW") is True and matches[0].get("Source") == str(path), "Private holder mount differs")
        attachments(self.engine, [self.root, self.socket], cid)
        for m in mounts:
            if m["Destination"] in (self.row["target"], SOCKET):
                continue
            if m.get("Type") == "tmpfs":
                require(all(not overlaps(Path(m["Destination"]), Path(target)) for target in (self.row["target"], SOCKET)),
                        "Anonymous mount hides candidate data or its private socket")
                continue
            require(m.get("Type") == "bind" and m.get("Destination") == "/run/omnitron-source" and m.get("RW") is False,
                    "Private holder has an unrelated durable mount")
        st = self.socket.stat()
        require(st.st_uid == self.root.stat().st_uid and stat.S_IMODE(st.st_mode) == 0o700
                and self.engine.volume(self.bind) == self.root, "Private socket owner/mode or candidate volume changed")
        if live:
            running_postmaster(c["pid"], self.root, self.socket, self.row["target"], self.profile)

    def run(self, name, *args, timeout=TIMEOUT):
        cmd = ["run", "--rm", "--pull", "never", "--network", "none", "--read-only", "--cap-drop", "ALL",
               "--security-opt", "no-new-privileges", "--user", "postgres", "-e", image_path(self.major),
               "-e", "LC_ALL=C", "-e", "PGCONNECT_TIMEOUT=8", "--mount",
               f"type=volume,source={self.bind['volume']},target={self.row['target']},readonly,volume-nocopy", "--mount",
               f"type=volume,source={self.socket_name},target={SOCKET},readonly,volume-nocopy"]
        if self.profile:
            cmd.extend(["--security-opt", "apparmor=" + self.profile])
        defaults = self.engine.defaults(self.row["image"])
        for target in sorted(set(defaults) - {self.row["target"], SOCKET}):
            require(target.startswith("/") and "," not in target and ":" not in target
                    and not any(overlaps(Path(target), Path(used)) for used in (self.row["target"], SOCKET)),
                    "Unexpected observer image volume")
            cmd.extend(["--tmpfs", target + ":ro,noexec,nosuid,nodev,size=4096"])
        return self.engine.run(*cmd, "--entrypoint", name, self.row["image"], *args, timeout=timeout)

    def sql(self, statement, physical=False):
        dsn = "host=" + SOCKET + " port=5432 user=postgres dbname=" + ("replication replication=true" if physical else "postgres")
        return self.run("psql", "-XAtw", "-v", "ON_ERROR_STOP=1", "-d", dsn, "-c", statement)

    def live(self):
        info = self.sql("SELECT current_setting('server_version_num')::int / 10000, current_setting('data_directory'),"
                        "current_setting('listen_addresses'),current_setting('unix_socket_directories'),"
                        "pg_is_in_recovery(),(SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend' "
                        "AND pid<>pg_backend_pid()),(SELECT count(*) FROM pg_replication_slots),"
                        "current_setting('default_transaction_read_only')='on' "
                        "AND current_setting('primary_slot_name')='' AND current_setting('fsync')='on' "
                        "AND current_setting('full_page_writes')='on' "
                        "AND current_setting('max_logical_replication_workers')::int=0 "
                        "AND current_setting('shared_preload_libraries')='' AND current_setting('session_preload_libraries')='' "
                        "AND current_setting('local_preload_libraries')='' AND current_setting('archive_mode')='off' "
                        "AND current_setting('archive_cleanup_command')='' AND current_setting('recovery_end_command')='' "
                        "AND NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND backend_type "
                        "NOT IN ('startup','walreceiver','checkpointer','background writer','walwriter','autovacuum launcher',"
                        "'autovacuum worker','logical replication launcher','wal summarizer'))")
        parts = info.split("|")
        require(len(parts) == 8 and parts[:4] == [str(self.major), self.row["target"], "", SOCKET]
                and parts[4] in ("t", "f") and parts[5:] == ["0", "0", "t"], "Candidate sockets, slots or private writer policy differ")
        return self.sql("IDENTIFY_SYSTEM", physical=True), parts[4] == "t"

    def marker_matches(self, source):
        if self.major != 14:
            return True
        return file_digest(self.root, "import-finished", 1024 * 1024) == {
            k: source["importFinished"][k] for k in ("sha256", "bytes")
        }

    def base(self):
        require(not os.path.lexists(self.root / "postmaster.pid") and (self.root / "standby.signal").is_file(),
                "A completed native backup with recovery settings must be offline for verification")
        manifest = file_digest(self.root, "backup_manifest", 256 * 1024**2)
        # SHA256 in the manifest footer alone does not prove per-file checksums.
        with (self.root / "backup_manifest").open("rb") as f:
            data = json.load(f)
        files = data.get("Files")
        require(files and all(entry.get("Size") == 0 or entry.get("Checksum-Algorithm") == "SHA256" for entry in files)
                and data.get("WAL-Ranges"), "The native backup requires per-file SHA256 and its WAL ranges")
        self.run("pg_verifybackup", self.row["target"], timeout=24 * 3600)
        fields = control_fields(self.run("pg_controldata", self.row["target"]))
        require(not os.path.lexists(self.root / "postmaster.pid")
                and file_digest(self.root, "backup_manifest", 256 * 1024**2) == manifest,
                "The offline backup changed during native verification")
        return {"systemIdentifier": fields["Database system identifier"], "manifestSha256": manifest["sha256"]}

    def before(self, source, base, state=None):
        manifest = file_digest(self.root, "backup_manifest", 256 * 1024**2)
        require(manifest["sha256"] == base["manifestSha256"] and self.marker_matches(source),
                "Candidate base manifest or fenced Nominatim import marker differs")
        reply, recovering = state or self.live()
        return applied(source, reply, recovering)

    def after(self, source, base, before):
        require(file_digest(self.root, "backup_manifest", 256 * 1024**2)["sha256"] == base["manifestSha256"]
                and self.marker_matches(source), "Candidate manifest or import marker changed")
        reply, recovering = self.live()
        if recovering:
            applied(source, reply, recovering)
            require(self.sql("SELECT pg_promote(true, 45)") == "t", "The private standby did not finish promotion")
            reply, recovering = self.live()
        peer = identity(reply)
        path = self.root / "pg_wal" / f"{peer['timeline']:08X}.history"
        require(stat.S_ISREG(path.lstat().st_mode) and path.stat().st_size <= 1024 * 1024,
                "Missing private promotion timeline history")
        return promoted(before, reply, recovering, path.read_text())


def main():
    phase, envelope = sys.argv[1:3]
    spec, binding, spec_hash, binding_hash, stop, inputs = json.loads(gzip.decompress(base64.b64decode(envelope)))
    require(sys.platform == "linux" and os.geteuid() == 0, "Run on the registered Linux endpoint")
    side = "source" if phase == "source" else "receiver"
    engine = Engine(0 if side == "source" else binding["engineUid"])
    result = {"protocol": "omnitron.postgres-switchover/1", "phase": phase, "seed": spec["id"],
              "spec": spec_hash, "binding": binding_hash, "stop": stop, "clusters": {}}
    candidates = {}
    rows = {s: next(r for r in spec["volumes"] if r["tag"] == s + "-data") for s in MAJORS}
    if side == "receiver":
        profile = verified_profile(binding.get("apparmor"))
        candidates = {s: Candidate(engine, binding["candidates"][s], rows[s], major, spec["id"], profile, phase)
                      for s, major in MAJORS.items()}
    if phase == "promote":
        # Check both before the first irreversible PostgreSQL timeline change.
        for s, c in candidates.items():
            state = c.live()
            if state[1]:
                c.before(inputs["source"]["clusters"][s], inputs["base"]["clusters"][s], state)
            else:
                # A lost acknowledgement may leave an already privately promoted candidate.
                c.after(inputs["source"]["clusters"][s], inputs["base"]["clusters"][s],
                        inputs["replay"]["clusters"][s]["standby"])
    for s, major in MAJORS.items():
        row = rows[s]
        if phase == "source":
            witness = source_witness(engine, row, major)
        else:
            c = candidates[s]
            witness = {"major": major, "image": row["image"], "container": c.bind["container"],
                       "volume": c.bind["volume"], "inode": c.bind["inode"], "device": c.bind["device"]}
            if phase == "base":
                witness.update(c.base())
            else:
                base = inputs["base"]["clusters"][s]
                source = inputs["source"]["clusters"][s]
                witness.update(systemIdentifier=source["systemIdentifier"], manifestSha256=base["manifestSha256"],
                               terminal=source["shutdownCheckpointLsn"], sourceTimeline=source["timeline"])
                if phase == "replay":
                    witness["standby"] = c.before(source, base)
                else:
                    before = inputs["replay"]["clusters"][s]["standby"]
                    witness.update(standby=before, privatePrimary=c.after(source, base, before))
            c.check()
        require(witness["systemIdentifier"] == spec["clusters"][s], "A native cluster system identifier differs")
        result["clusters"][s] = witness
    if phase == "source" and inputs.get("source"):
        require(result == inputs["source"], "The registered terminal checkpoints or fences changed")
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, IndexError, TypeError) as error:
        print("PostgreSQL switchover witness failed: " + str(error), file=sys.stderr)
        sys.exit(1)
