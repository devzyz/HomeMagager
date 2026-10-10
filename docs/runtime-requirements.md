# 运行配置与容量验收

应用采用单 Node 进程托管 Fastify API 和网页静态文件，SQLite 为本地数据库，无独立 MySQL/Redis 或 GPU 依赖。当前部署工具使用 Ubuntu x86_64、Node.js 24；迁移到其他架构时需要重新准备运行时和 SQLite 原生依赖。

部署前在开发机执行 `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build`。服务器使用已有构建及锁定的生产依赖，Linux 原生依赖必须单独验证，不能复制 Windows node_modules。

容量预算应同时包含操作系统、Node、cloudflared、rclone、SQLite 快照、附件、压缩备份及日志。上传包体积不能代表安装后或运行时占用，进程 RSS 也不能代替整机内存预算。实际服务器容量、进程信息和业务数据数量保留在私密验收报告中。

应用服务限制、rclone 缓冲和迁移步骤见 [服务器部署](./japan-deployment.md)。备份前检查磁盘空间；数据和附件增长、导出、备份/恢复及多用户并发均需留出余量。现有低并发检查不能作为压力容量保证。

## 上线验收

- 验证健康检查、匿名业务接口拒绝、正常账号登录、费用/附件/工资/报表流程。
- 验证生产 HTTPS、Cookie、Origin、可信代理及 Access/JWT 保护。
- 验证完整备份、SHA-256、SQLite 完整性与外键、引用附件的独立恢复。
- Google Drive 需在实际服务器验证授权刷新、上传、下载恢复和周计划；本机成功不能替代服务器端验收。
- 分别验证服务重启、整机重启、长期运行、数据增长和目标并发。记录实测条件与尚未覆盖项。

网络需求包括 Cloudflare Tunnel 出站和 Google OAuth/Drive 接口出站，需分别验证。数据库快照、业务账号、连接信息、令牌、配置及报告只保存在私密目录中，不进入 Git。
