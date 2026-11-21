import hashlib
import importlib.util
import io
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import MagicMock, patch


path = Path(__file__).resolve().parents[2] / "data/operations/stage-binaries.py"
spec = importlib.util.spec_from_file_location("release_operation", path)
operation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operation)


def archive(entries):
    result = io.BytesIO()
    with tarfile.open(fileobj=result, mode="w:gz") as bundle:
        for name, value in entries:
            entry = tarfile.TarInfo(name)
            if value is None:
                entry.type = tarfile.SYMTYPE
                entry.linkname = "../outside"
                bundle.addfile(entry)
            else:
                entry.size = len(value)
                bundle.addfile(entry, io.BytesIO(value))
    return result.getvalue()


class BinaryReleaseTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "opt" / "binaries"
        self.data = archive([("pkg/bin/server", b"first"), ("../other", b"ignore")])

    def declaration(self, digest):
        return {"name": "example", "version": "2.1", "executables": ["server"], "archives": {
            operation.platform.machine(): {"url": "https://example.test/archive", "sha256": digest, "directory": "pkg/bin"},
        }}

    def install(self, data, digest=None):
        declared = self.declaration(digest or hashlib.sha256(data).hexdigest())
        opener = MagicMock()
        opener.open.return_value = io.BytesIO(data)
        with patch.object(operation, "build_opener", return_value=opener):
            receipt = operation.stage_or_check("stage", declared, self.root, os.geteuid())
        return declared, receipt, opener

    def test_install_retry_and_tampering(self):
        declared, receipt, opener = self.install(self.data)
        opener.open.assert_called_once()
        published = self.root / "example/2.1"
        self.assertEqual(set(p.name for p in published.iterdir()), {"release.json", "server"})
        self.assertEqual((published / "server").read_bytes(), b"first")
        self.assertEqual(operation.stage_or_check("check", declared, self.root, os.geteuid()), receipt)
        _, again, opener = self.install(self.data)
        self.assertEqual(again, receipt)
        opener.open.assert_not_called()
        (published / "server").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "differs"):
            self.install(self.data)

    def test_invalid_archive_never_publishes(self):
        cases = [(self.data, "0" * 64), (archive([("pkg/bin/server", None)]), None),
                 (archive([("pkg/bin/server", b"a"), ("pkg/bin/server", b"b")]), None),
                 (archive([("pkg/bin/another", b"a")]), None)]
        for data, digest in cases:
            with self.subTest(digest=digest), self.assertRaises(ValueError):
                self.install(data, digest)
            self.assertEqual(list((self.root / "example").iterdir()), [])

    def test_refuses_ambiguous_paths_and_architecture(self):
        declaration = self.declaration("a" * 64)
        for name in ("..", "/root", "x/y"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                operation.read_spec({**declaration, "name": name}, operation.platform.machine())
        with self.assertRaisesRegex(ValueError, "architecture"):
            operation.read_spec(declaration, "unsupported")
        for url in ("http://example.test/a", "https://user:password@example.test/a"):
            with self.assertRaises(ValueError):
                operation.https_url(url)


if __name__ == "__main__":
    unittest.main()
