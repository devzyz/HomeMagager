# Google Drive 完整备份

Google Drive 适配器、首次授权工具、固定周计划与云端保留策略已实现。实际 Google 项目、客户端 ID、secret、令牌及部署状态由部署者保存在私密配置中。

## 备份规则

备份组位于 `homemanager:homeManager/<备份文件名>/`，包含一致性 SQLite gzip 快照、引用的凭证附件及 SHA-256 清单。数据库副本排除登录 Session，组内不包含环境配置、SSH 私钥或 OAuth 令牌。

先上传数据库和附件，下载校验后上传 JSON 清单作为完成标记，再校验完整组。仅验证成功后记录成功；失败不计为完整备份。新组成功后按数据库记录清理超出数量的本应用完整组，不清理整个云盘或任意目录。

云端计划为每周日 **03:00 Asia/Shanghai**，默认最近 **5 组**成功完整备份；本地保留数量及到期时间独立计算。错过当前周的成功任务会补跑，失败冷却一小时。旧组清理失败保留新成功记录，并在后续成功备份后重试。

## 首次授权

在自己的 Google Cloud 项目启用 Drive API 并准备 Desktop OAuth 客户端，使用 `drive.file` 权限。将客户端 JSON 下载到受限私密目录；不要放到源码或版本库中。

```powershell
python scripts/deploy/prepare-rclone.py
python scripts/deploy/google-drive-auth.py --client-json '<PRIVATE_CLIENT_JSON>'
```

也可传入 `--client-id` 或私密环境变量 GOOGLE_DRIVE_CLIENT_ID，并通过隐藏输入提供 client secret。用户在 Google 官方页面完成登录和授权，工具不回显原始 rclone 凭据输出。结果位于被 Git 忽略的 `artifacts/google-drive/private/rclone.conf`。

Windows 工具限制配置目录 ACL，Linux 私密目录 0700、文件 0600。通过 SSH 将授权配置传至服务器受限目录，应用配置只引用文件路径：

```dotenv
GOOGLE_DRIVE_ENABLED=false
GOOGLE_DRIVE_CONFIG=/srv/homemanager-private/secrets/rclone.conf
GOOGLE_DRIVE_REMOTE=homemanager
GOOGLE_DRIVE_KEEP=5
RCLONE_BIN=rclone
```

GOOGLE_DRIVE_CONFIG 路径为示例；真实值只写入服务器私密环境文件。首次授权、客户端 JSON 与令牌不通过业务页面公开。

## 服务器验收和启用

先验证实际服务器可连接 Google OAuth 与 Drive 接口，完成一组完整上传、云端下载及空目录独立恢复，核对 SHA-256、SQLite 完整性、外键和引用附件。验证成功后才设 GOOGLE_DRIVE_ENABLED=true 并重启服务。仅保存令牌或列出远端文件不算恢复验收。

部署及低内存运行参数见 [独立服务器部署](./japan-deployment.md)。授权刷新、真实非空附件、长期周计划与目标数据规模应分别验收。真实验收结果只保存到 artifacts 或服务器私密目录。

## 独立恢复

先将整组下载到私密临时目录，保留 gzip、同名 JSON 清单与 attachments 目录。以下 CLI 目标必须是独立空目录：

```bash
GROUP=family-expense-YYYYMMDD-HHMMSS-xxxxxxxx.sqlite.gz
pnpm --filter @hm/server run backup:restore -- --archive "/tmp/hm-restore/download/$GROUP" --meta "/tmp/hm-restore/download/$GROUP.json" --target /tmp/hm-restore/database.db --uploads /tmp/hm-restore/uploads --yes
```

恢复 CLI 验证 SHA-256、完整性、迁移版本与附件，不自动替换运行中的数据库。切换恢复数据前应停止应用、保存当前数据库及附件的回滚副本，恢复后重新登录并核对业务内容。
