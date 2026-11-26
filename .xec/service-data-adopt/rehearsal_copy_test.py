"""Exercise the installed private-copy worker on a disposable Linux filesystem."""
import os
from pathlib import Path
import stat
import struct
import subprocess
import sys
import tempfile
import unittest
from uuid import uuid4

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "service-data-preseed"))
from endpoint_test import ep, load, sample, scope
channel = load("rehearsal_channel", HERE.parent / "block-preseed/endpoint.py")
adopt = load("rehearsal_adopt", HERE / "endpoint.py")
worker = load("private_data_rehearsal", HERE.parents[1] / "apps/omnitron/data/operations/rehearsal-copy.py")


def fixture(paths, scratch, state=None):
    """Local physical facts for the filesystem tests. Graph and release admission have separate RPC coverage."""
    seed = sample()
    state = state or scratch.parent / "fixture-adoption-state"
    state.mkdir(mode=0o700, exist_ok=True)
    mod = {"stage_stamp": ep.stage_stamp, "inventory": scope.inventory, "ch": channel}
    ep.ch = channel
    binding = {"maps": {"uid_map": adopt.IDENTITY, "gid_map": adopt.IDENTITY},
               "volumes": {r["tag"]: r["volume"] for r in seed["volumes"]}}
    def observed():
        result = {}
        writers = channel.open_writers()
        for row in seed["volumes"]:
            tag = row["tag"]
            if tag not in paths:
                continue
            path = paths[tag]
            st = path.stat()
            result[tag] = dict(tag=tag, volume=row["volume"], source={k:row[k] for k in ("device","inode")},
                               receiver={"device": str(st.st_dev), "inode": str(st.st_ino)},
                               receiverGeneration=ep.stage_stamp(path.parent, [{"tag": path.name}]),
                               metadataSha256=adopt.metadata(path, binding["maps"], writers),
                               **scope.inventory(path, row, seed["volumes"], writers=writers))
        return result
    held = observed()
    verified = {"metadata": {t: v["metadataSha256"] for t,v in held.items()}, "stop": str(uuid4())}
    volumes = [held[t] for t in worker.TAGS]
    plan = {"protocol": 1, "project": seed["project"], "stack": seed["stack"], "seed": seed["id"], "sourceStop": verified["stop"],
            "operationId": str(uuid4()), "release": "fixture-next", "manifestSha256": scope.sha("immutable-candidate"),
            "prepared": scope.sha("prepared-release"), "verifyRunId": str(uuid4()), "selectionDigest": scope.sha("selected-source"),
            "ownerDigest": scope.sha("stopped-owner"), "sourceRevision": 1, "receiver": {"nodeId": seed["receiverNode"],
                    "host": seed["receiverIp"], "fingerprint": seed["receiverFingerprint"]}, "proofDigest": scope.sha(held), "volumes": volumes,
            "logicalBytes": sum(v["bytes"] for v in volumes)}
    plan["digest"] = scope.sha(plan)
    def verify():
        if observed() != held:
            raise ValueError("Sealed receiver changed during preparation")
    def prepare(selected=plan, verify_current=verify, previous_receipt=None):
        return worker.prepare_working_pair(selected, mod, vars(adopt), seed, binding, verified, paths,
                                           {"generation": {t:v["receiverGeneration"] for t,v in held.items()}}, verify_current, state, scratch, previous_receipt)
    return plan, prepare, verify


