# AutoDL 部署

本文是通用部署流程，真实 SSH 地址、端口、账号、密钥和验收结果保存在本机私密目录。生产路径以下使用 `/root/autodl-tmp/homemanager` 作为部署工具的约定，实际数据与凭据不得打包进应用。

## 准备与上传

本机执行 `pnpm build`，再运行 `python scripts/deploy/package-autodl.py`。打包工具只收集构建、迁移、依赖声明、锁文件与生产启动脚本；不收集数据库、附件、环境文件、OAuth 配置或 node_modules。产物保存到被 Git 忽略的 `artifacts/autodl/`。

```powershell
python scripts/deploy/autodl.py --host <SSH_HOST> --port <SSH_PORT> --user <SSH_USER> --password-file <PRIVATE_PASSWORD_FILE> run --script scripts/deploy/prepare-autodl.sh
python scripts/deploy/autodl.py --host <SSH_HOST> --port <SSH_PORT> --user <SSH_USER> --password-file <PRIVATE_PASSWORD_FILE> upload artifacts/autodl/homemanager.tar.gz /root/autodl-tmp/homemanager/homemanager.tar.gz
python scripts/deploy/autodl.py --host <SSH_HOST> --port <SSH_PORT> --user <SSH_USER> --password-file <PRIVATE_PASSWORD_FILE> upload artifacts/autodl/homemanager.tar.gz.sha256 /root/autodl-tmp/homemanager/homemanager.tar.gz.sha256
```

密码文件包含 `password=...`，使用当前用户的受限文件权限保存。首次 SSH 主机指纹必须由部署者核对；本机工具记录主机密钥，后续变化会拒绝连接。

已有数据库升级前先运行完整独立备份并验证恢复，再执行 `install-autodl.sh`。安装工具校验归档、安装 Linux 原生依赖，并保留已有配置与数据。不能用覆盖线上数据库作为升级方式。

## 运行配置

| 服务器位置 | 内容 |
| --- | --- |
| config/app.env | 实际运行配置、会话密钥 |
| config/google-drive/rclone.conf | Google OAuth 私密配置 |
| secrets/ | 首次初始化凭据及隧道令牌 |
| data/database、data/uploads、data/backups | 业务数据、附件与完整备份 |
| releases、runtime | 已构建的应用与运行时 |
| logs | 轮转日志 |

私密目录 0700、凭据文件 0600。生产服务只监听回环地址；将 production、HTTPS BASE_URL、随机 SESSION_SECRET 和 TRUST_PROXY=loopback 写入私密 app.env。公网访问保护见 [Cloudflare 接入指南](./cloudflare-aliyun-setup.md)。

## 本机测试隧道

```powershell
./scripts/deploy/autodl-tunnel.ps1 -Action Start -HostName '<SSH_HOST>' -SshPort <SSH_PORT> -PasswordFile '<PRIVATE_PASSWORD_FILE>'
./scripts/deploy/autodl-tunnel.ps1 -Action Stop
```

隧道只监听本机回环地址；状态与日志在 artifacts/autodl，不上传 GitHub。真实测试入口见 [网络测试](./autodl-network-tests.md)。

## 备份与验收

Google Drive 的首次授权及云端独立恢复见 [Google Drive 备份](./google-drive-backup.md)。只有实际服务器能完成上传、下载校验与恢复后才启用自动云备份；本机成功不能证明服务器网络或后台任务成功。

部署者需分别核对健康检查、账号登录、生产 Cookie、Origin、Access/JWT、费用与附件、服务重启、平台重启与长期备份。实际文件名、校验摘要、账号数量、主机信息与资源报告只留在私密记录中。
