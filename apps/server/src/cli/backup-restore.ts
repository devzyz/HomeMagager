import readline from 'node:readline/promises'
import path from 'node:path'
import { loadConfig } from '../config.js'
import { restoreFromArchive } from '../modules/backup/restore.js'

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const valueFlags = new Set(['--archive', '--meta', '--target', '--uploads'])
  const positional = process.argv.slice(2).filter((a, i, arr) => !a.startsWith('-') && !valueFlags.has(arr[i - 1] ?? ''))
  const archiveArg = flag('--archive') ?? positional[0]
  if (!archiveArg) throw new Error('请指定备份归档文件：backup:restore -- <备份.sqlite.gz> [--uploads <附件目录>]')
  const archivePath = path.resolve(archiveArg)
  const metaFlag = flag('--meta')
  const metaPath = metaFlag ? path.resolve(metaFlag) : `${archivePath}.json`
  const assumeYes = process.argv.includes('--yes')

  if (!archivePath) {
    console.log('用法: pnpm --filter @hm/server run backup:restore -- <备份文件.sqlite.gz> [--meta <元数据.json>] [--target <目标数据库路径>] [--yes]')
    console.log('注意: 恢复前必须停止应用进程；目标默认取 DATABASE_PATH 配置。')
    process.exit(1)
  }

  const config = loadConfig()
  const target = path.resolve(flag('--target') ?? config.databasePath)

  console.log('================ 恢复确认 ================')
  console.log(`备份归档 : ${archivePath}`)
  console.log(`元数据   : ${metaPath}`)
  console.log(`目标数据库: ${target}`)
  console.log('流程: 校验哈希/完整性/外键/版本 → 当前库成组保留为回滚副本 → 替换 → 按需迁移')
  console.log('要求 : 应用必须已停止；恢复后所有 Session 失效，请核对账号状态。')
  console.log('==========================================')

  if (!assumeYes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const answer = (await rl.question('确认执行恢复？(yes/no): ') ?? '').trim().toLowerCase()
    rl.close()
    if (answer !== 'yes' && answer !== 'y') {
      console.log('已取消。')
      process.exit(0)
    }
  }

  const result = await restoreFromArchive({
    archivePath,
    metaPath: metaPath,
    targetDbPath: target,
    targetUploadDir: path.resolve(flag('--uploads') ?? config.uploadDir),
  })

  console.log('√ 恢复完成')
  console.log(`  SHA-256   : ${result.sha256}`)
  console.log(`  数据库版本: ${result.schemaVersions.join(', ') || '(无)'}${result.migrated.length > 0 ? ` → 本次迁移: ${result.migrated.join(', ')}` : ''}`)
  console.log(`  账号数量  : ${result.users}`)
  console.log(`  费用数量  : ${result.expenses}`)
  console.log(`  附件数量  : ${result.attachments}`)
  if (result.rollbackDir) {
    console.log(`  回滚副本  : ${result.rollbackDir}`)
  }
  console.log('请启动应用并核对登录、费用数量与汇总是否正常。')
}

main().catch((err) => {
  console.error('× 恢复失败:', err instanceof Error ? err.message : err)
  process.exit(1)
})
