# 家庭店铺费用管理系统

为家庭店铺提供统一的费用管理网站：多账号、店铺/类别管理、费用录入、凭证附件、Dashboard、报表、Excel 导出、浏览器打印/PDF，以及本地和 Google Drive 完整备份（数据库、附件、校验清单）。

> 完整业务规则见《家庭店铺费用管理系统 — Agent 实现规格（最终版）》；本期范围与实施计划见 [PLAN.md](./PLAN.md)。
> Google Drive 备份及公开应用介绍/隐私页面已实现。实际部署配置、账号与业务数据保存在私密目录，参见 [代码与私密数据分离](./docs/private-data-layout.md)。

## 技术栈

- 后端：Node.js 24 LTS + Fastify 5 + TypeScript + better-sqlite3（SQL migrations）
- 前端：Vue 3 + Vite + TypeScript + Element Plus + pinia + ECharts（按需加载）
- 安全：Argon2id 密码、SQLite 持久化 Session（服务端仅存摘要）、CSRF Token、Origin 校验、登录限流
- 测试：vitest（单元/集成）+ Playwright（浏览器 e2e，桌面 + 移动视口）

## 快速开始（开发）

```bash
# 首先将 .env.example 复制为 .env 并填写自己的私密运行配置。
pnpm install                # 首次需允许 better-sqlite3 构建脚本：pnpm rebuild better-sqlite3 esbuild
pnpm user:init              # 交互式创建首个家庭账号（仅用户表为空时可用）
pnpm dev                    # 后端 http://localhost:3000 + 前端 http://localhost:5173
```

打开浏览器访问 `http://localhost:5173` 登录使用。数据存放在仓库根目录 `data/`（已 gitignore）。

非交互式初始化（用于受控脚本；密码不得写入版本库或公开终端记录）：

```bash
pnpm --filter @hm/server run user:init -- --username <用户名> --display-name <显示名> --password <密码>
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 并行启动前后端开发服务 |
| `pnpm build` | 构建前端与后端产物 |
| `pnpm start` | 运行构建产物，模式取 `.env` / 系统环境变量（默认 development） |
| `pnpm start:prod` | 强制生产模式，必须配置 HTTPS BASE_URL 和 SESSION_SECRET |
| `pnpm test` | 运行 vitest 单元/集成测试 |
| `pnpm typecheck` / `pnpm lint` | 类型检查 / 代码检查 |
| `pnpm exec playwright test` | 运行浏览器 e2e（自动构建、独立临时数据目录） |

## 工资

域名保护见 [Cloudflare 接入指南](./docs/cloudflare-aliyun-setup.md)，Google 云备份见 [Google Drive 备份](./docs/google-drive-backup.md)。

- 底部「工资」位于费用和报表之间，支持新增成员、编辑姓名和默认时薪；工资成员独立于登录账号。
- 点击成员进入当前月份的工资月历，可切换月份。点击日期录入上班时长（最多 24 小时，支持两位小数）或请假，也可清除误填记录。
- 上班为绿色，显示当天工资；请假为红色且工资为 0；未来日期为白色，可预填；过去未填写的日期为灰色「未记录」。
- 工资按当天时薪 × 工时逐日四舍五入到分，月度汇总只计算截至今天（Asia/Shanghai）的记录。修改默认时薪不改变已有记录；当天时薪可单独编辑。
- 工资数据存入 SQLite，随完整数据库备份保存；工资汇总独立展示，不自动生成费用单或计入费用报表。

## 数据与备份

- 首页年度合计按所选月份所在自然年的 1—12 月统计，包含已经录入的后续月份账单；月度合计与最近 12 个月趋势仍按所选月份展示。

- 数据目录：`data/database/`（SQLite 主库，WAL 模式）、`data/uploads/`（凭证附件）、`data/backups/`（备份）
- 自动备份：每小时检查，距最近成功满 7 天执行；手动：设置 → 备份。每组包括 `.sqlite.gz`、`.sqlite.gz.json` 和 `.sqlite.gz.attachments/`，请成组保存。
- Google Drive：首次私密 OAuth 授权后启用，每周日北京时间 03:00 自动备份，保留最近 5 组成功完整备份；新组上传并下载校验成功后才清理旧组。
- 恢复：见 [docs/restore.md](./docs/restore.md)（离线 CLI，含哈希校验、回滚副本、版本兼容性检查）

## 安全基线（开发模式）

- Cookie：HttpOnly + SameSite=Lax；开发模式不加 Secure（HTTP），生产必须 HTTPS
- 所有写请求校验 Origin/Referer 与 CSRF Token；登录按账号/IP 限流（15 分钟 5 次/账号、30 次/IP）
- 金额统一整数分存储；统计口径统一按账单月份（`bill_month`）

## 部署与验收边界

- Google Drive 需要部署者自己的首次授权及服务器网络验收；本地备份成功不代表云端备份成功。阿里云盘适配器尚未实现。
- 默认只监听 `127.0.0.1`。根目录 `.env` 自动加载，系统变量优先；手机直连局域网属于另行配置的开发方式
- Cloudflare Access 令牌验证计划交给同机 cloudflared，当前应用不会校验 Access JWT；上线前必须完成外部配置及验证
- 自动浏览器测试覆盖 Chromium 桌面和移动视口；目标浏览器、长期备份、授权刷新及实际部署容量需分别验收。
