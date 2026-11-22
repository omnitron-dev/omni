"""Check the physical switchover and private PostgreSQL observer boundaries."""
import hashlib
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

import proof
from proof import applied, identity, promoted, terminal
# The Pipeline installs this file under its transport name.
sys.modules["pg_switch_proof"] = proof
import endpoint


class TerminalProof(unittest.TestCase):
    control = ("Database system identifier: 123456789\nDatabase cluster state: shut down\n"
               "Latest checkpoint location: 2/3000170\nLatest checkpoint's TimeLineID: 1")
    record = ("rmgr: XLOG len (rec/tot): 114/114, tx: 0, lsn: 2/03000170, prev 2/03000148, "
              "desc: CHECKPOINT_SHUTDOWN redo 2/3000170; tli 1; prev tli 1; shutdown")

    def test_pre_stop_flush_is_equal_to_start_of_the_final_record(self):
        source = terminal(self.control, self.record)
        for reply, recovering in [("123456789|1|2/3000170|", True), ("123456789|1|2/2000000|", True),
                                  ("123456789|2|2/30001E8|", True), ("123456788|1|2/30001E8|", True),
                                  ("123456789|1|2/30001E8|", False)]:
            with self.subTest(reply=reply, recovering=recovering), self.assertRaises(ValueError):
                applied(source, reply, recovering)
        before = applied(source, "123456789|1|2/30001E8|", True)
        primary = "123456789|2|2/3000220|"
        self.assertEqual(promoted(before, primary, False, "1\t2/30001E8\tno recovery target")["forkLsn"], "2/30001E8")
        for history in ["2 2/30001E8", "1 2/3000170", "1 2/3000700", "", "1 2/30001E8\n2 2/30001F2"]:
            with self.subTest(history=history), self.assertRaises(ValueError):
                promoted(before, primary, False, history)

    def test_native_record_and_physical_identity(self):
        for control, record in [(self.control.replace("shut down", "in production"), self.record),
                                (self.control, self.record.replace("CHECKPOINT_SHUTDOWN", "CHECKPOINT_ONLINE")),
                                (self.control, self.record.replace("lsn: 2/03000170", "lsn: 2/03000178")),
                                (self.control, self.record.replace("tli 1;", "tli 2;"))]:
            with self.subTest(control=control, record=record), self.assertRaises(ValueError):
                terminal(control, record)
        for invalid in ["123456789|1|1/100000000|", "123456789|0|1/20|", "123456789|1|1/20|postgres"]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                identity(invalid)


