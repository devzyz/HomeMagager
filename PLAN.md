# 家庭店铺费用管理系统 — 开发计划（v1 开发版）

> **2026-10-10 云备份需求更新（优先于下文历史计划）**：最终服务部署在日本服务器；云备份目标改为 Google Drive，目录 `/homeManager/`，每周日北京时间 03:00 执行，只保留最近 **5 组成功且完整的备份**（按组数，不按周数）。每组包含数据库、凭证附件和校验清单；新组上传、校验成功后才淘汰旧组。Google Drive 上传、固定周调度及云端保留策略已实现；已迁至日本服务器，本地保留配置独立。Google 授权、服务器真实上传、下载和独立恢复均已通过，自动云备份已启用。当前低并发资源验收通过；具体迁移与实测见 `docs/japan-deployment.md`。详见 `docs/google-drive-backup.md`。

> **2026-09-26 范围更新（优先于下文历史计划）**：最终入口采用同机 Cloudflare Tunnel + Access 邮箱准入 + 应用账号密码，云备份目标为阿里云盘。当前暂缓外部配置/上传适配器，只完成本地适配：默认回环监听、根目录环境配置、受限代理信任、认证异常提示和标签页草稿、数据库与附件成组备份/恢复、云与本地状态隔离。具体见 `docs/integration-readiness.md`。下文“附件不备份”和 Tailscale 方案不再适用于后续实现。

> 依据《家庭店铺费用管理系统 — Agent 实现规格（最终版）》（下称"规格"）制定。
> 本期为**开发版**：跳过阿里云盘、生产部署、Tailscale 相关实现，通过浏览器在本地访问；规格中其余业务规则、安全基线、数据口径与质量要求全部保留，不再重复抄录，各阶段直接引用规格章节号执行。

## 0. 本期范围裁剪（相对规格）

| 项 | 处理方式 |
| --- | --- |
| 阿里云盘云备份（规格 10.4、云端验收） | **整体跳过**。保留 `BackupProvider` 抽象与 `backup_runs.provider` 字段（`local/aliyundrive`），`AliyunDriveBackupProvider` 仅留占位不实现；云端备份按钮禁用并说明"云端备份未接入" |
| 生产部署（Dockerfile、docker-compose.yml、.dockerignore、部署文档） | **跳过**。本地以 `pnpm dev` / `pnpm start`（Node 进程）运行 |
| Tailscale、公网 HTTPS（docs/tailscale.md、docs/public-deployment.md） | **跳过**。访问方式 = 浏览器打开 `http://localhost:3000` |
| BASE_URL / Secure Cookie / TRUST_PROXY 反代验证 | 生产项跳过实跑；代码保留开关：开发模式 Cookie 不加 Secure，Origin 白名单为 localhost |
| docs/ubuntu22-low-memory.md（服务器 Swap 建议） | 跳过 |
| 服务器实测资源数据 | 无服务器访问，仅记录开发机观测值作为参考 |

裁剪不影响：全部业务功能、账号安全、附件、Dashboard、报表/Excel/打印、**本地**备份与恢复闭环。

## 1. 技术选型

| 项 | 选型 |
| --- | --- |
| 运行时 | Node.js 24 LTS（本机 v24.18.1） |
| 包管理 | pnpm workspace（`apps/web`、`apps/server`），不引入构建平台 |
| 后端 | Fastify 5 + TypeScript 5，模块化单体；pino 日志（redact 屏蔽敏感字段） |
| 参数校验 | TypeBox（Fastify 原生 JSON Schema，类型可与前端共享） |
| 数据库 | SQLite + better-sqlite3；自写版本化 SQL migration runner（`schema_migrations` 表） |
| 密码 | `@node-rs/argon2`（预编译二进制；参数 m=19456, t=2, p=1；全站并发计算 ≤2，用信号量控制） |
| Session | `@fastify/session` + **自写 better-sqlite3 store**（`sessions.csrf_token` 落库）；CSRF 用 `@fastify/csrf-protection` |
| 上传 | `@fastify/multipart`（单请求 11 MiB，JSON 64 KiB；全站并发上传 ≤2） |
| 限流 | `@fastify/rate-limit` 全局兜底 + 登录按账号（5 次/15min）、按 IP（30 次/15min）自定义内存计数 |
| Excel | ExcelJS 流式写出（WorkbookWriter），全站同时 1 个生成任务 |
| 前端 | Vue 3 + Vite + TypeScript + Element Plus（unplugin 按需引入）+ pinia + vue-router；ECharts 用 `echarts/core` 按需注册 |
| 测试 | vitest（单元 + 集成，独立临时库/目录）；Playwright e2e 仅开发机运行（Chromium，移动视口 + 桌面），不进任何生产产物 |
| 调度 | 进程内轻量调度器：每小时到期检查，冷却状态持久化在 `backup_runs`，无消息队列/Redis |

