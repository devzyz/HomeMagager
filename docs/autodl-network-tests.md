# 从本机验证 AutoDL 服务

该验收独立于 `pnpm test`：本机启动 Node HTTP 客户端和 Chromium，所有业务请求经现有 SSH 隧道发往正在运行的 AutoDL 服务。没有启动本机后端、没有调用 Fastify inject、没有数据库写入注入，也没有使用 mock 或在服务器运行测试脚本。

## 运行

前提：AutoDL 服务已运行；本机 SSH 隧道健康；当前本机 Python 有 Pillow，项目依赖和 Playwright Chromium 已安装。

1. 将可用的账号保存到项目 `artifacts/autodl/.env`，包含 `USERNAME`、`PASSWORD`、`BASE_URL`。账号需要已完成首次改密，并能创建测试账号。该目录被 Git 忽略；不会把凭据写入报告。
2. 在 PowerShell 项目根目录执行：

```powershell
./scripts/deploy/autodl-tunnel.ps1 -Action Start -HostName '<SSH_HOST>' -SshPort <SSH_PORT>
pnpm test:remote
```

也可设置 `HM_REMOTE_ENV` 为另一个本地凭据文件的路径。测试入口只接受 localhost / 127.0.0.1，以明确使用本机隧道。

测试有真实写入：先通过 API 创建独立账号、店铺、类别和工资成员，再验证费用、附件和工资日记录。只触碰本次创建的记录，不修改真实账号密码，不删除真实费用。会触发一次正常的本地备份，沿用应用现有的备份保留规则。

## 覆盖

- 全部 42 个 HTTP 路由的成功路径；全部 40 个受保护路由的未登录拒绝访问。
- 登录、首登改密、改密/重置后的 Session 撤销、Cookie、退出、CSRF、Origin/Referer、顺序与并发登录限流。
- 账号创建、重名、输入限制、操作者密码、自己的显示名、账号启停和重置；不触碰真实账号。
- 店铺/类别创建、改名、排序、启停；费用对停用关联的处理。
- 费用增删改查、金额/日期/备注边界、筛选/分页/字面关键字、整数分金额、幂等防重、并发版本冲突。
- 真实 PNG/JPEG/WEBP/PDF 上传；声明与内容不一致的拒绝；5 个附件限制、并发上传、10 MiB 与超限边界；下载字节校验及删除后的 URL 拒绝。
- Dashboard 月度/上月/自然年/未来预付；报表与打印汇总；Excel 真下载后在本机解析页签、金额和公式样式备注。
- 工资成员、每日工时/请假/清除、闰日、工时/时薪约束、按日四舍五入、历史时薪保留、未来预记不计入实际工资。
- 本地备份状态、手动触发并轮询完成、任务列表分页；云盘未接入时的明确拒绝。
- 本机 Chromium：桌面登录、费用创建/编辑/重载/删除、图片上传和下载、报表下载、打印数据与本机 PDF；设置页；手机视口导航/页面布局/日期筛选/工资月历/草稿恢复/录入/退出。没有手机真机验证。

## 结果和清理

可读报告：`artifacts/autodl-real-network-test-report.md`。

私有证据目录：`artifacts/autodl/remote-tests/<run-id>/`，包含 `results.json`、截图、下载的 Excel/PDF、测试账号凭据。HTTP 记录包含方法、路径、状态和耗时，不记录请求体、Cookie、CSRF 或密码。

测试末尾通过 HTTP 删除费用及附件、清除工资日记录，停用测试账号/店铺/类别，并核对费用已清理。没有物理删除 API 的测试记录仍会保留：停用的账号和字典，以及名称带“真实测试”标记的空工资成员。

若测试中断，先保留报告和 run-id，检查记录，不要用数据库回滚或删除用户真实数据替代 API 清理。`resume-autodl-network-tests.mjs <run-id>` 是继续浏览器及限流检查的辅助入口，会重置该 run 的独立测试账号，保留首轮证据。

## 明确未覆盖

- Cloudflare Tunnel/Access、生产 HTTPS 与 Secure Cookie。
- 强制修改服务器时间、7 天自动任务、长时间 Session 到期、进程/容器重启、磁盘和网络故障注入。
- 在真实数据库写入 1000/10000 条数据验证导出上限，或压力测试。
- 备份文件组校验和恢复：当前没有 HTTP 下载/恢复接口，本次只能验证任务成功和公开元数据。
