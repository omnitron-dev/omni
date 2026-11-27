"""Exercise the installed Pipeline worker on disposable Linux Docker/SQLite state."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile


def run(args, **kwargs):
    return subprocess.check_output(args, **kwargs).decode().strip()


def encoded(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def make_image(root):
    """Only the runner's interpreter, loaded standard-library modules and shared libraries."""
    fs = root / "fs"
    copied = set()

    def copy(src, dst):
        if dst not in copied:
            target = fs / dst.lstrip("/")
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, target)
            copied.add(dst)

    def binary(src, dst):
        copy(src, dst)
        linked = run(["ldd", src])
        for name in re.findall(r"(?:=>\s+|^\s*)(/[^\s]+)\s+\(", linked, re.MULTILINE):
            copy(name, name)

    for tool in ("env", "timeout", "sleep", "python3"):
        binary("/usr/bin/" + tool, "/usr/bin/" + tool)
    binary(shutil.which("node"), "/usr/bin/node")
    probe_modules = ("import codecs, encodings.utf_8, gzip, bz2, lzma, json, locale, shlex, struct, subprocess, sys, tarfile, traceback, zlib; "
                     "print(json.dumps([getattr(m,'__file__',None) for m in sys.modules.values()]))")
    for name in json.loads(run(["/usr/bin/python3", "-I", "-B", "-c", probe_modules])):
        if not name or not name.startswith("/usr/lib/python3"):
            continue
        if name.endswith(".so"):
            binary(name, name)
        elif name.endswith(".py"):
            copy(name, name)
    (root / "Dockerfile").write_text("FROM scratch\nCOPY fs/ /\n")
    image = root / "image-id"
    subprocess.run(["docker", "build", "--network=none", "--pull=false", "--iidfile", image, root], check=True,
                   stdout=subprocess.DEVNULL)
    return image.read_text().strip()


PROBE = '''import json, subprocess, sys, tarfile
request = json.load(sys.stdin)
with tarfile.open("/input/artifacts/ledger.tgz") as archive:
    code = archive.extractfile("app.cjs").read()
with open("/tmp/app.cjs", "wb") as file:
    file.write(code)
subprocess.run(["/usr/bin/node", "--no-warnings", "/tmp/app.cjs"], input=json.dumps(request).encode(), check=True)
'''

# This synthetic application executes the release's own migration and write commands.
# Reopening the database in every phase also checks that Docker retains the tmpfs mount.
APP = '''const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs'), crypto = require('node:crypto');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const q = JSON.parse(fs.readFileSync(0, 'utf8'));
const db = new DatabaseSync('/state/data.sqlite');
db.exec('CREATE TABLE IF NOT EXISTS history(name TEXT PRIMARY KEY, sha256 TEXT); CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, value TEXT)');
if (fs.readFileSync('/input/statics/index.html','utf8') !== ROLE || q.releaseId !== ROLE) process.exit(2);
const prior = ['main/218.sql'], names = [...prior, ...q.addedMigrations];
const phase = q.phase;
const through = phase === 'baseline' ? 1 : phase === 'candidate-partial' ? 2 : 3;
if (phase === 'baseline' || phase === 'candidate-partial' || phase === 'candidate-write' || phase === 'recovery-complete')
  for (const name of names.slice(0, through))
    db.prepare('INSERT OR IGNORE INTO history VALUES (?,?)').run(name, sha('SQL '+name));
const insert = phase === 'baseline' ? 'before' : phase.startsWith('candidate-') ? 'candidate' :
  ['recovery-write','recovery-replay'].includes(phase) ? 'after' : null;
if (insert) db.prepare('INSERT OR IGNORE INTO records VALUES (?,?)').run(insert, q.challenge+insert);
const history = db.prepare('SELECT name,sha256 FROM history ORDER BY rowid').all();
const rows = Object.fromEntries(db.prepare('SELECT id,value FROM records').all().map(r=>[r.id,sha(JSON.stringify(r))]));
const checked = JSON.stringify(history) === JSON.stringify(names.slice(0,through).map(name=>({name,sha256:sha('SQL '+name)})));
console.log(JSON.stringify({phase, challenge:q.challenge, history, records:{awards:rows},
  verification:{exitCode:checked?0:2,checkedMigrations:history.length,historySha256:sha(JSON.stringify(history))}}));
db.close();
'''


