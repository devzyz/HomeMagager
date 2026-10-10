# example.com 接入操作指南

本文使用 example.com 作为示例域名。实际域名、准入邮箱、隧道令牌与云盘配置只保存在部署者的私密配置中。

## 先做什么

先完成 Cloudflare 的域名接入和邮箱准入，再部署固定隧道。阿里云盘可以同时申请开放平台资格，但真实云备份还需要开发上传功能，不能只打开当前设置里的开关。

建议业务地址为 `https://app.example.com`。将示例替换为自己的私密配置；仓库中继续保留示例值。根域名 `example.com` 添加到 Cloudflare，业务使用其中的 `app` 子域名。

## 一、把域名接入 Cloudflare

1. 打开 [Cloudflare 控制台](https://dash.cloudflare.com/)，注册或登录。
2. 找到「添加域名 / Add a domain / Onboard a domain」入口，输入 **example.com**，按页面选择适合的计划。此步骤是接入 DNS，不需要把域名转移到 Cloudflare 注册商。
3. 检查自动扫描到的 DNS 记录；如果已有网站或邮箱，要保留其所需记录。新域名无需为了此应用先添加指向虚拟机公网 IP 的 A 记录。
4. Cloudflare 会给出 **两条专属于此域名的 Nameserver 地址**。复制它们，不能照抄教程中别人的地址。
5. 回到购买域名的网站，进入 `example.com` 的管理页面，找「DNS 服务器 / 修改 DNS 服务器 / Nameserver」。将原来的服务器替换成 Cloudflare 给出的两条地址。这不是在 DNS 解析列表中添加两条 NS 记录。
6. 如果注册商启用了 DNSSEC，按 Cloudflare 指引先处理旧的 DNSSEC/DS 配置，再更换 Nameserver；域名激活后可在 Cloudflare 重新启用。
7. 回到 Cloudflare 等待域名状态变为 **Active / 有效**。后台确认 Active 后再继续；不要以“已提交修改”代替生效判断。

DNS 生效状态应以部署者自己的控制台为准。排查时不要公开账号密码、具体准入邮箱或隧道 Token。

依据：[Cloudflare 完整 DNS 接入与 Nameserver 更换](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)。

## 二、设置邮箱验证，再发布应用

1. 在 Cloudflare One / Zero Trust 中完成团队初始化。
2. 在身份提供方 / Login methods 中启用 **One-time PIN**（邮箱验证码）。官方控制台文案可能因入口调整略有不同。
3. 在 Access 的 Applications 中新增 **Self-hosted** 应用，名称可填 `HomeManager`，应用域名填 **app.example.com**，保护整个域名，不只保护 `/login`。
4. 新建 **Allow** 策略：Include 条件选择 **Emails**，逐个填写允许使用的家庭成员邮箱。登录方式使用 One-time PIN。
5. 不要创建 Everyone 或 Bypass 作为家庭成员规则。最终体验是先通过 Cloudflare 邮箱验证码，再登录 HomeManager 的账号密码。

邮箱必须先被策略允许才能收到验证码。页面显示“已发送”本身不能证明邮箱已获准。

依据：[发布受 Access 保护的应用](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)、[邮箱验证码登录](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)。

## 三、在应用虚拟机上安装固定隧道

以下步骤在应用服务器执行；SSH 测试隧道只用于本机验收。

1. 在 Cloudflare 控制台 **Networking → Tunnels**（部分入口显示为 Networks / Connectors / Cloudflare Tunnels）创建一个隧道，例如 `homemanager`。
2. 选择应用虚拟机的实际操作系统，按后台提供的命令在该虚拟机安装 `cloudflared` 服务。后台命令包含隧道 Token，只在目标机器执行，不发聊天、不写入版本库。等待连接器显示已连接。
3. 在隧道的 Routes 中添加 **Published application**：

   | 项目 | 值 |
   | --- | --- |
   | 子域名 | `app` |
   | 域名 | `example.com` |
   | 路径 | 留空，覆盖整个应用 |
   | 源站服务 | `http://127.0.0.1:3000` |

4. 对该路由启用 **Protect with Access**，选择对应团队及 HomeManager 应用，使 `cloudflared` 验证 Access Token。只有邮箱登录页面而没有源站验证，不算完整配置。
5. HomeManager 与 `cloudflared` 都运行在同一虚拟机；HomeManager 只监听 `127.0.0.1:3000`。隧道要求虚拟机能出站访问 Cloudflare；按官方指引检查 7844 端口连通性。

应用部署配置示例（密钥必须另行生成并安全保存）：

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
BASE_URL=https://app.example.com
TRUST_PROXY=loopback
TZ=Asia/Shanghai
# SESSION_SECRET 在服务器上生成并填写至少 64 个十六进制字符的随机密钥
ALIYUN_DRIVE_ENABLED=false
```

构建后由 systemd 等服务管理器启动 `pnpm start:prod`，设置应用和隧道的开机自启。当前生产配置会拒绝缺失 BASE_URL 或 SESSION_SECRET 的启动。

验收顺序：非白名单邮箱不能进入；白名单邮箱验证码成功后能看到应用登录页；应用登录后费用、工资、附件、Excel、打印可用；虚拟机重启后自动恢复；业务端口不会绕过 Access 暴露。正式部署应使用服务器直接连接 Cloudflare 的链路。

依据：[创建后台管理的 Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/)、[源站 Access Token 验证](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)。

## 四、阿里云盘：先确认能否创建开放平台应用

1. 打开 [阿里云盘开发者门户](https://www.alipan.com/developer)，使用你的阿里云盘账号登录。
2. 查找开发者入驻/申请及应用管理入口，根据后台实际要求填写申请。建议应用名称 `HomeManager`，用途如实写“家庭费用和工资系统的个人数据库、凭证附件定期备份与恢复”。
3. 若显示资质要求、申请审核或没有创建入口，先记录提示文字；不要假定拥有普通云盘账号就一定能够创建应用。具体准入条件以部署者登录后的官方页面为准。
4. 申请获准后，记录应用 ID、申请的文件权限及可用授权方式。文件创建/上传、列表/读取/下载，以及实施保留策略时的删除能力，需要对应授权。只申请备份实际所需权限。
5. 回调地址需要与后续实际实现的授权接口一致；当前项目还没有阿里云盘 OAuth 回调，不要随意填一个地址并视作已经接通。若平台提供适合本项目的扫码授权方式，可在接入开发时选用。
6. 首次授权由你在官方页面确认。应用密钥和刷新令牌保存在服务器受限文件/秘密配置中，不出现在前端、HTML 预览和 Git 中。

官方 SDK 文档确认有应用 ID、授权流程与上传下载能力，但它不证明每个个人账号的申请一定通过：[阿里巴巴官方阿里云盘 SDK 与开发者接入指南](https://alibaba.github.io/aliyunpan-ios-sdk/)。

## 五、取得授权后，还要开发哪些内容

下列是本项目尚未实现的工作，不是已经可用的按钮设置：

- 接入官方授权及令牌刷新，授权失效时明确提示重新授权。
- 将数据库、附件和校验清单成组上传到 **/homeManager/**；远端组完整且校验通过后，才记录“云备份成功”。
- 实现 **Asia/Shanghai 每周日 03:00** 的调度、失败重试、离线错过任务的处理。
- 云端按既定目标保留 **最近 8 周** 的完整备份组；本地保留规则单独设置，不能相互冒充。
- 从云盘下载一组备份到空目录，恢复并核对成员、费用、工资、附件。能看到远端文件不等于恢复验收完成。

在这部分完成前保持 `ALIYUN_DRIVE_ENABLED=false`，继续使用现有完整本地备份。已有开关和注释中的 Client ID 字段只是预留，填入不会自动上传。

## 上线前仍待解决的已知问题

迁移前完整备份与并发登录限流已有实现和回归测试。正式部署仍需在实际环境验证升级、恢复、Access 保护和长期运行。
