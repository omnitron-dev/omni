"""Filesystem regressions for the backend observer, using the native seed inventory and generation."""
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "service-data-preseed"))
from endpoint_test import ep, load, sample, scope
channel = load("physical_fixture_channel", HERE.parent / "block-preseed" / "endpoint.py")
observer = load("physical_restore_observer", HERE.parents[1] / "apps/omnitron/data/operations/physical-restore.py")


@unittest.skipUnless(sys.platform == "linux", "Linux inode generations and extended attributes")
class PhysicalEvidence(unittest.TestCase):
    def test_checks_the_original_and_the_restored_history_even_if_current_object_is_absent(self):
        seed = sample()
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            paths = {r["tag"]: home / "source" / r["tag"] for r in seed["volumes"]}
            for path in paths.values():
                path.mkdir(parents=True)
            for tag in ["postgres-data", "nominatim-data"]:
                (paths[tag] / "global").mkdir()
                (paths[tag] / "global/pg_control").write_bytes(("control-" + tag).encode())
            store = paths["minio-data"]
            (store / ".minio.sys").mkdir()
            drive = "09690d67-ca2f-41b4-a6fb-233f948b967d"
            layout = {"version": "1", "format": "xl-single", "id": "63679317-afe8-4798-8933-ed0ecf6dd13d",
                      "xl": {"version": "3", "this": drive, "sets": [[drive]], "distributionAlgo": "SIPMOD+PARITY"}}
            (store / ".minio.sys/format.json").write_text(json.dumps(layout))
            history = store / "archive" / "entry"
            history.mkdir(parents=True)
            (history / "version-one").write_bytes(b"first")
            (history / "version-two").write_bytes(b"second")
            (history / "delete-marker").write_bytes(b"removed")
            shutil.copytree(home / "source", home / "receiver")
            receiver = {tag: home / "receiver" / tag for tag in paths}
            # Restrict process inspection to the synthetic writer owned by this test.
            writers = set()
            ep.ch = channel
            mod = {"inventory": scope.inventory, "stage_stamp": ep.stage_stamp, "sha": scope.sha,
                   "ch": type("OwnWriters", (), {"open_writers": staticmethod(lambda: writers)})}
            checksum = scope.sha({r["tag"]: scope.inventory(paths[r["tag"]], r, seed["volumes"]) for r in seed["volumes"]})
            left = observer.audit(mod, seed, paths, checksum)
            right = observer.audit(mod, seed, receiver, checksum)
            self.assertEqual(left["controls"], right["controls"])
            self.assertNotEqual(left["generation"]["minio-data"], right["generation"]["minio-data"])
            first = receiver["minio-data"] / "archive/entry/version-one"
            st = first.stat()
            writers.add((st.st_dev, st.st_ino))
            with self.assertRaisesRegex(ValueError, "writer"):
                observer.audit(mod, seed, receiver, checksum)
            writers.clear()
            first.write_bytes(b"other")
            with self.assertRaisesRegex(ValueError, "contents differ"):
                observer.audit(mod, seed, receiver, checksum)
            first.write_bytes(b"first")
            renewed = observer.audit(mod, seed, receiver, checksum)
            self.assertNotEqual(right["generation"]["minio-data"], renewed["generation"]["minio-data"])
            layout["xl"]["sets"][0].append("16779317-afe8-4798-8933-ed0ecf6dd11c")
            (receiver["minio-data"] / ".minio.sys/format.json").write_text(json.dumps(layout))
            with self.assertRaisesRegex(ValueError, "one independently complete"):
                observer.marker(receiver["minio-data"], ".minio.sys/format.json")
            (receiver["postgres-data"] / "global/pg_control").unlink()
            (receiver["postgres-data"] / "global/pg_control").symlink_to(paths["postgres-data"] / "global/pg_control")
            with self.assertRaises(OSError):
                observer.marker(receiver["postgres-data"], "global/pg_control")


if __name__ == "__main__":
    unittest.main()
