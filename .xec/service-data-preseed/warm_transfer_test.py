import contextlib
import io
import json
import subprocess
import sys
import time
from types import SimpleNamespace
import unittest

import warm_transfer as warm


class WarmTransferTest(unittest.TestCase):
    def test_idle_budget_uses_the_earlier_lease_and_rejects_an_expired_or_unbounded_attempt(self):
        grants = {"source": {"expires": 300}, "receiver": {"expires": 280}}
        self.assertEqual(warm.idle_budget(1800, grants, 150), 130)
        self.assertEqual(warm.idle_budget(90, grants, 150), 90)
        for seconds in (0, 89, 1801, True, 90.5):
            with self.assertRaises(ValueError):
                warm.idle_budget(seconds, grants, 150)
        with self.assertRaisesRegex(ValueError, "expired"):
            warm.idle_budget(1800, grants, 280)

    def test_only_the_original_warm_inactivity_argument_changes(self):
        spec = {"volumes": [{"tag": "redis-data"}]}
        base = [
            "/usr/bin/rsync",
            "--timeout=90",
            "--bwlimit=32768",
            "--fsync",
            "-M--fake-super",
            "--",
            "src/",
            "target:redis-data/",
        ]
        expires = int(time.time()) + 7200
        seed = {
            "subprocess": subprocess,
            "rsync_args": lambda *a: base.copy(),
            "GRANTS": {s: {"expires": expires} for s in ("source", "receiver")},
        }
        warm.install(seed, spec, 1800)
        self.assertEqual(
            seed["rsync_args"](None, {}, "target", [], 32768, False), [base[0], "--timeout=1800", *base[2:]]
        )
        with self.assertRaisesRegex(ValueError, "warm"):
            seed["rsync_args"](None, {}, "target", [], 32768, True)
        base[1] = "--timeout=0"
        with self.assertRaisesRegex(ValueError, "differs"):
            seed["rsync_args"](None, {}, "target", [], 32768, False)

    def test_real_child_exit_is_preserved_and_diagnostics_contain_only_reviewed_categories(self):
        def launch(argv, **kw):
            self.assertEqual(argv[0], "/usr/bin/rsync")
            child = "import sys;sys.stderr.write('[sender] timeout in data send/receive at private-object-fixture (code 30)\\n');sys.exit(30)"
            return subprocess.Popen([sys.executable, "-c", child], **kw)

        native = SimpleNamespace(Popen=launch, PIPE=subprocess.PIPE, DEVNULL=subprocess.DEVNULL)
        observer = warm.WarmSubprocess(native, {"redis-data"})
        log = io.StringIO()
        with contextlib.redirect_stderr(log):
            child = observer.Popen(
                ["/usr/bin/rsync", "--timeout=1800", "src/", "target:redis-data/"],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
            )
            self.assertEqual(child.wait(timeout=15), 30)
            self.assertEqual(child.wait(timeout=5), 30)
            child.stdout.close()
        self.assertNotIn("private-object-fixture", log.getvalue())
        first, last = map(json.loads, log.getvalue().splitlines())
        self.assertEqual(first["idleSeconds"], 1800)
        self.assertEqual(last["rsyncExit"], 30)
        self.assertEqual(last["rsyncCodes"], [30])
        self.assertEqual(last["diagnostics"]["timed-out"], 1)
        self.assertTrue(last["streamClosed"])
        with self.assertRaisesRegex(ValueError, "Unexpected"):
            observer.Popen(
                ["/usr/bin/rsync", "--timeout=1800", "src/", "target:foreign/"], stderr=subprocess.DEVNULL
            )


if __name__ == "__main__":
    unittest.main()