def inputs(root, image, runtime):
    cas = root / ".omnitron/recovery-inputs"
    cas.mkdir(parents=True)

    def retain(raw):
        key = sha(raw)
        (cas / key).write_bytes(raw)
        return key

    additions = ["main/219.sql", "main/220.sql"]
    spec = {"project": "lab", "stack": "fixture", "nodeId": "production-fixture", "addedMigrations": additions,
            "probe": {"commit": "f"*40, "sha256": retain(PROBE.encode()), "image": image, "recordSets": ["awards"]}}
    for role in ("incumbent", "candidate", "recovery"):
        code = ("const ROLE=" + json.dumps(role) + ";\n" + APP).encode()
        closure = encoded({"protocol": 1, "runtime": runtime})
        with io.BytesIO() as output:
            with tarfile.open(fileobj=output, mode="w:gz") as tar:
                for name, raw in [("app.cjs", code), (".omnitron-closure.json", closure)]:
                    entry = tarfile.TarInfo(name)
                    entry.size = len(raw)
                    tar.addfile(entry, io.BytesIO(raw))
            archive = output.getvalue()
        names = ["main/218.sql"] + ([] if role == "incumbent" else additions)
        migrations = {name: sha(("source " + name).encode()) for name in names}
        git = sha(role.encode())[:40]
        archive_sha = retain(archive)
        manifest = {"id": role, "project": {"commit": git}, "builtWith": {"target": runtime}, "migrations": migrations,
                    "artifacts": [{"app": "ledger", "sha256": archive_sha, "bytes": len(archive), "closureSha256": sha(closure),
                                   "packageSource": {"migrations": migrations, "migrationPrograms": [{"release": "app.cjs",
                                                                                                      "releaseSha256": sha(code)}]}}],
                    "statics": {"files": 1, "bytes": len(role)}}
        index = {"index.html": {"bytes": len(role), "sha256": retain(role.encode())}}
        spec[role] = {"id": role, "manifestSha256": retain(encoded(manifest)), "commit": git, "tree": git,
                      "artifacts": {"ledger": archive_sha}, "staticsIndexSha256": retain(encoded(index))}
    return spec


def main():
    repo = Path(__file__).resolve().parents[4]
    with tempfile.TemporaryDirectory(prefix="omni-recovery-fixture-") as folder:
        root = Path(folder)
        image = make_image(root)
        try:
            modules = repo / "apps/omnitron/dist"
            runtime = json.loads(run(["node", "--input-type=module", "-e",
                                      "import {targetRuntime} from " + json.dumps((modules / "release/target-runtime.js").as_uri()) +
                                      ";console.log(JSON.stringify(await targetRuntime()))"]))
            spec = inputs(root, image, runtime)
            code = "import { recoveryQualificationDefinition as graph } from " + json.dumps((modules / "services/recovery-qualification.js").as_uri()) + """;
const nodes = {getNode:id=>({id,host:id,sshPort:22,sshUser:'fixture',createdAt:'2020-01-01'}),
 nodeToSshTarget:async n=>({host:n.host,port:n.sshPort,username:n.sshUser,expectedHostFingerprint:'SHA256:'+(n.id==='qa'?'Q':'P').repeat(43)})};
const g=await graph(JSON.parse(process.argv[1]),'qa',nodes);console.log(g.steps[0].run);"""
            command = run(["node", "--input-type=module", "-e", code, encoded(spec).decode()])
            env = {**os.environ, "HOME": str(root)}
            def execute():
                return subprocess.run(["/bin/sh", "-ec", command], check=False, timeout=300, capture_output=True, env=env)
            ok = execute()
            if ok.returncode != 0:
                raise RuntimeError(ok.stderr.decode())
            receipt = json.loads(ok.stdout)
            assert len(receipt["phases"]) == 10 and receipt["inputs"] == sha(encoded(spec))
            (root / ".omnitron/recovery-inputs" / spec["candidate"]["artifacts"]["ledger"]).write_bytes(b"damaged")
            failed = execute()
            assert failed.returncode != 0 and not failed.stdout and b"admitted bytes" in failed.stderr
            print("Ten isolated Docker phases preserved baseline, new writes, replay and partial history. Corrupt archive refused.")
        finally:
            subprocess.run(["docker", "image", "rm", image], check=True, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
