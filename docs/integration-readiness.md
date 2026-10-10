# 功能接入与部署边界

应用已具备账号认证、费用、附件、工资、报表导出、本地完整备份、Google Drive 完整备份和公开介绍/隐私说明页。业务 API 继续要求账号认证。

## 私密配置

运行配置读取进程环境变量或根目录 .env，已有进程变量优先。production 必须配置 HTTPS BASE_URL 与随机 SESSION_SECRET。真实域名、SSH 连接信息、Google OAuth 配置及实际验收状态只保存在私密目录，见 [代码与私密数据分离](./private-data-layout.md)。

## Cloudflare

通用接入步骤见 [Cloudflare 接入指南](./cloudflare-aliyun-setup.md)。浏览器经 Access 邮箱准入、Tunnel 回环转发后进入应用账号登录；同机代理可设置 TRUST_PROXY=loopback。

Access 邮箱策略与应用账号密码独立。cloudflared 需校验源站 JWT，应用不把邮箱头视作身份凭证，也未实现 Access JWT 校验。部署者须验证匿名或伪造请求不能绕过保护，并根据需要为公开介绍与隐私页配置访问策略。

## Google Drive

适配器及固定每周日北京时间 03:00、最近 5 组的逻辑已实现，授权与服务器网络由部署者配置。详见 [Google Drive 备份](./google-drive-backup.md)。本地保留与云端保留独立；服务器完整上传、下载和空目录恢复成功后才启用自动云备份。

## 阿里云盘

适配器尚未实现，保持 ALIYUN_DRIVE_ENABLED=false。源码中的开关和示例字段不代表已完成授权或上传。后续接入需要真实上传、令牌刷新、完整性校验、保留及恢复验证。

## 部署

AutoDL 与独立 Linux 服务器均有通用工具及步骤；实际连接信息、数据、备份、验收报告和旧仓库历史保留在被 Git 忽略的私密位置。服务器重启、长期授权刷新、实际浏览器和目标容量需按部署环境单独验收。
