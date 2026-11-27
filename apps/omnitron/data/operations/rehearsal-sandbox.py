"""Private Linux worker for the standard numbered PostgreSQL migration CLI. No host credentials are inherited."""
import ctypes
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import resource
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import time


class Refused(Exception):
    pass


def require(value, code):
    if not value:
        raise Refused(code)


def sha(file):
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def command(args, **options):
    return subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL": "C"}, check=True, timeout=120, **options).stdout


def bind(source, target, readonly=False):
    command(["/bin/mount", "--bind", str(source), str(target)])
    if readonly:
        command(["/bin/mount", "-o", "remount,bind,ro,nosuid,nodev", str(target)])


def extract(source, dest, app):
    """Canonical app members are inspected by the controller. Check physical containment again on Linux."""
    dest.mkdir(mode=0o755)
    seen, links, total = set(), [], 0
    with tarfile.open(source, "r:*") as archive:
        for item in archive:
            path = PurePosixPath(item.name)
            require(not path.is_absolute() and ".." not in path.parts, "UNSAFE_ARCHIVE_MEMBER")
            if not path.parts or (not app and path.parts[0] not in ("bin","lib","lib64","usr","etc")):
                continue
            name = str(path)
            require(name not in seen and len(seen) < 200000, "UNSUPPORTED_ARCHIVE_LAYOUT")
            seen.add(name)
            target = dest / name
            require(target.parent.resolve().is_relative_to(dest), "UNSAFE_ARCHIVE_MEMBER")
            target.parent.mkdir(parents=True, exist_ok=True)
            if item.isdir():
                target.mkdir(mode=0o755, exist_ok=True)
            elif item.isfile():
                total += item.size
                require(item.size <= 268435456 and total <= 2147483648, "ARCHIVE_LIMIT")
                with target.open("xb") as out, archive.extractfile(item) as data:
                    shutil.copyfileobj(data, out, 1024 * 1024)
                target.chmod(0o444 | item.mode & 0o111)
            elif item.issym() or (not app and item.islnk()):
                linked = PurePosixPath(item.linkname)
                require(bool(linked.parts) and (not app or not linked.is_absolute()), "UNSAFE_ARCHIVE_MEMBER")
                original = dest / item.linkname.lstrip("/") if linked.is_absolute() or item.islnk() else target.parent / item.linkname
                links.append((target, original, item.islnk()))
            else:
                raise Refused("UNSAFE_ARCHIVE_MEMBER")
        # No extraction through a link. Absolute image links are rebased into this image.
        for target, original, hard in links:
            require(original.resolve().is_relative_to(dest) and not os.path.lexists(target), "UNSAFE_ARCHIVE_MEMBER")
            if hard:
                require(stat.S_ISREG(original.lstat().st_mode), "UNSAFE_ARCHIVE_MEMBER")
                os.link(original, target)
            else:
                target.symlink_to(os.path.relpath(original, target.parent))
        require(all(original.resolve(strict=app).is_relative_to(dest) for _, original, _ in links), "UNSAFE_ARCHIVE_MEMBER")


def skeleton(root, uid, gid):
    for name in ("dev", "tmp", "proc"):
        (root/name).mkdir(exist_ok=True)
    (root/"tmp").chmod(0o1777)
    for name in ("null", "random", "urandom"):
        (root/"dev"/name).touch()
        bind("/dev/" + name, root/"dev"/name)
    shared = root/"dev/shm"
    shared.mkdir(exist_ok=True)
    command(["/bin/mount", "-t", "tmpfs", "-o", "size=64m,mode=1777,nodev,nosuid,noexec", "shm", str(shared)])
    etc = root/"etc"
    etc.mkdir(exist_ok=True)
    # Use only synthetic local accounts in both chroots. No production login or host NSS configuration.
    for name, value in {
        "passwd": "root:x:0:0::/:/bin/false\ntrial:x:%d:%d::/tmp:/bin/false\n" % (uid,gid),
        "group": "root:x:0:\ntrial:x:%d:\n" % gid,
        "nsswitch.conf": "passwd: files\ngroup: files\nhosts: files\n",
    }.items():
        file = etc/name
        if os.path.lexists(file):
            require(file.resolve().is_relative_to(root) and file.is_file(), "UNSAFE_IMAGE_LAYOUT")
            file.unlink()
        file.write_text(value)
        file.chmod(0o444)


