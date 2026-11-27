"""Exercise the shipped worker's comparisons with closed and reopened SQLite data."""
import copy
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import sqlite3
import tarfile
import tempfile
import unittest

MODULE = Path(__file__).resolve().parents[2] / "data/operations/recovery-qualification.py"
spec = importlib.util.spec_from_file_location("worker", MODULE)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
prior = ["main/migrations/218.ts"]
added = ["main/migrations/219.ts", "main/migrations/220.ts"]


def observed_scenarios(root):
    values = {}
    for scenario, phases in worker.PHASES.items():
        values[scenario] = {}
        for phase, _ in phases:
            # Each phase opens its own connection to this scenario's data.
            with sqlite3.connect(root / scenario) as db:
                def migrate(names):
                    for name in names:
                        db.execute("insert into history values (?,?)",
                                   (name, hashlib.sha256(("compiled SQL: " + name).encode()).hexdigest()))
                if phase == "baseline":
                    db.execute("create table history(name text, checksum text)")
                    db.execute("create table protected(id text primary key, payload text)")
                    migrate(prior)
                    db.execute("insert into protected values ('before','kept')")
                elif phase in ("candidate-write", "candidate-partial"):
                    migrate(added if phase == "candidate-write" else added[:1])
                    db.execute("insert into protected values ('candidate','new')")
                elif phase == "recovery-complete":
                    migrate(added[1:])
                elif phase in ("recovery-write", "recovery-replay"):
                    db.execute("insert or ignore into protected values ('replayed','once')")
                history = [{"name": name, "sha256": h} for name, h in db.execute("select * from history order by rowid")]
                records = {name: worker.digest(worker.encoded([name, text])) for name, text in db.execute("select * from protected")}
                request = {"phase": phase, "challenge": scenario, "recordSets": ["award"]}
                raw = {**request, "history": history, "records": {"award": records},
                       "verification": {"exitCode": 0, "checkedMigrations": len(history),
                                        "historySha256": worker.digest(worker.encoded(history))}}
                del raw["recordSets"]
                values[scenario][phase] = worker.checked_observation(raw, request)
            db.close()
    return values


class Qualification(unittest.TestCase):
    def test_verifies_actual_compiled_members_and_target_in_archive_without_extracting(self):
        runtime = {"arch": "x64", "platform": "linux"}
        code = b"await verifyLedger()"
        closure = worker.encoded({"protocol": 1, "runtime": runtime})
        artifact = {"packageSource": {"migrations": {"220.sql": "f"*64}, "migrationPrograms": [
            {"release": "dist/migrate.js", "releaseSha256": worker.digest(code)}]}, "closureSha256": worker.digest(closure)}
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "app.tgz"
            with tarfile.open(file, "w:gz") as tar:
                for name, content in [("dist/migrate.js", code), (".omnitron-closure.json", closure)]:
                    entry = tarfile.TarInfo("./" + name)
                    entry.size = len(content)
                    tar.addfile(entry, io.BytesIO(content))
            worker.compiled_programs(file, artifact, runtime)
            with self.assertRaisesRegex(ValueError, "runtime"):
                worker.compiled_programs(file, artifact, {"arch": "arm64", "platform": "linux"})
            artifact["packageSource"]["migrationPrograms"][0]["releaseSha256"] = "0"*64
            with self.assertRaisesRegex(ValueError, "Compiled entry differs"):
                worker.compiled_programs(file, artifact, runtime)

    def test_real_changes_survive_restart_and_idempotent_replay(self):
        with tempfile.TemporaryDirectory() as root:
            facts = observed_scenarios(Path(root))
        source_hash = worker.digest(b"export const up = ...")
        self.assertNotEqual(facts["full"]["candidate-write"]["history"][-1]["sha256"], source_hash)
        worker.compare_observations(facts, added, {p: source_hash for p in prior})
        for scenario, phase, mutator in [
            ("full", "recovery-read", lambda row: row["records"]["award"].pop("candidate")),
            ("full", "recovery-write", lambda row: row["records"]["award"].pop("replayed")),
            ("full", "recovery-replay", lambda row: row["records"]["award"].update(extra="f" * 64)),
            ("full", "recovery-restart", lambda row: row["records"]["award"].update(candidate="f" * 64)),
            ("partial", "candidate-partial", lambda row: row["history"][-1].update(sha256=source_hash)),
            ("partial", "recovery-complete", lambda row: row["history"][0].update(sha256=source_hash)),
            ("partial", "recovery-repeat", lambda row: row["history"].pop()),
        ]:
            with self.subTest(scenario=scenario, phase=phase):
                bad = copy.deepcopy(facts)
                mutator(bad[scenario][phase])
                with self.assertRaises(ValueError):
                    worker.compare_observations(bad, added, prior)
        with self.assertRaisesRegex(ValueError, "cover"):
            worker.compare_observations(facts, added, prior + ["main/migrations/other.ts"])

    def test_worker_refuses_unauthenticated_qa_inputs(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            cas = root / ".omnitron/recovery-inputs"
            cas.mkdir(parents=True)
            scratch = root / "lab"
            scratch.mkdir()
            original = os.environ.get("HOME")
            os.environ["HOME"] = str(root)
            try:
                a = b"app archive"
                sha = worker.digest(a)
                (cas / sha).write_bytes(a)
                inputs = worker.Inputs(scratch)
                try:
                    file = inputs.copy(sha, 100)
                    self.assertEqual(file.read_bytes(), a)
                    self.assertEqual(file.stat().st_mode & 0o777, 0o444)
                    wrong = worker.digest(b"other")
                    (cas / wrong).symlink_to(cas / sha)
                    with self.assertRaises(OSError):
                        inputs.copy(wrong, 100)
                    (cas / wrong).unlink()
                    (cas / wrong).write_bytes(b"unrelated")
                    with self.assertRaisesRegex(ValueError, "admitted"):
                        inputs.copy(wrong, 100)
                finally:
                    os.close(inputs.fd)
            finally:
                if original is None:
                    os.environ.pop("HOME", None)
                else:
                    os.environ["HOME"] = original

    def test_pinned_architecture_executable_and_abi(self):
        target = {"platform": "linux", "arch": "x64", "node": "v24.10.0", "abi": "137",
                  "libc": "2.39", "executableSha256": "d" * 64}
        worker.verify_runtime({"Architecture": "amd64"}, target, copy.deepcopy(target))
        for key, value in [("arch", "arm64"), ("abi", "127"), ("executableSha256", "a" * 64), ("libc", "2.31")]:
            with self.assertRaises(ValueError):
                worker.verify_runtime({"Architecture": "amd64"}, target, {**target, key: value})

    def test_real_migration_verifier_must_confirm_current_ledger(self):
        observation = {"phase": "baseline", "challenge": "123", "history": [{"name": prior[0], "sha256": "c"*64}],
                       "records": {"award": {}}, "verification": {"exitCode": 0, "checkedMigrations": 1, "historySha256": "0"*64}}
        request = {"phase": "baseline", "challenge": "123", "recordSets": ["award"]}
        with self.assertRaisesRegex(ValueError, "verification"):
            worker.checked_observation(observation, request)
        observation["verification"]["historySha256"] = worker.digest(worker.encoded(observation["history"]))
        observation["verification"]["exitCode"] = 2
        with self.assertRaisesRegex(ValueError, "verification"):
            worker.checked_observation(observation, request)


if __name__ == "__main__":
    unittest.main()
