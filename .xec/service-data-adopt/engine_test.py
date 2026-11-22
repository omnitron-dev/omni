"""Exercise exported restore and verify steps on a dedicated networkless Linux Docker fixture."""

import hashlib
import gzip
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid

import endpoint as adopt


def load_fixture_tools(seed_directory):
    spec = importlib.util.spec_from_file_location("seed_fixture", seed_directory / "endpoint_test.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def unpack_cluster(archive, root, context):
    """Read the fixture's synthetic data and a native OCI validator assembled from its exact source image."""
    control = ""
    with tarfile.open(archive, "r:gz") as source, tarfile.open(context, "w") as image:
        for entry in source:
            path = PurePosixPath(entry.name)
            assert not path.is_absolute() and ".." not in path.parts
            assert entry.isdir() or entry.isfile(), (entry.name, entry.type)
            if path == PurePosixPath("native-control"):
                control = source.extractfile(entry).read().decode()
            elif path.parts and path.parts[0] == "db":
                entry.name = str(PurePosixPath(*path.parts[1:]))
                source.extract(entry, root, numeric_owner=True, filter="fully_trusted")
            elif len(path.parts) > 1 and path.parts[0] == "validator":
                entry.name = str(PurePosixPath(*path.parts[1:]))
                image.addfile(entry, source.extractfile(entry) if entry.isfile() else None)
    return control


def stage_tree(original, stage, wrapper):
    """Exercise the same unprivileged stock rrsync fake-super representation used by the seed receiver."""
    stage.mkdir()
    os.chown(stage, 65534, 65534)
    stage.chmod(0o700)
    wrapper.write_text(
        "#!/usr/bin/python3\nimport os,shlex,sys\na=sys.argv[2:]\n"
        "assert a[:2]==['rsync','--server'] and a[-2:]==['.','.']\n"
        "os.environ['SSH_ORIGINAL_COMMAND']=shlex.join(a)\n"
        "os.execv('/usr/bin/setpriv',['setpriv','--reuid=65534','--regid=65534','--clear-groups',"
        "'/usr/bin/rrsync','-wo','-munge','-no-lock'," + repr(str(stage)) + "])\n"
    )
    wrapper.chmod(0o755)
    subprocess.run(
        [
            "rsync",
            "-aHAXS",
            "--numeric-ids",
            "-M--fake-super",
            "-M--modify-window=-1",
            "-e",
            str(wrapper),
            str(original) + "/",
            "local:.",
        ],
        check=True,
    )


def prepare(out, tools, engine):
    previous = (out / "seed-program.py").read_bytes()
    token = uuid.uuid4()
    original = Path(tempfile.mkdtemp(prefix="service-adoption-full-", dir="/srv"))
    original.chmod(0o711)
    state = adopt.STATE / str(token)
    state.mkdir(mode=0o700, parents=True)
    (state / "receiver.py").write_bytes(previous)
    mod = adopt.load_checked_seed(state, hashlib.sha256(previous).hexdigest())
    channel = mod["ch"]
    seed = tools.sample()
    seed.update(
        id=str(token),
        stageParent=str(original),
        receiverFingerprint=channel.fingerprint(channel.key_text(channel.HOST_KEY)),
    )
    stage = original / ("service-data-" + str(token))
    stage.mkdir(mode=0o711)
    stage.chmod(0o711)
    data = {r["tag"]: original / r["tag"] for r in seed["volumes"]}
    for path in data.values():
        path.mkdir(mode=0o700)
    arch = {"aarch64": "arm64", "arm64": "arm64", "x86_64": "amd64", "amd64": "amd64"}
    clusters = json.loads((out / "cluster-fixtures" / "receipts.json").read_text())
    images = {}
    for tag, fn, service in [
        ("postgres-data", "pg17", "postgres"),
        ("nominatim-data", "pg14", "nominatim"),
        ("redis-data", "redis", "redis"),
    ]:
        archive = out / "cluster-fixtures" / (fn + ".tar.gz")
        with archive.open("rb") as stream:
            assert os.fstat(stream.fileno()).st_size == clusters[fn]["bytes"]
            assert hashlib.file_digest(stream, "sha256").hexdigest() == clusters[fn]["sha256"]
        context = original / (fn + ".tar")
        control = unpack_cluster(archive, data[tag], context)
        if service != "redis":
            seed["clusters"][service] = re.search(r"^Database system identifier:\s*(\d+)$", control, re.M)[
                1
            ]
        architecture = arch[clusters[fn]["arch"]]
        cmd = [
            "docker",
            "--host",
            f"unix:///run/user/{engine['uid']}/docker.sock",
            "image",
            "import",
            "--platform",
            "linux/" + architecture,
            "--change",
            "ENV PATH=/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            str(context),
            "adopt-fixture-" + fn + ":" + token.hex[:8],
        ]
        images[service] = subprocess.check_output(cmd, text=True).strip()
    images["minio"] = images["redis"]
    # Redis 7's real RDB base plus a valid RESP increment exercise its multipart AOF checker.
    redis = data["redis-data"]
    aof = redis / "appendonlydir"
    aof.mkdir()
    os.link(redis / "dump.rdb", aof / "appendonly.aof.1.base.rdb")
    (aof / "appendonly.aof.1.incr.aof").write_bytes(
        b"*2\r\n$6\r\nSELECT\r\n$1\r\n0\r\n*3\r\n$3\r\nSET\r\n$3\r\nkey\r\n$5\r\nvalue\r\n"
    )
    (aof / "appendonly.aof.manifest").write_text(
        "file appendonly.aof.1.base.rdb seq 1 type b\nfile appendonly.aof.1.incr.aof seq 1 type i\n"
    )
    owner = redis.stat()
    for entry in (aof, *aof.iterdir()):
        os.chown(entry, owner.st_uid, owner.st_gid)
    (data["nominatim-data"] / "import-finished").touch()
    (data["nominatim-flatnode"] / "flatnode.file").write_bytes(b"synthetic OSM flatnode snapshot")
    (data["nominatim-merged"] / "source.osm.pbf").write_bytes(b"synthetic OSM import source")
    (data["minio-data"] / ".minio.sys").mkdir()
    (data["minio-data"] / ".minio.sys" / "format.json").write_text('{"version":"1","format":"xl-single"}')
    obj = data["minio-data"] / "fixture-object"
    obj.write_bytes(b"synthetic object")
    os.chown(obj, 12345, 23456)
    os.setxattr(obj, "user.service-fixture", b"plain fixture attribute")
    trees = {}
    logical = {}
    for row in seed["volumes"]:
        tag = row["tag"]
        path = data[tag]
        st = path.lstat()
        row.update(
            device=str(st.st_dev),
            inode=str(st.st_ino),
            image=images[tools.scope.identity(row)],
            volume="adopt-" + token.hex[:8] + "-" + tag,
        )
    for row in seed["volumes"]:
        tag = row["tag"]
        path = data[tag]
        trees[tag] = mod["inventory"](path, row, seed["volumes"])
        logical[tag] = adopt.metadata(path, {"uid_map": adopt.IDENTITY, "gid_map": adopt.IDENTITY})
        stage_tree(path, stage / tag, original / ("rsh-" + tag))
        assert mod["inventory"](stage / tag, row, seed["volumes"], receiver=True) == trees[tag]
    stage.chmod(0o700)
    mod["validate_scope"](seed)
    maps = {"uid_map": adopt.IDENTITY, "gid_map": adopt.IDENTITY}
    identity = {tag: maps for tag in data}

    def observe(name, node, value):
        return dict(
            name=name,
            nodeId=node,
            status="success",
            exitCode=0,
            outputTruncated=False,
            output=json.dumps(value),
        )

    observation = {
        "id": str(uuid.uuid4()),
        "status": "success",
        "review": {"digest": adopt.sha(["fixture-observation", str(token)])},
        "steps": [
            observe("source-volume-namespace", "source", {"maps": identity}),
            observe(
                "target-engine-namespace",
                "receiver",
                dict(daemonPid=engine["pid"], daemonUid=engine["uid"], maps=engine["maps"]),
            ),
        ],
    }
    cold = dict(
        id=str(token), spec=adopt.sha(seed), stop=str(uuid.uuid4()), trees=trees, sha256=adopt.sha(trees)
    )
    sealed = {k: cold[k] for k in ("id", "spec", "stop", "sha256")}
    sealed.update(sealed=True, stage=str(stage))
    for k, v in {
        "spec": seed,
        "sealed": sealed,
        "closed": {"closed": True},
        "receiver": dict(device=str(stage.stat().st_dev), inode=str(stage.stat().st_ino)),
        "observed": dict(
            stop=cold["stop"], cold=cold["sha256"], snapshot=mod["stage_stamp"](stage, seed["volumes"])
        ),
    }.items():
        channel.write_record(state / (k + ".json"), v)
    helper = hashlib.sha256(previous).hexdigest()
    count = (len(gzip.compress(previous, mtime=0)) + 6143) // 6144
    bootstrap = dict(
        id=str(uuid.uuid4()),
        status="success",
        review={"digest": adopt.sha(["fixture-bootstrap", seed["id"]])},
        steps=[
            observe("helper-part-" + str(i), "receiver", dict(part=i, total=count, helperSha256=helper))
            for i in range(1, count + 1)
        ]
        + [
            observe(
                "bootstrap-receiver",
                "receiver",
                dict(side="receiver", spec=cold["spec"], stage=sealed["stage"]),
            )
        ],
    )
    source_bootstrap = {
        **bootstrap,
        "id": str(uuid.uuid4()),
        "steps": [{**step, "nodeId": "source"} for step in bootstrap["steps"][:-1]]
        + [observe("bootstrap-source", "source", dict(side="source", spec=cold["spec"]))],
    }
    grant = dict(spec=cold["spec"], keySha256="SHA256:" + "C" * 43, expires=int(time.time()) + 1800)
    for name, value in {
        "spec": seed,
        "namespaces": observation,
        "cold": cold,
        "seal": sealed,
        "bootstrap": bootstrap,
        "source-bootstrap": source_bootstrap,
        "grants": {
            "source": dict(**grant, side="source"),
            "receiver": dict(**grant, side="receiver", stage=str(stage)),
        },
    }.items():
        (out / ("fixture-" + name + ".json")).write_text(json.dumps(value))
    (state / "expected-metadata.json").write_text(json.dumps(logical))
    print(
        "Independently sealed six GNU fake-super trees from native synthetic PostgreSQL and Redis sources.",
        flush=True,
    )


def execute(out):
    seed = json.loads((out / "fixture-spec.json").read_text())
    state = adopt.STATE / seed["id"]
    registry = adopt.CONSENTS
    registry.mkdir(mode=0o700, parents=True, exist_ok=True)
    binding = json.loads((out / "fixture-binding.json").read_text())["binding"]
    exports = {
        phase: json.loads((out / ("native-fixture-" + phase + ".pipeline.json")).read_text())
        for phase in ("restore", "verify")
    }
    assert binding["seed"] == seed["id"] and binding["spec"] == adopt.sha(seed)
    grant = registry / (seed["id"] + ".json")
    consent = dict(schema=1, binding=adopt.sha(binding), expires=int(time.time()) + 1800)
    grant.write_text(json.dumps(consent))
    grant.chmod(0o600)
    reports = {}
    for phase in ("restore", "verify"):
        if phase == "verify" and (out / "fixture-validator-profile.sha256").is_file():
            consent["validatorProfileSha256"] = (
                (out / "fixture-validator-profile.sha256").read_text().strip()
            )
            grant.write_text(json.dumps(consent))
        step = next(s for s in exports[phase]["steps"] if s["name"] == phase)
        result = subprocess.run(
            ["/bin/sh", "-ec", step["run"]],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=540,
        )
        assert result.returncode == 0, (phase, result.stderr)
        reports[phase] = json.loads(result.stdout)
        assert reports[phase]["volumes"] == binding["volumes"]
        print(phase + " completed on all six private volumes", flush=True)
    expected = adopt.record(state / "expected-metadata.json")
    assert reports["verify"]["verified"] and reports["verify"]["clusters"] == seed["clusters"]
    assert (
        reports["verify"]["metadata"] == expected
        and reports["verify"]["identities"] == reports["restore"]["identities"]
    )
    docker, data = adopt.docker_client(state / "adoption", binding)
    assert not docker("ps", "-aq")
    culprit = next(r for r in seed["volumes"] if r["tag"] == "minio-data")
    target, pin = adopt.volume_identity(docker, data, culprit["volume"], adopt.sha(binding))
    assert reports["verify"]["identities"][culprit["tag"]] == pin
    obj = target / "fixture-object"
    assert adopt.host_to_logical(obj.stat().st_uid, binding["maps"]["uid_map"]) == 12345
    obj.write_bytes(b"unapproved fixture change")
    last = next(s for s in exports["verify"]["steps"] if s["name"] == "verify")
    rejected = subprocess.run(["/bin/sh", "-ec", last["run"]], capture_output=True, text=True, timeout=540)
    assert rejected.returncode != 0
    reports["tamperRejected"] = rejected.stderr.strip()
    (out / "engine-acceptance.json").write_text(json.dumps(reports))
    print(
        "Both native Pipeline endpoint commands passed. A changed target failed verification.", flush=True
    )


def run_fixture(out, seeds, token):
    assert os.geteuid() == 0 and Path("/etc/hostname").read_text().strip() == "service-data-fixture"
    assert set(os.listdir("/sys/class/net")) == {"lo"} and out.is_mount()
    os.umask(0o077)
    if "prepare" in token:
        prepare(out, load_fixture_tools(seeds), json.loads((out / "engine-report.json").read_text()))
    elif "check" in token:
        execute(out)
    else:
        raise ValueError("Expected the fixture's prepare or check phase")


if __name__ == "__main__":
    phase, result, seed_code = sys.argv[1:]
    run_fixture(Path(result), Path(seed_code), phase)
