"""HomeManager-only SSH deployment operations for the Japan host; credentials are never printed."""
import argparse
from pathlib import Path
import sys,time
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")
def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--host',required=True)
 p.add_argument('--port',type=int,default=22)
 p.add_argument('--user',required=True)
 p.add_argument('--identity',default=str(Path.home()/'.ssh/id_rsa'))
 sub=p.add_subparsers(dest='action',required=True)
 r=sub.add_parser('run'); r.add_argument('--script',required=True)
 u=sub.add_parser('upload'); u.add_argument('local'); u.add_argument('remote')
 d=sub.add_parser('download'); d.add_argument('remote'); d.add_argument('local')
 a=p.parse_args()
 c=paramiko.SSHClient()
 known=Path.home()/'.ssh/known_hosts'
 if known.exists(): c.load_host_keys(str(known))
 c.set_missing_host_key_policy(paramiko.RejectPolicy())
 c.connect(a.host,port=a.port,username=a.user,key_filename=a.identity,allow_agent=False,look_for_keys=False,timeout=20,banner_timeout=20,auth_timeout=20)
 c.get_transport().set_keepalive(30)
 try:
  if a.action=='run':
   channel=c.get_transport().open_session()
   channel.set_combine_stderr(True)
   channel.exec_command('bash -se')
   channel.sendall(Path(a.script).read_text(encoding='utf-8-sig').encode())
   channel.shutdown_write()
   pending=b''
   while True:
    if channel.recv_ready():
     pending+=channel.recv(65536)
     lines=pending.split(b'\n'); pending=lines.pop()
     for line in lines: print(line.decode('utf-8',errors='replace'),flush=True)
    elif channel.exit_status_ready(): break
    else: time.sleep(.05)
   if pending: print(pending.decode('utf-8',errors='replace'),flush=True)
   return channel.recv_exit_status()
  with c.open_sftp() as sftp:
   if a.action=='upload':
    sftp.put(a.local,a.remote)
    sftp.chmod(a.remote,0o600)
   else: sftp.get(a.remote,a.local)
  print(a.action.capitalize()+' completed: '+Path(a.local).name,flush=True)
  return 0
 finally: c.close()
if __name__=='__main__':
 try: sys.exit(main())
 except Exception as e:
  print('Japan SSH operation failed: '+type(e).__name__,file=sys.stderr)
  sys.exit(1)
