import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { openDatabase } from '../../apps/server/dist/database/connection.js'
import { loadConfig } from '../../apps/server/dist/config.js'
import { GoogleDriveBackup, ARCHIVE_NAME } from '../../apps/server/dist/modules/backup/google-drive.js'
import { restoreFromArchive } from '../../apps/server/dist/modules/backup/restore.js'

const root = process.cwd()
const source = path.resolve(process.argv[2] ?? 'artifacts/google-drive/verification/source')
const files = fs.readdirSync(source).filter(name => ARCHIVE_NAME.test(name))
if (files.length !== 1) throw new Error('Use a directory containing exactly one newly created complete backup group')
const fileName = files[0]
const manifest = JSON.parse(fs.readFileSync(path.join(source, fileName + '.json'), 'utf8'))
if (manifest.format_version !== 2 || manifest.file_name !== fileName || !manifest.attachments_included || !Array.isArray(manifest.attachments)) throw new Error('Incomplete backup manifest')
const config = loadConfig()
config.googleDriveEnabled = true
config.googleDriveConfig = path.join(root, 'artifacts/google-drive/private/rclone.conf')
config.googleDriveRemote = 'homemanager'
config.rcloneBin = path.join(root, 'artifacts/autodl/rclone', process.platform === 'win32' ? 'rclone.exe' : 'rclone')
const adapter = new GoogleDriveBackup(config)
if (!adapter.configured()) throw new Error('Complete the local OAuth helper first')
const signal = AbortSignal.timeout(180_000)
const run = args => new Promise((resolve, reject) => {
  execFile(config.rcloneBin, [...args, '--config', config.googleDriveConfig, '--drive-scope=drive.file', '--retries=1', '--low-level-retries=1', '--timeout=30s', '--contimeout=10s', '--stats=0', '--log-level=ERROR'], {signal, windowsHide:true, maxBuffer:1024*1024}, error => error ? reject(new Error('Google Drive verification transfer failed')) : resolve())
})
const directory = path.join(root, 'artifacts/google-drive/verification', 'run-' + randomUUID())
const downloaded = path.join(directory, 'download')
const restoredDb = path.join(directory, 'restore/database.db')
fs.mkdirSync(downloaded, {recursive:true})
let attempted = false
try {
  attempted = true
  const remote = await adapter.publish(source, fileName, signal)
  console.log('Verified complete backup upload: OK')
  await run(['copy', remote, downloaded, '--immutable'])
  const restored = await restoreFromArchive({archivePath:path.join(downloaded,fileName), metaPath:path.join(downloaded,fileName+'.json'), targetDbPath:restoredDb, targetUploadDir:path.join(directory,'restore/uploads')})
  const db = openDatabase(restoredDb)
  let counts
  try {
    counts = Object.fromEntries(['users','expenses','expense_attachments','payroll_members'].map(table => [table,db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n]))
    if (db.pragma('integrity_check',{simple:true}) !== 'ok' || db.pragma('foreign_key_check').length) throw new Error('Restored database check failed')
    if (db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n !== 0) throw new Error('Backup retained login sessions')
  } finally { db.close() }
  const summary = {verified_at:new Date().toISOString(),server_automatic_backup:false,upload_verified:true,cloud_download_restored:true,sha256:restored.sha256,counts,attachments:restored.attachments,cloud_test_group_removed:false}
  await adapter.remove(remote,fileName,AbortSignal.timeout(30_000))
  attempted = false
  summary.cloud_test_group_removed = true
  fs.writeFileSync(path.join(directory,'summary.json'),JSON.stringify(summary,null,2)+'\n')
  console.log(JSON.stringify(summary))
  console.log('Verification report: '+path.join(directory,'summary.json'))
} finally {
  if (attempted) {
    try { await adapter.remove(adapter.remotePath(fileName),fileName,AbortSignal.timeout(30_000)) }
    catch { console.error('Could not remove this verification group; inspect its exact backup name in Drive') }
  }
}
