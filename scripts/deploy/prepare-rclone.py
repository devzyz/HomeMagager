"""Download official pinned rclone binaries and verify published SHA256 checksums."""
import hashlib
import io
from pathlib import Path
import urllib.request
import zipfile

VERSION = 'v1.75.2'
BASE = f'https://github.com/rclone/rclone/releases/download/{VERSION}/'
STATE = Path(__file__).resolve().parents[2] / 'artifacts' / 'autodl' / 'rclone'
STATE.mkdir(parents=True, exist_ok=True)
checksums = urllib.request.urlopen(BASE + 'SHA256SUMS', timeout=30).read().decode()
for platform, binary in [('linux-amd64', 'rclone'), ('windows-amd64', 'rclone.exe')]:
    archive_name = f'rclone-{VERSION}-{platform}.zip'
    expected = next(line.split()[0] for line in checksums.splitlines() if line.strip().endswith(archive_name))
    data = urllib.request.urlopen(BASE + archive_name, timeout=45).read()
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError('rclone download checksum mismatch')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        output = STATE / binary
        output.write_bytes(archive.read(f'rclone-{VERSION}-{platform}/{binary}'))
    (STATE / (binary + '.sha256')).write_bytes((hashlib.sha256(output.read_bytes()).hexdigest() + '  ' + binary + '\n').encode('ascii'))
    print(f'Verified {archive_name}; extracted {binary}', flush=True)