def drop(root, uid, gid, cwd="/"):
    def child():
        os.chroot(root)
        os.chdir(cwd)
        os.setgroups([])
        os.setgid(gid)
        os.setuid(uid)
        libc = ctypes.CDLL(None)
        if libc.prctl(38, 1, 0, 0, 0) != 0:
            os._exit(126)
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    return child


ENV = {"HOME": "/tmp", "PATH": "/bin", "TZ": "UTC", "LC_ALL": "C", "UV_USE_IO_URING": "0"}
ROLE = "omnitron_private_migration"
PORT = "15432"


def client_in_namespace(root, args):
    # This process is PID 1 in a fresh network/mount/PID namespace. Its only data socket is the private PostgreSQL one.
    command(["/bin/mount", "-t", "proc", "-o", "nosuid,nodev,noexec", "proc", str(root/"proc")])
    drop(root, 65534, 65534, "/app")()
    resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))
    resource.setrlimit(resource.RLIMIT_NPROC, (128,128))
    resource.setrlimit(resource.RLIMIT_CPU, (1800,1800))
    resource.setrlimit(resource.RLIMIT_FSIZE, (4 * 1024 * 1024, 4 * 1024 * 1024))
    # The caller supplies only these compiler-owned literal choices over a private stdin, never the host's environment.
    env, argv = json.loads(args)
    os.execve("/bin/node", ["/bin/node", *argv], env)


