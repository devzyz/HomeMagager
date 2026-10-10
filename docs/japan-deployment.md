# 独立 Linux 服务器部署与迁移

本文件提供可复用步骤。服务器 IP、SSH 身份、实际域名、备份文件与摘要、账号数量和验收结果保留在被 Git 忽略的私密部署记录中。

## 连接与目录

使用 Ubuntu x86_64 专用普通用户；私钥保存在本机私密目录，服务端主机密钥须预先核对并加入 known_hosts。连接工具拒绝未知主机密钥。

```powershell
python scripts/deploy/japan.py --host <SSH_HOST> --user <SSH_USER> --identity <PRIVATE_KEY_PATH> run --script <SCRIPT_PATH>
```

远端脚本默认使用 `$HOME/homemanager`，可通过 `HOMEMANAGER_DEPLOY_BASE` 覆盖。准备 runtime、config、secrets、data、logs、staging 目录，私密目录 0700、凭据文件 0600。staging 应包含校验清单、Linux 应用和运行时归档、最终备份与逐表计数。现有环境必须先备份；`install-japan.sh` 拒绝覆盖已有服务单元。

`install-japan.sh` 安装应用和隧道两个 systemd 单元，运行身份来自执行安装脚本的用户；不安装系统级 Node。应用仅监听回环地址，生产环境配置 HTTPS BASE_URL、随机 SESSION_SECRET、TRUST_PROXY=loopback。私密 config/app.env 和隧道令牌不进入版本库。

## 迁移步骤

1. 预先构建并验证 Linux 原生 SQLite 依赖，校验应用和运行时归档的 SHA-256。
2. 在独立目录恢复初始备份，核对完整性、外键、业务表计数和引用附件。
3. 停止旧应用及其连接器，生成最终一致性备份并传入新服务器 staging。保持业务写入关闭。
4. 执行 `restore-japan.sh`，再执行 `verify-japan-local.sh`（设置 `HOMEMANAGER_BASE_URL` 为实际 HTTPS origin）。
5. 执行 `cutover-japan.sh`，按 staging/final-counts.json 核对每个业务表后开启应用与连接器。确认不会存在两个可写的独立源站。
6. 验证匿名业务接口返回 401、登录和附件正常、Access/JWT 保护有效、HTTPS 与生产 Cookie 正常。

备份排除登录 Session，恢复后需要重新登录。切换后产生新数据时，回滚必须先迁回最新一致性数据，不能直接启用旧数据库。

## Google Drive 与资源限制

首次 OAuth 授权见 [Google Drive 备份](./google-drive-backup.md)。只有服务器完整上传、云端下载及独立恢复核对成功后才启用自动云备份；每周日北京时间 03:00，保留最近 5 组成功完整备份，本地保留独立计算。

安装脚本提供低内存 rclone 包装器：单传输、2 个检查器、1MiB 缓冲、总缓冲限制 16MiB、Drive chunk 8MiB。应用老生代上限 192MiB、MemoryHigh=240MiB、MemoryMax=320MiB；连接器 MemoryMax=96MiB。按部署实际资源调整并验证，这些限制不等于整机容量保证。

`verify-japan-drive.mjs` 执行云端完整备份、下载与独立恢复；`report-japan.sh` 生成私密资源及数据库验收报告。不要将这些输出或真实业务数据提交 Git。服务器整机重启、长期周计划、授权刷新、非空附件与并发压力需要分别验收。

## 管理

```bash
sudo systemctl status homemanager.service homemanager-tunnel.service
sudo systemctl restart homemanager.service homemanager-tunnel.service
sudo journalctl -u homemanager.service -n 100 --no-pager
```

新建成员使用 `provision-requested-member.mjs <PRIVATE_JSON_PATH>`，JSON 包含 username、password、display_name，仅从私密文件读取；脚本验证登录后删除输入文件。一次性、包含具体测试身份的数据清理脚本仅保留本机。
