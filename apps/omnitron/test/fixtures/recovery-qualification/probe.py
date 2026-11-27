import json, subprocess, sys, tarfile
request = json.load(sys.stdin)
with tarfile.open("/input/artifacts/ledger.tgz") as archive:
    code = archive.extractfile("app.cjs").read()
with open("/tmp/app.cjs", "wb") as file:
    file.write(code)
subprocess.run(["/usr/bin/node", "--no-warnings", "/tmp/app.cjs"], input=json.dumps(request).encode(), check=True)
