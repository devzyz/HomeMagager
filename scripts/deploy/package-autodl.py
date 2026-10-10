"""Package the current local build without databases, credentials or node_modules."""
from pathlib import Path
import hashlib
import json
import tarfile

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / 'artifacts' / 'autodl'
STATE.mkdir(parents=True, exist_ok=True)
archive = STATE / 'homemanager.tar.gz'
files = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'apps/server/package.json', 'apps/web/package.json', 'scripts/start-production.mjs', 'scripts/deploy/bootstrap-autodl.mjs']
for folder in ['apps/server/dist', 'apps/web/dist', 'migrations']:
    files.extend(p.relative_to(ROOT).as_posix() for p in (ROOT / folder).rglob('*') if p.is_file())
manifest = {}
with tarfile.open(archive, 'w:gz') as tar:
    for rel in sorted(set(files)):
        path = ROOT / rel
        if not path.is_file():
            raise FileNotFoundError(rel)
        manifest[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
        tar.add(path, arcname=rel, recursive=False)
(STATE / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
sha = hashlib.sha256(archive.read_bytes()).hexdigest()
(STATE / 'homemanager.tar.gz.sha256').write_bytes((sha + '  homemanager.tar.gz\n').encode('ascii'))
print(f'Packaged {len(manifest)} files, {archive.stat().st_size} bytes, sha256={sha}')