"""Preserve the admitted seed's cold path while checking legacy Redis AOF through independent files."""

from pathlib import PurePosixPath
import sys
from redis_aof import check_copy


def install(seed):
    standard = seed["run_validator"]

    def validate(row, root, command, *args):
        if command != "redis-check-aof":
            return standard(row, root, command, *args)
        if row["tag"] != "redis-data" or len(args) != 1:
            raise ValueError("Unexpected historic Redis validation request")
        arg = PurePosixPath(args[0])
        if arg.parts[:2] != ("/", "input") or ".." in arg.parts:
            raise ValueError("Redis AOF must belong to the admitted volume")
        owner = root.stat()

        def native(work, name):
            return seed["output"](
                [
                    "docker",
                    "run",
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
                    f"{owner.st_uid}:{owner.st_gid}",
                    "--tmpfs",
                    "/data:ro,nosuid,nodev,noexec,size=4096,mode=0555",
                    "--env",
                    "LC_ALL=C",
                    "--mount",
                    "type=bind,source=" + str(work) + ",target=/work",
                    "--entrypoint",
                    "redis-check-aof",
                    row["image"],
                    "/work/" + name,
                ],
                timeout=21600,
            )

        return check_copy(root, arg.relative_to("/input"), 0, native)

    seed["run_validator"] = validate


def run(seed):
    if len(sys.argv) != 4 or sys.argv[1] != "cold":
        raise ValueError("The Redis working-copy adapter only runs the original cold action")
    install(seed)
    try:
        seed["main"]()
    except (ValueError, seed["ch"].Refusal) as error:
        sys.exit(str(error))
    except Exception as error:
        sys.exit("Service data endpoint stopped (" + type(error).__name__ + ")")
