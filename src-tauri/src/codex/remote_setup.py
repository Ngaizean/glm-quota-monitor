import json
import os
import pathlib
import sys
import tempfile

root = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path.home() / ".codex"
root.mkdir(parents=True, exist_ok=True)
data = json.load(sys.stdin)
if set(data) != {"config.toml", "auth.json"}:
    raise ValueError("invalid setup files")
old = {name: (root / name).read_bytes() if (root / name).exists() else None for name in data}
if all(old[name] == content.encode() for name, content in data.items()):
    print("quota-monitor-verified")
    sys.exit(0)
staged, committed = {}, []


def write(path, content):
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


try:
    for name, content in data.items():
        if old[name] is not None:
            write(root / (name + ".bak-quota-monitor"), old[name])
        fd, temporary = tempfile.mkstemp(prefix=".quota-", dir=root)
        os.close(fd)
        staged[name] = pathlib.Path(temporary)
        write(staged[name], content.encode())
    for name, temporary in staged.items():
        os.replace(temporary, root / name)
        committed.append(name)
    for name, content in data.items():
        if (root / name).read_bytes() != content.encode():
            raise RuntimeError("readback mismatch")
except Exception:
    for name in reversed(committed):
        if old[name] is None:
            (root / name).unlink(missing_ok=True)
        else:
            write(root / name, old[name])
    raise
finally:
    for temporary in staged.values():
        temporary.unlink(missing_ok=True)
print("quota-monitor-verified")