具体版本在实施时选取当前受维护且相互兼容者，提交 pnpm lockfile。

## 2. 目录结构

```text
apps/
  server/                 # Fastify 后端
    src/
      app.ts              # 应用组装、插件、钩子
      config.ts           # 环境变量加载与校验
      database/           # 连接管理(PRAGMA)、migration runner、事务工具
      modules/
        auth/             # login/logout/me/change-password、CSRF、限流
        users/            # 成员管理、user:init、user:reset-password 命令
        shops/  categories/
        expenses/         # CRUD、筛选、防重、版本乐观锁
        attachments/      # 上传校验、预览/下载/删除、磁盘水位
        dashboard/
        reports/          # 报表数据 + Excel 流式导出
        backup/           # BackupService、LocalBackupProvider、调度、恢复 CLI
      plugins/            # session store、origin 校验、错误处理、静态资源
  web/                    # Vue 3 前端
    src/
      api/  stores/  router/
      views/              # login/dashboard/expenses/reports/settings/*
      components/
migrations/               # 0001_init.sql ...（含初始类别幂等插入）
tests/                    # 集成测试 + Playwright e2e
docs/restore.md           # 恢复文档（本期仅覆盖本地）
.env.example
```

## 3. 数据模型与数据库

按规格第 4 节完整实现（字段、约束、索引、PRAGMA 均照规格）：

- `users` / `sessions` / `shops` / `expense_categories` / `expenses` / `expense_attachments` / `backup_runs` / `schema_migrations`
- 业务实体 UUID 主键；时间戳 UTC；`backup_runs.provider` 本期只会写入 `local`，`remote_*` 字段留空备用
- 初始 8 个类别（水费/电费/房租/物业费/燃气费/网络费/维修费/其他）在 migration 中幂等插入，之后不覆盖用户修改
- PRAGMA：`foreign_keys=ON, journal_mode=WAL, busy_timeout=5000, synchronous=FULL`；单写连接、短事务

## 4. 开发版运行方式

```bash
pnpm install
pnpm --filter server run user:init     # 交互式创建首个家庭账号（仅用户表为空时可用）
pnpm dev                               # Fastify:3000 + Vite:5173(代理 /api)
pnpm test / pnpm build / pnpm typecheck / pnpm lint
```

- 数据目录（dev）：`./data/{database,uploads,backups}`，写入 `.gitignore`，绝不入 Git
- `.env.example`：保留本地相关项；`ALIYUN_*` 注释标明"未接入"；`SESSION_SECRET` 开发模式缺省时自动生成并警告，生产必填校验逻辑保留但不触发
- 开发模式安全基线：Cookie `HttpOnly`+`SameSite=Lax`，不加 Secure（HTTP）；Origin 白名单 = `localhost:3000/5173`；`TRUST_PROXY=false`；登录限流照常启用
- `pnpm build` 后可 `pnpm start`：Fastify 同源托管前端产物 + API，SPA 回退仅限非 `/api` GET，`/api` 未匹配返回 JSON 404

## 5. 实施顺序

每阶段结束必须通过 `lint`、`typecheck`、`test`、`build`；发现问题当阶段修复。

