"""Run only an image's PostgreSQL version command on the attested receiver engine."""

import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import uuid


def probe(args, engine):
    image = args["image"]
    if sys.platform != "linux" or os.geteuid() != 0 or not re.fullmatch("sha256:[a-f0-9]{64}", image):
        raise ValueError("Registered Linux image-probe administration is required")
    key = Path("/etc/ssh/ssh_host_ed25519_key.pub").read_text().split()
    if key[0] != "ssh-ed25519":
        raise ValueError("Receiver has a different SSH key type")
    pin = "SHA256:" + base64.b64encode(
        hashlib.sha256(base64.b64decode(key[1], validate=True)).digest()
    ).decode().rstrip("=")
    if pin != args["fingerprint"]:
        raise ValueError("Receiver SSH identity changed")
    proc, sock, uid, gid = engine(args["engine"])
    result = {
        "nodeId": args["node"],
        "hostFingerprint": pin,
        "enginePid": int(proc.name),
        "engineUid": uid,
        "engineGid": gid,
        "image": image,
    }
    label = "org.omnitron.service-adoption-probe"
    token = str(uuid.uuid4())
    with tempfile.TemporaryDirectory(dir="/run", prefix="omnitron-service-image-probe-") as config:

        def run(*v):
            return subprocess.run(
                ["/usr/bin/docker", "--config", config, "--host", "unix://" + str(sock), *v],
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                timeout=90,
                env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL": "C"},
            )

        def required(*v):
            reply = run(*v)
            if reply.returncode:
                raise ValueError(
                    "Image-only Docker check failed at "
                    + " ".join(v[:2])
                    + " ("
                    + str(reply.returncode)
                    + ")"
                )
            return reply.stdout.strip()

        img = json.loads(
            required(
                "image",
                "inspect",
                "--format",
                '{"id":{{json .Id}},"os":{{json .Os}},"arch":{{json .Architecture}},"volumes":{{json .Config.Volumes}}}',
                image,
            )
        )
        architecture = {"x86_64": "amd64", "aarch64": "arm64"}.get(os.uname().machine)
        if img["id"] != image or img["os"] != "linux" or img["arch"] != architecture or not architecture:
            raise ValueError("Pinned Linux image identity differs")
        declared = set(img["volumes"] or {})
        if not declared <= {args["dataTarget"]}:
            raise ValueError("Image declares an unreviewed automatic volume")
        synthetic = []
        for path in sorted(declared):
            synthetic.extend(["--tmpfs", path + ":ro,nosuid,nodev,noexec,size=4096,mode=0555"])
        flags = [
            "--rm",
            "--pull",
            "never",
            "--network",
            "none",
            "--read-only",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--user",
            "65534:65534",
            "--label",
            label + "=" + token,
            *synthetic,
            "--entrypoint",
            "pg_controldata",
            image,
            "--version",
        ]
        cid = required("container", "create", *flags)
        if not re.fullmatch("[a-f0-9]{64}", cid):
            raise ValueError("Invalid private probe container identity")
        fmt = (
            '{"id":{{json .Id}},"image":{{json .Image}},"probe":{{json (index .Config.Labels "'
            + label
            + '")}},"mounts":{{json .Mounts}},"tmpfs":{{json .HostConfig.Tmpfs}},"binds":{{json .HostConfig.Binds}},"volumesFrom":{{json .HostConfig.VolumesFrom}},"network":{{json .HostConfig.NetworkMode}},"readOnly":{{json .HostConfig.ReadonlyRootfs}},"privileged":{{json .HostConfig.Privileged}},"caps":{{json .HostConfig.CapDrop}},"security":{{json .HostConfig.SecurityOpt}},"entry":{{json .Config.Entrypoint}},"cmd":{{json .Config.Cmd}},"user":{{json .Config.User}}}'
        )
        identity_fmt = "{{.Id}} " + '{{index .Config.Labels "' + label + '"}}'
        try:
            v = json.loads(required("container", "inspect", "--format", fmt, cid))
            if not (
                v["id"] == cid
                and v["image"] == image
                and v["probe"] == token
                and v["network"] == "none"
                and v["readOnly"]
                and not v["privileged"]
                and v["caps"] == ["ALL"]
                and any(x in ("no-new-privileges", "no-new-privileges=true") for x in v["security"])
                and v["entry"] == ["pg_controldata"]
                and v["cmd"] == ["--version"]
                and v["user"] == "65534:65534"
                and not v["binds"]
                and not v["volumesFrom"]
                and set(v["tmpfs"] or {}) == declared
                and all(m["Type"] == "tmpfs" and m["Destination"] in declared for m in v["mounts"] or [])
            ):
                raise ValueError("Container inspection refused the image-only probe before execution")
            result.update(mountedDataVolumes=0, syntheticTmpfs=sorted(declared), architecture=img["arch"])
            started = run("container", "start", "--attach", cid)
            version = started.stdout.strip()
            if started.returncode:
                expected = "Could not check if docker-default AppArmor profile was loaded: open /sys/kernel/security/apparmor/profiles: permission denied"
                if expected not in started.stderr:
                    raise ValueError(
                        "The image-only validator failed for a different reason (Docker exit "
                        + str(started.returncode)
                        + ")"
                    )
                result.update(
                    verified=False, defaultAppArmorInspectionDenied=True, dockerExitCode=started.returncode
                )
            else:
                if not re.fullmatch(
                    r"pg_controldata \(PostgreSQL\) 17(?:\.[0-9]+)+(?:[ \t][^\r\n]*)?", version
                ):
                    raise ValueError("Image command did not report PostgreSQL 17")
                result.update(verified=True, pgControlVersion=version, dockerExitCode=0)
        finally:
            remains = run("container", "inspect", "--format", identity_fmt, cid)
            if not remains.returncode:
                if remains.stdout.strip() != cid + " " + token:
                    raise ValueError("Probe cleanup identity changed")
                required("container", "rm", "--force", "--volumes", cid)
        engine(args["engine"])
    print(json.dumps(result, separators=(",", ":")), flush=True)
    return 0 if result["verified"] else 42