class AttachedHoldings(unittest.TestCase):
    generation = "274de545-1e4f-402d-bdd8-fd571ea7939d"
    inside = Path("/opt/omnitron-pg-274de545/bin")
    profile = "omnitron-fixture-postgres"

    def test_mount_identity_and_vetted_image_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = root / self.generation / "entries/17"
            files.mkdir(parents=True)
            expected = {}
            for n in endpoint.REQUIRED_TOOLS:
                content = ("fixture-" + n).encode()
                expected[n] = Path("/usr/local/bin") / n, hashlib.sha256(content).hexdigest()
                f = files / n
                f.write_bytes(content)
                f.chmod(0o555)
            source = {"Type": "bind", "RW": False, "Source": str(files), "Destination": str(self.inside)}
            engine = mock.Mock()
            engine.native_programs.return_value = expected
            lstat = Path.lstat

            def fixture_owner(p):
                r = lstat(p)
                # Model the receiver's root-owned site tree, preserving file type and file permissions.
                return SimpleNamespace(st_uid=0, st_mode=stat.S_IFDIR | 0o755 if p in (files, *files.parents) else r.st_mode)

            guarded = endpoint.guarded_command(self.profile, expected["postgres"][0])
            def inspect(mounts, profile=self.profile, entry=None, args=None):
                return endpoint.attached_tools(engine, self.generation, 17, "sha256:" + "1" * 64,
                                               entry or str(self.inside / "sh"), profile, mounts, guarded if args is None else args)

            with mock.patch.object(endpoint, "TOOL_ROOT", root), mock.patch.object(Path, "lstat", fixture_owner):
                self.assertIsNone(inspect([], None, "postgres"))
                self.assertEqual(inspect([source]), endpoint.AttachedTools(files, self.inside, expected))
                for argv in ([], ["-c", "postgres"], [*guarded[:-1], str(self.inside / "postgres")],
                             [guarded[0], "exec /bin/sh", *guarded[2:]]):
                    with self.subTest(argv=argv), self.assertRaisesRegex(ValueError, "reviewed native postmaster"):
                        inspect([source], args=argv)
                for binding, policy in (([], self.profile), ([source], None), ([source, source], self.profile),
                                        ([{**source, "RW": True}], self.profile),
                                        ([{**source, "Source": str(root)}], self.profile)):
                    with self.subTest(binding=binding, policy=policy), self.assertRaises(ValueError):
                        inspect(binding, policy)
                extra = files / "other"
                extra.write_bytes(b"another application")
                with self.assertRaisesRegex(ValueError, "inventory"):
                    inspect([source])
                extra.unlink()
                exe = files / "postgres"
                exe.chmod(0o755)
                with self.assertRaisesRegex(ValueError, "reviewed PostgreSQL image"):
                    inspect([source])
                exe.write_bytes(b"wrong ELF")
                exe.chmod(0o555)
                with self.assertRaisesRegex(ValueError, "reviewed PostgreSQL image"):
                    inspect([source])
                exe.unlink()
                exe.symlink_to(files / "psql")
                with self.assertRaisesRegex(ValueError, "reviewed PostgreSQL image"):
                    inspect([source])
                for item in files.iterdir():
                    if item.name != "sh":
                        item.unlink()
                self.assertEqual(inspect([source]).programs["postgres"][0], Path("/usr/local/bin/postgres"))

    def test_observer_checks_its_own_label_before_exec(self):
        candidate = object.__new__(endpoint.Candidate)
        candidate.engine = mock.Mock()
        candidate.engine.defaults.return_value = {}
        candidate.major, candidate.profile = 17, self.profile
        candidate.row = {"image": "sha256:" + "1" * 64, "target": "/var/lib/postgresql/data"}
        candidate.bind, candidate.socket_name = {"volume": "base"}, "socket"
        candidate.tools = None
        candidate.run("psql", "-V")
        classic = candidate.engine.run.call_args.args
        self.assertEqual(classic[classic.index("--entrypoint") + 1], "psql")
        programs = {name: (Path("/usr/local/bin") / name, "1" * 64) for name in endpoint.REQUIRED_TOOLS}
        candidate.tools = endpoint.AttachedTools(Path("/scoped/entries/17"), self.inside, programs)
        candidate.run("psql", "-V")
        args = candidate.engine.run.call_args.args
        self.assertIn("type=bind,source=/scoped/entries/17,target=" + str(self.inside) + ",readonly", args)
        self.assertEqual(args[args.index("--entrypoint") + 1], str(self.inside / "sh"))
        self.assertIn("/usr/local/bin/psql", args)
        self.assertNotIn(str(self.inside / "psql"), args)
        candidate.engine.defaults.return_value = {"/proc": {}}
        with self.assertRaisesRegex(ValueError, "Unexpected observer image volume"):
            candidate.run("psql", "-V")
        code = args[args.index("-ec") + 1]
        required = self.profile + " (enforce)"
        with tempfile.TemporaryDirectory() as tmp:
            label = Path(tmp) / "current"
            fixture = code.replace("/proc/self/attr/apparmor/current", str(label))
            def run():
                return subprocess.run(["/bin/sh", "-ec", fixture, "observer", required, "/bin/echo", "executed"],
                                      capture_output=True, env={**os.environ, "label": required})
            self.assertNotEqual(run().returncode, 0)
            for value in ("runc (unconfined)", self.profile + "//&unconfined (enforce)", self.profile + " (complain)"):
                label.write_text(value)
                self.assertEqual(run().stdout, b"")
                self.assertNotEqual(run().returncode, 0)
            label.write_text(required)
            self.assertEqual(run().stdout, b"executed\n")

    def test_vendor_digests_use_an_empty_immutable_image_and_cache_the_result(self):
        e = object.__new__(endpoint.Engine)
        e.image_tools = {}
        image = "sha256:" + "1" * 64
        e.defaults = mock.Mock(return_value={"/var/lib/postgresql/data": {}})
        e.run = mock.Mock(return_value="2" * 64 + "  /usr/local/bin/postgres")
        self.assertEqual(e.native_programs(image, 17, {"postgres"}), {"postgres": (Path("/usr/local/bin/postgres"), "2" * 64)})
        args = e.run.call_args.args
        self.assertIn("/var/lib/postgresql/data:ro,noexec,nosuid,nodev,size=4096", args)
        self.assertIn(image, args)
        self.assertNotIn("--mount", args)
        e.native_programs(image, 17, {"postgres"})
        self.assertEqual(e.run.call_count, 1)
        e.run.return_value = "2" * 64 + "  /usr/bin/unrelated"
        with self.assertRaisesRegex(ValueError, "Unexpected native image program"):
            e.native_programs(image, 17, {"psql"})
        e.run.return_value = "2" * 64 + "  /var/lib/postgresql/data/psql"
        with self.assertRaisesRegex(ValueError, "Unexpected native image program"):
            e.native_programs(image, 17, {"psql"})

    def test_live_postmaster_matches_original_image_inode_bytes_and_label(self):
        with tempfile.TemporaryDirectory() as tmp:
            local = Path(tmp)
            proc, host_net = local / "process", local / "host-net"
            native = Path("/usr/local/bin/postgres")
            data = proc / "root/var/lib/postgresql/data"
            socket = proc / "root/run/omnitron-pg"
            executable = proc / "root" / str(native).lstrip("/")
            label = proc / "attr/apparmor/current"
            for directory in (data, socket, executable.parent, label.parent, proc / "ns"):
                directory.mkdir(parents=True)
            executable.write_bytes(b"native fixture")
            (proc / "exe").symlink_to(executable)
            expected = hashlib.sha256(executable.read_bytes()).hexdigest()
            attached = endpoint.AttachedTools(local, self.inside, {"postgres": (native, expected)})
            (proc / "ns/net").touch()
            host_net.touch()
            owner = data.stat()
            props = (f"Uid:\t{owner.st_uid}\nGid:\t{owner.st_gid}\nNoNewPrivs:\t1\n"
                     "CapEff:\t0\nCapPrm:\t0\nCapBnd:\t0\nCapAmb:\t0\n")
            (proc / "status").write_text(props)
            label.write_text(self.profile + " (enforce)")
            directory_open = os.open
            def mapped_path(p):
                if str(p).startswith("/proc/self/fd/"):
                    return proc
                return host_net if str(p) == "/proc/1/ns/net" else Path(p)
            def inspect():
                return endpoint.running_postmaster(12345, data, socket, "/var/lib/postgresql/data", self.profile, attached)
            with mock.patch.object(endpoint.os, "open", side_effect=lambda path, flags: directory_open(proc, flags)), \
                 mock.patch.object(endpoint, "Path", side_effect=mapped_path):
                inspect()
                label.write_text("runc (unconfined)")
                with self.assertRaisesRegex(ValueError, "kernel security label"):
                    inspect()
                label.write_text(self.profile + " (enforce)")
                executable.write_bytes(b"another native program")
                with self.assertRaisesRegex(ValueError, "differs from the native image"):
                    inspect()
                executable.write_bytes(b"native fixture")
                foreign = local / "foreign/postgres"
                foreign.parent.mkdir()
                foreign.write_bytes(executable.read_bytes())
                (proc / "exe").unlink()
                (proc / "exe").symlink_to(foreign)
                with self.assertRaisesRegex(ValueError, "differs from the native image"):
                    inspect()


if __name__ == "__main__":
    unittest.main()