### 阶段 1：骨架、账号与基础数据
- pnpm workspace、TS/ESLint/vitest 配置、配置加载与校验
- 数据库连接（PRAGMA）、migration runner、`0001_init.sql`（全部表 + 索引 + 初始类别）
- `user:init` 交互式命令（Argon2id、至少一个启用账号保护）
- `/auth`：login/logout/me/change-password；Session SQLite store、CSRF Token 下发、Origin 校验、登录限流、错误不泄露账号存在性
- `/users`：列表/新增/启停/改显示名/reset-password（操作者密码验证、首登强制改密、停用与改密即撤销 Session、禁停自己）
- `/shops`、`/categories`：CRUD、排序、启停（不物理删除）
- 前端：登录页、整体布局与底部导航、设置页（店铺/类别/成员/本人资料）、加载/空/错误状态基建

### 阶段 2：费用与附件
- `/expenses`：统一筛选（交集、边界含端点、起点≤终点）、分页（默认 20/最大 100）、返回总笔数与筛选范围合计
- 新增：UUID 幂等防重（同 ID 同数据返回已有、不同数据 409）；金额字符串转分（禁浮点）；`bill_month`/`paid_date` 真实日历校验、缴费日期≤今天（Asia/Shanghai）；停用关联规则
- 修改：`version` 条件更新，冲突 409；删除：事务删记录+附件元数据，文件后清
- 附件：仅 JPEG/PNG/WEBP/PDF，签名+声明 MIME+扩展名+大小校验，流式临时文件、UUID 落盘；并发≤2；数量在事务内复核；预览/下载/删除走鉴权 API；磁盘<256MiB 拒绝上传
- 前端：费用列表（移动卡片/桌面表格）、新增/编辑/详情、附件上传与预览、删除二次确认（显示店铺、金额、附件数）

### 阶段 3：Dashboard、报表、Excel、打印
- `/dashboard`：全部按 `bill_month` 口径——月合计、所在自然年合计、上月环比（除零显示 `--`）、连续 12 个月趋势（无记录补 0）、类别占比、全部店铺时的店铺对比；"本月尚未结束"标注
- `/reports` + `/reports/excel`：共享筛选解析与汇总，同一读快照；Excel 两个 Sheet、金额写 Number（两位小数）、备注作字符串、流式、单任务、10000 条上限（超限报错不截断）、RFC 5987 中文文件名
- `/reports/print`：同一条件、1000 条上限、A4/重复表头/总计、`@media print`
- 筛选条件经 URL 查询参数贯穿首页/费用/报表/打印/导出
- 前端：Dashboard（ECharts 懒加载）、报表页、打印页

### 阶段 4：本地备份与恢复
- `BackupService` + `LocalBackupProvider`：单任务锁→磁盘检查→better-sqlite3 backup API 一致性快照→副本清 Session→完整性/外键检查→流式 gzip→SHA-256+JSON 元数据（`attachments_included=false`）→落盘→记录→清理临时→释放锁
- 命名 `family-expense-YYYYMMDD-HHmmss-<id>.sqlite.gz`；保留 `LOCAL_BACKUP_KEEP=2` 组 + 上传失败重试副本语义本期仅本地失败场景（保留最新 1 组）
- `/backup/status`、`/backup/runs`（分页）、`POST /backup/runs`（202+job_id、重复触发返回现有任务）；备份页显示最近成功/状态/下次到期
- 调度：启动后每小时检查，`BACKUP_INTERVAL_DAYS=7` 到期自动跑；失败冷却 ≥1h（按持久化运行记录，重启不绕过）；超时（10min）可取消、结束实际操作后释放锁；重启将遗留 `running` 标记为 `interrupted`
- 恢复：离线 CLI（停应用→临时目录解压→哈希/完整性/外键/版本校验→保留回滚副本→`.db`+`-wal`+`-shm` 成组替换→按需迁移）+ `docs/restore.md`（本期限本地）；独立目录真实恢复演练一次
- 附件恢复：按文档手工复制 uploads 目录的说明

