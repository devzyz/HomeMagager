"""AutoDL SSH operations; reads credentials from a local dotenv file."""
import argparse
import base64
import hashlib
import pathlib
import select
import shlex
import socketserver
import sys
import time
import paramiko

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

ROOT = pathlib.Path(__file__).resolve().parents[2]
STATE = ROOT / 'artifacts' / 'autodl'

class RememberHost(paramiko.MissingHostKeyPolicy):
    def missing_host_key(self, client, hostname, key):
        fp = base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip('=')
        print(f'SSH host key {hostname}: SHA256:{fp}', flush=True)
        client.get_host_keys().add(hostname, key.get_name(), key)
        client.save_host_keys(str(STATE / 'known_hosts'))

def password_from_file(path):
    for line in pathlib.Path(path).read_text(encoding='utf-8-sig').splitlines():
        key, sep, value = line.partition('=')
        if sep and key.strip().lower() == 'password':
            value = value.strip()
            if len(value) > 1 and value[0] == value[-1] and value[0] in '\"\'':
                value = value[1:-1]
            if value:
                return value
    raise ValueError('Missing password entry')

def run(client, command, password):
    channel = client.get_transport().open_session()
    channel.set_combine_stderr(True)
    channel.exec_command('bash -lc ' + shlex.quote(command))
    pending = b''
    while True:
        if channel.recv_ready():
            pending += channel.recv(65536)
            lines = pending.split(b'\n')
            pending = lines.pop()
            for line in lines:
                print(line.decode('utf-8', errors='replace').replace(password, '[REDACTED]'), flush=True)
        elif channel.exit_status_ready():
            break
        else:
            time.sleep(.05)
    if pending:
        print(pending.decode('utf-8', errors='replace').replace(password, '[REDACTED]'), flush=True)
    return channel.recv_exit_status()

def forward(client, local_port, remote_port):
    transport = client.get_transport()
    class Handler(socketserver.BaseRequestHandler):
        def handle(self):
            try:
                channel = transport.open_channel('direct-tcpip', ('127.0.0.1', remote_port), self.request.getpeername())
                if channel is None:
                    return
                with channel:
                    while transport.is_active():
                        readable, _, _ = select.select([self.request, channel], [], [], 10)
                        if self.request in readable:
                            data = self.request.recv(65536)
                            if not data:
                                break
                            channel.sendall(data)
                        if channel in readable:
                            data = channel.recv(65536)
                            if not data:
                                break
                            self.request.sendall(data)
            except (OSError, EOFError, paramiko.SSHException):
                pass
    class Server(socketserver.ThreadingTCPServer):
        allow_reuse_address = True
        daemon_threads = True
    with Server(('127.0.0.1', local_port), Handler) as server:
        server.timeout = 1
        print(f'Tunnel ready: http://127.0.0.1:{local_port} -> AutoDL 127.0.0.1:{remote_port}', flush=True)
        while transport.is_active():
            server.handle_request()
    raise ConnectionError('SSH transport disconnected')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', required=True)
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--user', default='root')
    parser.add_argument('--password-file', default=str(pathlib.Path.home() / '.ssh' / 'autodl-psw.env'))
    sub = parser.add_subparsers(dest='action', required=True)
    command = sub.add_parser('run')
    command.add_argument('--command')
    command.add_argument('--script')
    upload = sub.add_parser('upload')
    upload.add_argument('local')
    upload.add_argument('remote')
    download = sub.add_parser('download')
    download.add_argument('remote')
    download.add_argument('local')
    tunnel = sub.add_parser('tunnel')
    tunnel.add_argument('--local-port', type=int, default=13000)
    tunnel.add_argument('--remote-port', type=int, default=3000)
    args = parser.parse_args()
    STATE.mkdir(parents=True, exist_ok=True)
    client = paramiko.SSHClient()
    for path in [pathlib.Path.home() / '.ssh' / 'known_hosts', STATE / 'known_hosts']:
        if path.exists():
            client.load_host_keys(str(path))
    client.set_missing_host_key_policy(RememberHost())
    password = password_from_file(args.password_file)
    client.connect(args.host, port=args.port, username=args.user, password=password,
                   look_for_keys=False, allow_agent=False, timeout=25, banner_timeout=25, auth_timeout=25)
    client.get_transport().set_keepalive(30)
    try:
        if args.action == 'run':
            script = pathlib.Path(args.script).read_text(encoding='utf-8') if args.script else args.command
            if not script:
                parser.error('run requires --command or --script')
            return run(client, script, password)
        if args.action == 'upload':
            with client.open_sftp() as sftp:
                sftp.put(args.local, args.remote)
            print('Uploaded ' + pathlib.Path(args.local).name)
            return 0
        if args.action == 'download':
            with client.open_sftp() as sftp:
                sftp.get(args.remote, args.local)
            print('Downloaded credential/configuration file without displaying contents')
            return 0
        if args.action == 'tunnel':
            forward(client, args.local_port, args.remote_port)
    finally:
        client.close()

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print('SSH operation failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)