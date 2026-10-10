# 代码与私密数据分离

仓库只保存源码、测试、依赖锁文件、迁移 SQL 和通用部署说明。`.env.example` 只列配置键、空值与示例，不填写真实凭据或实际域名。

## 本机目录

| 位置 | 内容 | 是否上传 GitHub |
| --- | --- | --- |
| `.env` 或进程环境变量 | 实际访问域名、会话密钥、运行配置 | 否 |
| `data/database/` | 业务数据库、账号密码哈希和 Session | 否 |
| `data/uploads/` | 凭证附件 | 否 |
| `data/backups/` | 数据库、附件与校验清单的完整备份 | 否 |
| `private/` | 私密部署笔记、连接信息、一次性维护脚本 | 否 |
| `artifacts/` | OAuth 配置、部署与验收产物、历史仓库备份 | 否 |
| 用户自己的 `.ssh/` | SSH 私钥、连接配置和 known_hosts | 否 |

以上本机数据及凭据模式均由 `.gitignore` 排除。忽略规则只保护未跟踪文件，已经提交过的内容仍需从待发布文件和历史中清除。

运行时优先读取进程环境变量，也可加载仓库根目录 `.env`。已有数据目录保持原位置，不自动移动或初始化，避免误切换到空数据库。需要迁出源码目录时，在停止服务、完成备份及恢复核对后设置：

```dotenv
DATABASE_PATH=/srv/homemanager-private/database/family-expense.db
UPLOAD_DIR=/srv/homemanager-private/uploads
BACKUP_DIR=/srv/homemanager-private/backups
GOOGLE_DRIVE_CONFIG=/srv/homemanager-private/secrets/rclone.conf
```

以上均为示例路径。创建数据库、附件和备份目录后，保证应用用户可读写；私密目录权限 0700、凭据文件 0600。Windows 上使用只允许当前用户访问的 ACL。备份本身包含业务数据和账号哈希，也应按私密数据保存。

## 服务器

部署者在服务器私密 `config/app.env` 中保存运行配置，在 `config/google-drive/rclone.conf` 中保存 Google OAuth 配置，在 `secrets/` 中保存隧道令牌。源码中的部署工具从参数或私密文件读取这些信息；不在代码里写入实际主机、个人邮箱或令牌。

Google 首次授权工具读取部署者提供的 Desktop OAuth JSON，或读取客户端 ID 并通过隐藏输入接收 secret。授权结果保存为私密 rclone 配置；实际客户端 JSON 与令牌不得提交。

## 发布前检查

运行 `pnpm privacy:check` 检查待提交文件中的凭据模式、真实邮箱、非示例 IP、个人路径及私密文件。测试夹具使用虚构账号和密码，第三方依赖元数据中的公开邮箱不视为本项目的私密身份。

发布快照只使用通过检查的文件，并使用 GitHub noreply 邮箱创建提交。不要推送旧仓库的分支、标签、PR 引用、备份 bundle 或带有隐私信息的旧提交历史。

本机启用 `git config core.hooksPath scripts/git-hooks` 后，每次提交都会运行内容检查，并检查作者及提交者使用 GitHub noreply 邮箱。新克隆的仓库需自行启用该配置；它不是 GitHub 服务端的阻断机制。