@unittest.skipUnless(sys.platform == "linux", "Linux filesystem semantics")
class RehearsalFiles(unittest.TestCase):
    def test_copies_hardlinks_sparse_data_and_metadata_away_from_the_source(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            original, copy = root / "original", root / "copy"
            original.mkdir()
            copy.mkdir()
            f = original / "one"
            with f.open("wb") as sparse:
                sparse.write(b"one")
                sparse.seek(4096 * 512)
                sparse.write(b"end")
            os.link(f, original / "two")
            f.chmod(0o640)
            os.setxattr(f, "user.rehearsal-test", b"metadata")
            worker.copy_tree(original, copy, root / ".partial")
            self.assertNotEqual(f.stat().st_ino, (copy/"one").stat().st_ino)
            self.assertEqual((copy/"one").stat().st_ino, (copy/"two").stat().st_ino)
            self.assertEqual(f.read_bytes(), (copy/"two").read_bytes())
            self.assertEqual(os.getxattr(copy/"one", "user.rehearsal-test"), b"metadata")
            self.assertEqual(f.stat().st_mtime_ns, (copy/"one").stat().st_mtime_ns)
            self.assertLess((copy/"one").stat().st_blocks * 512, f.stat().st_size)
            old = (copy/"one").stat().st_ino
            worker.copy_tree(original, copy, root / ".partial")
            self.assertEqual((copy/"one").stat().st_ino, old)
            self.assertEqual((copy/"one").stat().st_nlink, 2)
            (original/"external").symlink_to(root)
            with self.assertRaisesRegex(ValueError, "without external links"):
                worker.copy_tree(original, copy, root / ".partial")


@unittest.skipUnless(sys.platform == "linux" and os.geteuid() == 0 and os.environ.get("OMNITRON_TEST_PRIVATE_TMPFS"),
                     "Requires a disposable root-owned tmpfs in a private Linux mount/PID namespace")
class ReceiverOperation(unittest.TestCase):
    def setUp(self):
        base = Path(os.environ["OMNITRON_TEST_PRIVATE_TMPFS"])
        channel.physical(base, True)
        self.assertEqual(subprocess.check_output(["findmnt", "-n", "-T", str(base), "-o", "FSTYPE"]).strip(), b"tmpfs")
        temp = tempfile.TemporaryDirectory(dir=base)
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.paths = {tag: self.root / ("verified-" + tag) for tag in worker.TAGS}
        for tag, path in self.paths.items():
            path.mkdir()
            file = path / "example"
            file.write_bytes(("closed application data " + tag).encode())
            os.chown(file, 70, 71)
            os.setxattr(file, "user.rehearsal-test", b"extended")
            acl = [(1, 6, 0xffffffff), (2, 4, 101), (4, 4, 0xffffffff), (16, 4, 0xffffffff), (32, 0, 0xffffffff)]
            os.setxattr(file, "system.posix_acl_access", struct.pack("<I",2) + b"".join(struct.pack("<HHI",*r) for r in acl))
        self.scratch = self.root / "private-rehearsals"
        self.plan, self.prepare, self.verify = fixture(self.paths, self.scratch)

    def test_resume_then_refuse_to_overwrite_a_used_copy(self):
        def lost():
            raise RuntimeError("interrupted after copying")
        with self.assertRaisesRegex(RuntimeError, "interrupted after copying"):
            self.prepare(verify_current=lost)
        operation = self.scratch / self.plan["operationId"]
        self.assertFalse((operation / "prepared.json").exists())
        first = operation / "volumes/postgres-data/example"
        inode = first.stat().st_ino
        result = self.prepare()
        self.assertEqual(inode, first.stat().st_ino)
        self.assertEqual(result, self.prepare())
        self.assertEqual(result, self.prepare(previous_receipt=result))
        self.assertEqual(result, adopt.record(operation/"prepared.json"))
        self.assertEqual(stat.S_IMODE(self.scratch.stat().st_mode), 0o700)
        self.assertEqual((70,71), (first.stat().st_uid, first.stat().st_gid))
        self.assertEqual(os.getxattr(first, "system.posix_acl_access"),
                         os.getxattr(self.paths["postgres-data"]/"example", "system.posix_acl_access"))
        file = self.paths["minio-data"] / "example"
        with file.open("r+b"), self.assertRaisesRegex(ValueError, "writer"):
            self.prepare()
        first.write_bytes(b"new private write")
        with self.assertRaisesRegex(ValueError, "contents or metadata differ"):
            self.prepare()
        self.assertEqual(first.read_bytes(), b"new private write")
        self.verify()
        self.assertTrue(all(c["inode"] != self.plan["volumes"][i]["receiver"]["inode"] for i,c in enumerate(result["copies"])))
        (operation / "prepared.json").unlink()
        with self.assertRaisesRegex(ValueError, "receipt was removed"):
            self.prepare()

    def test_reject_a_colliding_intent_and_an_alias_before_writing(self):
        incomplete = {**self.plan, "manifestSha256": ""}
        incomplete["digest"] = scope.sha({k:v for k,v in incomplete.items() if k != "digest"})
        with self.assertRaisesRegex(ValueError, "Invalid rehearsal binding"):
            self.prepare(incomplete)
        self.assertFalse(self.scratch.exists())
        with self.assertRaisesRegex(ValueError, "overlaps"):
            fixture(self.paths, self.paths["postgres-data"] / "nested", self.root / "fixture-adoption-state")[1]()
        result = self.prepare()
        changed = {**self.plan, "release": "other"}
        changed["digest"] = scope.sha({k:v for k,v in changed.items() if k != "digest"})
        with self.assertRaisesRegex(ValueError, "original intent changed"):
            self.prepare(changed)
        operation = self.scratch / result["operationId"]
        target = operation / "volumes/minio-data"
        subprocess.run(["mount", "--bind", str(self.paths["postgres-data"]), str(target)], check=True)
        try:
            with self.assertRaisesRegex(ValueError, "foreign mount"):
                self.prepare()
        finally:
            subprocess.run(["umount", str(target)], check=True)
        exposed = self.root / "other-consumer"
        exposed.mkdir()
        subprocess.run(["mount", "--bind", str(target), str(exposed)], check=True)
        try:
            with self.assertRaisesRegex(ValueError, "foreign mount"):
                self.prepare()
        finally:
            subprocess.run(["umount", str(exposed)], check=True)
        operation.rename(operation.with_name("retained-original"))
        with self.assertRaisesRegex(ValueError, "directory was removed"):
            self.prepare()
        self.assertFalse(operation.exists())
        (self.root / "fixture-adoption-state/rehearsals" / (result["operationId"] + ".json")).unlink()
        with self.assertRaisesRegex(ValueError, "controller receipt"):
            self.prepare(previous_receipt=result)
        self.assertFalse(operation.exists())
        self.verify()


if __name__ == "__main__":
    unittest.main()
