import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { loadConfig } from '../../apps/server/dist/config.js'
import { openDatabase } from '../../apps/server/dist/database/connection.js'
import { BackupService } from '../../apps/server/dist/modules/backup/service.js'
import { restoreFromArchive } from '../../apps/server/dist/modules/backup/restore.js'
const config=loadConfig()
config.googleDriveEnabled=true
const db=openDatabase(config.databasePath)
try {
 const backup=new BackupService(db,config)
 const {runId}=backup.trigger('googledrive','manual')
 await backup.waitForRun(runId)
 const row=backup.getRun(runId)
 if(row?.status!=='success'||!row.remote_path||!row.file_name)throw new Error('Server Google Drive backup did not finish successfully')
 const base=path.join(path.join(path.dirname(config.backupDir),'verification'),runId)
 const download=path.join(base,'download')
 fs.mkdirSync(download,{recursive:true,mode:0o700})
 await new Promise((resolve,reject)=>execFile(config.rcloneBin,['copy',row.remote_path,download,'--config',config.googleDriveConfig,'--drive-scope=drive.file','--retries=1','--low-level-retries=1','--timeout=30s','--contimeout=10s','--stats=0','--log-level=ERROR'],{maxBuffer:1024*1024},err=>err?reject(new Error('Cloud backup download failed')):resolve()))
 const restored=await restoreFromArchive({archivePath:path.join(download,row.file_name),metaPath:path.join(download,row.file_name+'.json'),targetDbPath:path.join(base,'restore/database.db'),targetUploadDir:path.join(base,'restore/uploads')})
 if(restored.sha256!==row.sha256)throw new Error('Restored checksum differs from server backup')
 const result={server_backup:'success',cloud_download_restore:'success',run_id:runId,file_name:row.file_name,sha256:restored.sha256,users:restored.users,expenses:restored.expenses,attachments:restored.attachments,next_due:backup.nextDueAt('googledrive')}
 fs.writeFileSync(path.join(base,'summary.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600})
 console.log(JSON.stringify(result))
}finally{db.close()}