def client(root, args, env=None):
    with tempfile.TemporaryFile() as out:
        result = subprocess.run(["/usr/bin/timeout", "--kill-after=3", "3600", "/usr/bin/unshare", "--mount", "--propagation", "private",
            "--net", "--pid", "--fork", "/usr/bin/setpriv", "--pdeathsig", "KILL", "/usr/bin/python3", "-I", __file__, "client", str(root)],
            input=json.dumps([env or ENV, args]).encode(), stdout=out, stderr=subprocess.DEVNULL,
            env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"}, timeout=3610)
        require(out.tell() <= 3 * 1024 * 1024, "CANDIDATE_OUTPUT_LIMIT")
        out.seek(0)
        return result.returncode, out.read()


TARGET = """import fs from 'node:fs'; import os from 'node:os'; import {createHash} from 'node:crypto';
if(process.getuid()!==65534||Object.keys(os.networkInterfaces()).length||fs.readdirSync('/pg').length||
!/^NoNewPrivs:\\s+1$/m.test(fs.readFileSync('/proc/self/status','utf8')))process.exit(2);
console.log(JSON.stringify({platform:process.platform,arch:process.arch,node:process.version,abi:process.versions.modules,
executableSha256:createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex'),libc:process.report.getReport().header.glibcVersionRuntime??'non-glibc'}));"""
REGISTRY = """import {loadMigrationFiles,HardenedMigrationRunner} from '@omnitron-dev/omnitron/migration';
const rows=await loadMigrationFiles('/app/dist/database/migrations');
console.log(JSON.stringify(rows.map(r=>({name:r.name,checksum:r.checksum??HardenedMigrationRunner.computeChecksum(r)}))));"""


def prepare_client(work, archive, plan):
    root = work/"client"
    root.mkdir(mode=0o755)
    for name in ("bin","pg"):
        (root/name).mkdir()
    skeleton(root, 65534, 65534)
    executable = work/"node"
    require(sha(executable) == plan["target"]["executableSha256"], "RUNTIME_CHANGED")
    os.link(executable, root/"bin/node")
    libraries = re.findall(r"(?:=>\s+|^\s*)(/[^\s]+)\s+\(0x", command(["/usr/bin/ldd", str(executable)]).decode(), re.M)
    require(any("ld-linux" in file or "ld-musl" in file for file in libraries), "UNSUPPORTED_NODE_LOADER")
    for name in libraries:
        file = Path(name)
        dest = root / name.lstrip("/")
        require(file.is_file() and file.resolve().stat().st_uid == 0 and not file.resolve().stat().st_mode & 0o022, "UNTRUSTED_NODE_LIBRARY")
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(file, dest)
        dest.chmod(0o555)
    extract(archive, root/"app", True)
    require(sha(archive) == plan["archiveSha256"] and sha(root/"app"/plan["program"]["path"]) == plan["program"]["sha256"] and
            sha(root/"app/.omnitron-closure.json") == plan["closureSha256"], "ARCHIVE_CHANGED")
    bind(root/"app", root/"app", True)
    status, actual = client(root, ["--input-type=module", "-e", TARGET])
    require(status == 0 and json.loads(actual) == plan["target"], "RUNTIME_CHANGED")
    status, output = client(root, ["--input-type=module", "-e", REGISTRY])
    require(status == 0, "UNSUPPORTED_PACKAGE_REGISTRY")
    rows = sorted(json.loads(output), key=lambda row: row["name"])
    require([row["name"] for row in rows] == plan["names"] and
            all(set(row) == {"name","checksum"} and re.fullmatch(r"[a-f0-9]{64}", row["checksum"]) for row in rows), "PACKAGE_REGISTRY_CHANGED")
    return root, rows


HISTORY = """SELECT coalesce(jsonb_agg(to_jsonb(history) ORDER BY name COLLATE "C"),'[]') FROM (
  SELECT coalesce(m.name,c.name) AS name, c.checksum,
    to_char(m.executed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "executedAt"
  FROM public.migrations m FULL JOIN public.migration_checksums c ON c.name=m.name
  ORDER BY coalesce(m.name,c.name) COLLATE "C" LIMIT 4097) history"""


def trial(work, data, archive):
    plan = json.loads((work/"plan.json").read_bytes())
    require(len(plan["names"]) <= 4096 and plan["program"]["path"] == "dist/database/migrate.js" and
            re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,62}", plan["database"]) and
            re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,62}", plan["producerApp"]), "INVALID_TRIAL")
    # Nothing is connected to the candidate while reading its runtime and complete set of definitions.
    app, registry = prepare_client(work, archive, plan)
    dbroot = work/"pg"
    extract(work/"postgres.tar", dbroot, False)
    uid, gid = data.stat().st_uid, data.stat().st_gid
    require(uid not in (0,65534) and gid != 0 and stat.S_IMODE(data.lstat().st_mode) in (0o700,0o750) and
            data.resolve() == data and (data/"PG_VERSION").read_text().strip() == "17" and
            all(not os.path.lexists(data/f) for f in ("postmaster.pid","standby.signal","recovery.signal")) and
            not (data/"pg_wal").is_symlink() and not any((data/"pg_tblspc").iterdir()), "UNSUPPORTED_POSTGRES_COPY")
    skeleton(dbroot, uid, gid)
    for name in ("data","socket"):
        (dbroot/name).mkdir()
    os.chown(dbroot/"socket", uid, gid)
    (dbroot/"socket").chmod(0o755)
    bind(data, dbroot/"data")
    database = plan["database"]
    (dbroot/"trial.hba").write_text('local "' + database + '" postgres peer map=trialcheck\nlocal "' + database + '" ' + ROLE + ' trust\nlocal all all reject\n')
    (dbroot/"trial.ident").write_text("trialcheck trial postgres\n")
    (dbroot/"trial.conf").write_text("data_directory='/data'\nhba_file='/trial.hba'\nident_file='/trial.ident'\nlisten_addresses=''\n"
        "unix_socket_directories='/socket'\nunix_socket_permissions=0777\nport="+ PORT + "\narchive_mode=off\nshared_preload_libraries=''\n"
        "ssl=off\nlogging_collector=off\nmax_logical_replication_workers=0\nautovacuum=off\nfsync=on\nsynchronous_commit=on\n"
        "max_connections=16\nshared_buffers=16MB\njit=off\n")
    auto = dbroot/"data/postgresql.auto.conf"
    if os.path.lexists(auto):
        require(stat.S_ISREG(auto.lstat().st_mode), "UNSAFE_POSTGRES_CONFIG")
        (dbroot/"empty.conf").touch()
        bind(dbroot/"empty.conf", auto, True)
    pg = next((name for name in ("/usr/local/bin","/usr/lib/postgresql/17/bin") if (dbroot/name.lstrip("/")/"postgres").is_file()), None)
    require(pg, "POSTGRES_EXECUTABLE_UNAVAILABLE")
    runner = drop(dbroot, uid, gid)
    env = {"HOME": "/tmp", "PATH": pg + ":/usr/bin:/bin", "TZ": "UTC", "LC_ALL": "C"}

    def sql(statement, must_succeed=True):
        result = subprocess.run([pg+"/psql","-X","-At","-v","ON_ERROR_STOP=1","-h","/socket","-p",PORT,"-U","postgres","-d",database,"-c",statement],
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=25, env=env, preexec_fn=runner)
        if must_succeed:
            require(result.returncode == 0 and len(result.stdout) <= 2 * 1024 * 1024, "PRIVATE_SQL_OBSERVATION_FAILED")
        return result

    server = subprocess.Popen([pg+"/postgres","-D","/data","-c","config_file=/trial.conf"], stdin=subprocess.DEVNULL,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, preexec_fn=runner)
    try:
        limit = time.monotonic() + 30
        while sql("SELECT 1", False).returncode:
            require(server.poll() is None and time.monotonic() < limit, "PRIVATE_POSTGRES_UNAVAILABLE")
            time.sleep(0.1)
        require(sql("SELECT count(*) FROM pg_catalog.pg_class WHERE relnamespace='public'::regnamespace AND "
                    "relname IN ('migrations','migration_checksums') AND relkind='r'").stdout.strip() == b"2", "HISTORY_TABLES_UNAVAILABLE")
        before = json.loads(sql(HISTORY).stdout)
        baseline = [row for row in registry if row["name"] not in plan["added"]]
        def keys(rows):
            return [{k: row[k] for k in ("name","checksum")} for row in rows]
        require(keys(before) == baseline and all(row["executedAt"] for row in before), "BASELINE_HISTORY_DIFFERS")
        # No existing database identity, password, server HBA, service environment or outbound route is given to the candidate.
        sql("CREATE ROLE "+ROLE+" LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION; GRANT USAGE,CREATE ON SCHEMA public TO "+ROLE+
            "; GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON ALL TABLES IN SCHEMA public TO "+ROLE+
            "; GRANT USAGE,SELECT,UPDATE ON ALL SEQUENCES IN SCHEMA public TO "+ROLE)
        bind(dbroot/"socket", app/"pg", True)
        prefix = plan["producerApp"].upper().replace("-", "_") + "__DATABASE__"
        connection = {prefix+k:v for k,v in {"HOST":"/pg","PORT":PORT,"DATABASE":database,"USER":ROLE,"PASSWORD":"private-trial-only"}.items()}
        options = plan["nodeOptions"]
        require(options == "" or re.fullmatch(r"--max-old-space-size=[1-9][0-9]{0,6}", options), "INVALID_RUNTIME_OPTIONS")
        args = ([options] if options else []) + ["/app/"+plan["program"]["path"]]
        require(client(app, [*args,"--verify"], {**ENV, **connection})[0] == 0, "CANDIDATE_PREFLIGHT_FAILED")
        require(json.loads(sql(HISTORY).stdout) == before, "PREFLIGHT_HISTORY_CHANGED")
        require(client(app, args, {**ENV, **connection})[0] == 0, "CANDIDATE_UP_FAILED")
        after = json.loads(sql(HISTORY).stdout)
        require(keys(after) == registry and [row for row in after if row["name"] not in plan["added"]] == before and
                all(row["executedAt"] for row in after), "RESULT_HISTORY_DIFFERS")
        require(client(app, [*args,"--verify"], {**ENV, **connection})[0] == 0 and
                json.loads(sql(HISTORY).stdout) == after, "FINAL_HISTORY_DIFFERS")
    finally:
        if server.poll() is None:
            server.send_signal(signal.SIGINT)
            try:
                server.wait(timeout=30)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=10)
        require(server.returncode == 0, "PRIVATE_POSTGRES_SHUTDOWN_UNCONFIRMED")
    return {"operationId":plan["copy"]["operationId"], "review":plan["digest"], "registry":registry, "before":before, "after":after}


if __name__ == "__main__":
    if sys.argv[1] == "client":
        client_in_namespace(Path(sys.argv[2]), sys.stdin.read(8192))
    else:
        try:
            print(json.dumps(trial(*map(Path, sys.argv[1:]))))
        except Refused as error:
            print(json.dumps({"refused": str(error)}))
