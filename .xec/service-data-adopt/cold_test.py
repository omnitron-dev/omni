"""Run the retained seed's full native cold validators against independent, real Linux service fixtures."""

import contextlib
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

import cold_compat
import endpoint as adopt


def check_registered_entry(out, seed, digest):
    program = (out / "seed-program.py").read_bytes()
    assert hashlib.sha256(program).hexdigest() == digest
    tools = Path("/var/lib/omnitron-service-data-tools")
    tools.mkdir(mode=0o700, exist_ok=True)
    adopt.safe_dir(tools)
    helper = tools / digest
    if not helper.exists():
        with helper.open("xb") as file:
            file.write(program)
            os.fchmod(file.fileno(), 0o500)
    assert adopt.read_file(helper) == program
    graph = json.loads((out / "native-retained-cold.pipeline.json").read_text())
    command = next(step for step in graph["steps"] if step["name"] == "cold")
    assert graph["name"] == "service-data-" + seed["id"] + "-retained-cold"
    assert command["nodeId"] == seed["sourceNode"] and digest in command["run"]
    # This isolated host owns only the fixture receiver identity. Replaying the donor step must stop before I/O.
    assert seed["sourceFingerprint"] != seed["receiverFingerprint"]
    attempt = subprocess.run(["/bin/sh", "-ec", command["run"]], capture_output=True, text=True, timeout=45)
    assert (
        attempt.returncode != 0
        and attempt.stderr.strip() == "Endpoint differs from its reviewed host identity"
    ), attempt.stderr


def fixture(out):
    assert os.geteuid() == 0 and Path("/etc/hostname").read_text().strip() == "service-data-fixture"
    assert out.is_mount() and set(os.listdir("/sys/class/net")) == {"lo"}
    seed = json.loads((out / "fixture-spec.json").read_text())
    digest = "1774d8587171e5481ba010493223470fdc6e737f858806dd4d9ae3238edde3ff"
    check_registered_entry(out, seed, digest)
    state = adopt.STATE / seed["id"]
    module = adopt.load_checked_seed(state, digest)
    source = Path(seed["stageParent"])
    assert source.parent == Path("/srv") and source.name.startswith("service-adoption-full-")
    rows = seed["volumes"]
    with (
        tempfile.TemporaryDirectory(prefix="cold-native-", dir="/srv") as storage,
        contextlib.ExitStack() as clean,
    ):
        scratch = Path(storage)
        socket = scratch / "docker.sock"
        server = subprocess.Popen(
            [
                "/usr/bin/dockerd",
                "--host",
                "unix://" + str(socket),
                "--data-root",
                str(scratch / "data"),
                "--exec-root",
                str(scratch / "run"),
                "--pidfile",
                str(scratch / "pid"),
                "--storage-driver=vfs",
                "--bridge=none",
                "--iptables=false",
                "--ip6tables=false",
                "--ip-masq=false",
                "--userland-proxy=false",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        def stop():
            server.terminate()
            server.wait(timeout=45)

        clean.callback(stop)
        cli = ["/usr/bin/docker", "--host", "unix://" + str(socket)]
        for _ in range(120):
            if socket.exists() and subprocess.run([*cli, "info"], capture_output=True).returncode == 0:
                break
            assert server.poll() is None
            time.sleep(0.25)
        else:
            raise RuntimeError("The private rootful fixture engine did not start")
        assert subprocess.check_output(
            [*cli, "info", "--format", "{{.DockerRootDir}}"], text=True
        ).strip() == str(scratch / "data")
        engine = json.loads((out / "engine-report.json").read_text())
        rootless = ["/usr/bin/docker", "--host", "unix:///run/user/" + str(engine["uid"]) + "/docker.sock"]
        for image in sorted({r["image"] for r in rows}):
            with subprocess.Popen([*rootless, "image", "save", image], stdout=subprocess.PIPE) as export:
                subprocess.run(
                    [*cli, "image", "load"], stdin=export.stdout, stdout=subprocess.DEVNULL, check=True
                )
                export.stdout.close()
                assert export.wait() == 0
            assert (
                subprocess.check_output(
                    [*cli, "image", "inspect", "--format", "{{.Id}}", image], text=True
                ).strip()
                == image
            )
        roots, originals = {}, {}
        for row in rows:
            tag, volume = row["tag"], row["volume"]
            subprocess.run([*cli, "volume", "create", volume], stdout=subprocess.DEVNULL, check=True)
            target = Path(
                subprocess.check_output(
                    [*cli, "volume", "inspect", "--format", "{{.Mountpoint}}", volume], text=True
                ).strip()
            )
            assert target == scratch / "data" / "volumes" / volume / "_data" and not any(target.iterdir())
            subprocess.run(
                ["/usr/bin/rsync", "-aHAXS", "--numeric-ids", str(source / tag) + "/", str(target) + "/"],
                check=True,
            )
            export = scratch / ("readonly-" + tag)
            export.mkdir()
            subprocess.run(["mount", "--bind", str(target), str(export)], check=True)
            clean.callback(subprocess.run, ["umount", str(export)], check=True)
            subprocess.run(["mount", "-o", "remount,bind,ro,nosuid,nodev,noexec", str(export)], check=True)
            assert os.statvfs(export).f_flag & os.ST_RDONLY
            roots[tag], originals[tag] = export, target

        # Only the fixture's private Docker socket changes. All native validator arguments come from the seed.
        original = module["output"]
        module["output"] = lambda argv, **opts: original(
            [*cli, *argv[1:]] if argv[0] == "docker" else argv, **opts
        )
        row = next(r for r in rows if r["tag"] == "redis-data")
        redis = roots["redis-data"]
        manifest = next(redis.glob("*/*.manifest")).relative_to(redis)
        try:
            module["run_validator"](row, redis, "redis-check-aof", "/input/" + str(manifest))
        except ValueError:
            pass
        else:
            raise AssertionError("The historical checker unexpectedly passed on canonical read-only AOF")
        before = {
            p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (redis / manifest).parent.iterdir()
        }
        cold_compat.install(module)
        module["check_cold"](seed, roots, originals, persistence="aof")
        assert before == {
            p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (redis / manifest).parent.iterdir()
        }
        corrupt = scratch / "corrupt"
        corrupt.mkdir()
        (corrupt / "appendonly.aof").write_bytes(b"not a Redis command\r\n")
        try:
            module["run_validator"](row, corrupt, "redis-check-aof", "/input/appendonly.aof")
        except ValueError:
            pass
        else:
            raise AssertionError("Corrupt AOF passed its native validator")
        proof = dict(
            helper=digest,
            emittedSourceWorkerRejectedWrongHost=True,
            sourceReadOnly=True,
            unchangedAofMembers=len(before),
            historicReadOnlyFailed=True,
            workingCopyVerified=True,
            corruptAofRejected=True,
            clusters=seed["clusters"],
        )
        (out / "retained-native-cold.json").write_text(json.dumps(proof))
        print(json.dumps(proof), flush=True)


if __name__ == "__main__":
    fixture(Path(sys.argv[1]))
