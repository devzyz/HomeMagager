"""Prepare private rclone configuration, then let the account owner finish OAuth in a browser."""
import argparse
import configparser
import getpass
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
REMOTE = 'homemanager'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client-id', default=os.environ.get('GOOGLE_DRIVE_CLIENT_ID'), help='Desktop OAuth client ID when entering the secret interactively')
    parser.add_argument('--client-json', help='Downloaded Desktop OAuth client JSON; contents are never printed')
    args = parser.parse_args()
    if args.client_json:
        data = json.loads(Path(args.client_json).read_text(encoding='utf-8-sig'))
        client = data.get('installed', data)
        client_id = client.get('client_id', '')
        if args.client_id and client_id != args.client_id:
            raise ValueError('Desktop OAuth client ID does not match')
        secret = client.get('client_secret', '')
    else:
        client_id = args.client_id or ''
        if not client_id:
            parser.error('Provide --client-json or --client-id')
        secret = getpass.getpass('Paste the newly created client secret (hidden): ')
    if not client_id.endswith('.apps.googleusercontent.com') or any(c.isspace() for c in client_id):
        raise ValueError('Desktop OAuth client ID is invalid')
    if not secret or '\n' in secret or '\r' in secret:
        raise ValueError('Client secret is missing or invalid')
    binary = ROOT / 'artifacts' / 'autodl' / 'rclone' / ('rclone.exe' if os.name == 'nt' else 'rclone')
    if not binary.is_file():
        raise FileNotFoundError('Run scripts/deploy/prepare-rclone.py first')
    private = ROOT / 'artifacts' / 'google-drive' / 'private'
    private.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name == 'nt':
        # Restrict inheritance before writing any token or client secret.
        subprocess.run(['icacls', str(private), '/inheritance:r', '/grant:r', getpass.getuser() + ':(OI)(CI)F'],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        private.chmod(0o700)
    config_path = private / 'rclone.conf'
    config = configparser.ConfigParser(interpolation=None)
    if config_path.exists():
        config.read(config_path, encoding='utf-8')
        if config.has_section(REMOTE) and config.get(REMOTE, 'token', fallback=''):
            raise ValueError('An authorized config already exists; refusing to overwrite it')
    config[REMOTE] = {'type': 'drive', 'client_id': client_id, 'client_secret': secret, 'scope': 'drive.file'}
    with config_path.open('w', encoding='utf-8') as f:
        config.write(f)
    if os.name != 'nt':
        config_path.chmod(0o600)
    print('A browser will open. Complete Google sign-in and approve only HomeManager file backup access.', flush=True)
    # Capture rclone output: it may include tokens/config summaries. Never echo or save raw output.
    process = subprocess.Popen([str(binary), 'config', 'reconnect', REMOTE + ':', '--config', str(config_path), '--auto-confirm'],
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace')
    for line in process.stdout:
        match = re.search(r'http://127\.0\.0\.1:\d+/auth', line)
        if match:
            print('If the browser did not open, visit this local URL: ' + match.group(0), flush=True)
    if process.wait() != 0:
        raise RuntimeError('Google authorization failed; no raw credential output was displayed')
    config.read(config_path, encoding='utf-8')
    token = json.loads(config.get(REMOTE, 'token', fallback='{}'))
    if not token.get('refresh_token'):
        raise ValueError('No refresh token was saved; authorization is not complete')
    print('Google Drive authorization completed. Private configuration: ' + str(config_path), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # JSON errors can include the input; do not print exception messages.
        print('Authorization setup failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