### 阶段 5：测试补全与交付
- Playwright e2e（开发机）：登录→建店铺/类别→录入→附件→列表/筛选→Dashboard→报表→Excel 下载→打印→备份恢复；移动视口（375×667）+ 桌面
- 按规格第 13 节测试矩阵补全（云端项除外），全部使用独立临时数据库与目录
- README（本地开发运行、首次登录、备份/恢复方法）、交付报告（完成/未完成、实测结果、已知限制）

## 6. 本期验收标准

- `pnpm install && user:init && pnpm dev` 后浏览器完成全流程：登录、店铺/类别/成员管理、费用录入（含附件）、手机视口操作、Dashboard、组合筛选、Excel、打印
- 进程重启不丢数据（Session 含在内）
- 真实本地备份 + 独立目录恢复演练通过；备份失败不阻断核心业务
- 云端备份按钮禁用且说明明确，不伪造云端结果
- 相同数据与筛选下，列表、报表、Excel、打印总计一致

## 7. 测试计划（本期执行范围）

| 范围 | 覆盖项 |
| --- | --- |
| 身份安全 | 首次初始化、错误密码、限流、Session 重启持久化/过期/退出、停用与改密后失效、临时密码限制、最后账号保护、CSRF、Origin 校验 |
| 数据规则 | 金额转换、零/负/超限/多位小数、闰日与无效日期、跨年月份、预付账单、停用历史保留、关联不存在、重复新增、版本冲突 |
| 统计导出 | 组合筛选、稳定分页、跨月补 0、环比除零、账单/缴费日期不同、停用店铺入账、全量导出非当前页、四端汇总一致、Excel 数字类型、打印 |
| 附件 | 格式伪造、路径穿越、超限/并发数量、未登录访问、费用已存但附件失败、删除残留、恢复后文件缺失提示 |
| 备份恢复（仅本地） | 活跃写入时一致性、哈希/完整性、独立恢复、7 天到期、失败冷却、重复触发、超时取消、重启中断、磁盘水位 |

## 8. 无法确定 / 本期未处理清单

**用户决定跳过：**
1. 阿里云盘备份全部实现与验收（凭据申请、官方授权、Token 生命周期、真实上传/下载、独立云端恢复、重启续传）
2. Dockerfile / docker-compose.yml / .dockerignore / 生产镜像验证（本机也无 Docker）
3. 部署文档：docs/tailscale.md、docs/public-deployment.md、docs/ubuntu22-low-memory.md
4. BASE_URL、HTTPS、Secure Cookie、TRUST_PROXY 反代场景实跑验证
5. 服务器实测资源数据（内存峰值、备份耗时等），仅记录开发机参考值

**待后续确定（恢复接入前需解决）：**
6. 阿里云盘开放平台准入状态与 `client_id`/`client_secret`（需用户登录 developer 入口申请）
7. 生产 `SESSION_SECRET` 与最终访问入口地址
8. 真机与微信内置浏览器兼容性（本期浏览器测试仅开发机模拟视口，结果将如实标注"模拟器验证"）
9. CI 流水线未配置，全部检查在本地执行
10. 多实例/网络盘部署等生产运维约束（规格第 12 节其余项）随部署阶段一并处理

## 9. 实施偏差记录（与规格/计划字面要求的差异及原因）

1. **Excel 生成改用内存构建**（规格 9：流式写出）：exceljs 4.4.0 的 stream 写入器在 Node 24 下产出 workbook.xml/styles 为空的损坏文件（已实测确认三种用法均复现）。改为内存 Workbook 构建；因明细行数硬上限 10000，内存占用有界（约几 MB），并保留"全站同时仅一个导出任务"约束。
2. **Session 组件自研**（规格 5.2：使用成熟 Cookie/Session 组件）：`@fastify/session` 的自定义 SQLite store 需要序列化其内部 Session 对象，与"服务端仅存摘要 + `sessions.csrf_token` 落库"的表结构耦合困难。改为 `@fastify/cookie` + 自研 ~120 行 Session 模块（crypto 随机 ID、SHA-256 摘要落库、绝对过期、启用状态实时校验），行为完全符合规格 5.2 的安全要求。
3. **登录限流为内存实现**：规格未要求持久化（仅备份冷却要求持久化），进程重启清零可接受。
