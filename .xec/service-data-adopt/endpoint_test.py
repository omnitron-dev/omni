"""Verify admission and decoded metadata independently of a running container engine."""

from pathlib import Path
import struct
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import endpoint as ep
import redis_aof


class AdoptionTests(unittest.TestCase):
    def test_native_profile_requires_the_admitted_hash_and_live_enforcement(self):
        content = b"fixture rule"
        expected = ep.hashlib.sha256(content).hexdigest()
        grant = {"validatorProfileSha256": expected}
        self.assertEqual(ep.validator_security({}, None), [])
        with self.assertRaisesRegex(ValueError, "admission"):
            ep.validator_security({}, expected)
        with patch.object(ep, "read_file", return_value=content), patch.object(Path, "read_text") as kernel:
            kernel.return_value = ep.VALIDATOR_PROFILE + " (enforce)\n"
            self.assertEqual(
                ep.validator_security(grant, expected),
                ["--security-opt", "apparmor=" + ep.VALIDATOR_PROFILE],
            )
            kernel.return_value = ep.VALIDATOR_PROFILE + " (complain)\n"
            with self.assertRaisesRegex(ValueError, "enforced"):
                ep.validator_security(grant, expected)
            with self.assertRaisesRegex(ValueError, "admission"):
                ep.validator_security(grant, None)

    def test_836_mib_aof_requires_both_tmpfs_space_and_an_independent_memory_reserve(self):
        size = 836 * 1024**2
        with (
            patch.object(redis_aof.os, "statvfs") as fs,
            patch.object(redis_aof, "memory_available") as memory,
        ):
            fs.return_value = SimpleNamespace(f_bavail=size // 4096, f_frsize=4096)
            memory.return_value = 2 * size
            redis_aof.capacity("/dev/shm", size, size)
            memory.return_value -= 1
            with self.assertRaisesRegex(ValueError, "Insufficient Redis AOF scratch"):
                redis_aof.capacity("/dev/shm", size, size)
            memory.return_value = 4 * size
            fs.return_value.f_bavail -= 1
            with self.assertRaisesRegex(ValueError, "Insufficient Redis AOF scratch"):
                redis_aof.capacity("/dev/shm", size, size)

    def test_ancestor_cgroup_memory_high_can_be_lower_than_host_and_leaf_headroom(self):
        contents = {
            "/proc/meminfo": "MemAvailable: 4194304 kB\n",
            "/proc/self/cgroup": "0::/tenant/unit\n",
            "/sys/fs/cgroup/tenant/unit/memory.max": "max",
            "/sys/fs/cgroup/tenant/memory.high": "9000",
            "/sys/fs/cgroup/tenant/memory.current": "6500",
        }
        with (
            patch.object(Path, "read_text", lambda p: contents[str(p)]),
            patch.object(Path, "is_dir", return_value=True),
            patch.object(Path, "is_file", lambda p: str(p) in contents),
        ):
            self.assertEqual(redis_aof.memory_available(), 2500)

    def test_local_consent_must_be_current_and_bound_to_the_exact_restore(self):
        seed, binding = {"id": "fixture"}, {"spec": "one", "enginePid": 123}
        grant = {"schema": 1, "binding": ep.sha(binding), "expires": 200}
        with (
            patch.object(ep.time, "time", return_value=100),
            patch.object(ep, "record", return_value=grant),
        ):
            self.assertEqual(ep.checked_grant(seed, binding), grant)
            with self.assertRaisesRegex(ValueError, "grant"):
                ep.checked_grant(seed, {**binding, "enginePid": 124})
        with (
            patch.object(ep.time, "time", return_value=200),
            patch.object(ep, "record", return_value=grant),
        ):
            with self.assertRaisesRegex(ValueError, "grant"):
                ep.checked_grant(seed, binding)

    def test_host_and_acl_ids_use_distinct_maps(self):
        maps = {"uid_map": [[0, 995, 1], [1, 100000, 65536]], "gid_map": [[0, 984, 1], [1, 100000, 65536]]}
        self.assertTrue(all(ep.maps_valid(v) for v in maps.values()))
        self.assertFalse(ep.maps_valid([[0, 995, 1], [1, 995, 10]]))
        self.assertEqual(ep.host_to_logical(995, maps["uid_map"]), 0)
        self.assertEqual(ep.host_to_logical(984, maps["gid_map"]), 0)
        self.assertEqual(ep.host_to_logical(100076, maps["uid_map"]), 77)
        x = struct.pack("<IHHIHHIHHI", 2, 2, 4, 100076, 8, 4, 100087, 16, 4, 0xFFFFFFFF)
        self.assertEqual(ep.logical_acl(x, maps), [[2, 4, 77], [8, 4, 88], [16, 4, 0xFFFFFFFF]])
        with self.assertRaises(ValueError):
            ep.host_to_logical(995, maps["gid_map"])
        with self.assertRaises(ValueError):
            ep.logical_acl(x[:-1], maps)

    def test_only_reviewed_receiving_rsync_on_the_pinned_directory_is_accepted(self):
        good = ["service-local", "rsync", "--server", "-lHogDtprcSXxe.iLsfxCIvu", "--numeric-ids", ".", "."]
        self.assertEqual(ep.receiver_args(good), good[1:])
        for altered in [
            good[:-1] + ["/etc"],
            good[:2] + ["--sender"] + good[2:],
            good[:-2] + ["--files-from=/tmp/list", ".", "."],
            good[:-2] + ["--backup-dir=/outside", ".", "."],
            good[:3] + ["-lrKHe.iLsfxCIvu"] + good[4:],
            good[:4] + ["-K"] + good[4:],
            ["elsewhere", *good[1:]],
        ]:
            with self.assertRaises(ValueError):
                ep.receiver_args(altered)

    def test_new_allocations_refuse_preexisting_named_or_covering_container_bind(self):
        def conflicting(*cmd):
            if cmd[0] == "ps":
                return "a" * 64
            return '[{"Source":"/sandbox/volumes"}]'

        with self.assertRaisesRegex(ValueError, "references"):
            ep.unattached(conflicting, [Path("/sandbox/volumes/service/_data")])
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            seed = {"volumes": [{"tag": "redis-data", "volume": "fixture-redis"}]}
            binding = {"volumes": {"redis-data": "fixture-redis"}}

            def existing(*cmd):
                if cmd[0] == "ps":
                    return ""
                self.assertEqual(cmd, ("volume", "ls", "--quiet"))
                return "fixture-redis"

            with self.assertRaisesRegex(ValueError, "unallocated"):
                ep.reserve({}, seed, binding, state, existing, state, True)
            self.assertFalse((state / "volumes.json").exists())


if __name__ == "__main__":
    unittest.main()
