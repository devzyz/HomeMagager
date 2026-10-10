import type { FastifyInstance } from 'fastify'

function page(title: string, content: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · HomeManager</title><style>body{margin:0;background:#f4f6f8;color:#243044;font:16px/1.8 system-ui,sans-serif}main{max-width:760px;margin:32px auto;padding:28px;background:white;border-radius:12px}h1{font-size:28px;line-height:1.4}h2{font-size:20px;margin-top:28px}a{color:#1765c1}nav{display:flex;gap:20px;flex-wrap:wrap}p,li{overflow-wrap:anywhere}@media(max-width:800px){main{margin:12px;padding:20px}}</style></head><body><main><nav><a href="/about">应用介绍</a><a href="/privacy">隐私政策</a><a href="/login">进入应用</a></nav><h1>${title}</h1>${content}</main></body></html>`
}

const PRIVACY = page('隐私政策', `
<p>应用名称：HomeManager（家庭费用管理）。更新日期：2026 年 10 月 10 日。</p>
<p>HomeManager 用于授权成员记录店铺费用、凭证附件、工资和报表。本文说明应用实际处理的数据，以及可选 Google Drive 备份的用途。</p>
<h2>处理哪些数据</h2>
<p>应用保存您录入的账号名、显示名称、店铺、费用、工资、备注及凭证附件。密码以哈希形式保存；登录会话用于身份验证。部署服务器可能记录请求时间、访问地址、来源 IP 和错误信息，用于运行维护。</p>
<h2>Google Drive 授权与用途</h2>
<p>只有完成 Google 授权并启用备份后，应用才将数据库快照、凭证附件和校验清单上传至您授权的 Google Drive，默认目录为 homeManager。数据库备份包含业务数据和账号密码哈希，备份前会清除登录会话。</p>
<p>应用请求 drive.file 权限，访问由该 OAuth 应用创建或由您明确授权给它的文件。备份功能只处理其自身创建的备份组，不主动扫描、修改或删除您其他的网盘文件。授权令牌保存在服务器私密配置中，供后台备份使用。</p>
<p>Google 用户数据仅用于提供您请求的备份、校验、保留清理和恢复功能，不用于广告、出售数据或训练通用人工智能模型。HomeManager 对通过 Google API 获取的信息的使用和向其他应用的传输遵循 Google API Services User Data Policy，包括 Limited Use 要求。</p>
<h2>保存和删除</h2>
<p>业务数据保存在部署者指定的服务器。启用云备份后，默认每周日北京时间 03:00 创建完整备份；仅在新组上传并校验成功后，永久清理超过最近 5 组的本应用备份。本地备份数量由服务器另行配置。历史备份可能保留后来在应用中删除的数据，直到该备份组按保留策略被清理。</p>
<p>您可以在 Google 账号的第三方连接设置中撤销授权，停止应用后续访问 Google Drive。撤销授权不会自动删除已存在的备份；您可在 Google Drive 中自行删除它们。停用应用或申请删除服务器数据，请联系部署管理者。</p>
<h2>数据传输与保护</h2>
<p>公开服务通过 HTTPS 访问。部署者及其指定的服务器、网络代理服务商提供运行环境；启用 Google Drive 后，Google 提供云存储。数据可能由这些服务商在其基础设施所在地处理。备份文件不额外进行应用层加密，请仅授权您信任的 Google 账号。</p>
<p>业务页面和接口要求应用账号登录。公开的应用介绍及本政策不包含您的业务数据。Google OAuth 客户端配置和令牌不通过业务页面展示。</p>
<h2>联系与政策更新</h2>
<p>关于数据访问、删除或本政策的问题，请联系 应用管理员（通过部署者提供的私密联系方式）。功能或数据处理方式变化时，部署者应同步更新本政策。</p>
<p><a href="https://developers.google.com/terms/api-services-user-data-policy" rel="noopener noreferrer">Google API Services User Data Policy</a> · <a href="https://myaccount.google.com/connections" rel="noopener noreferrer">管理 Google 第三方连接</a></p>`)

export function registerPublicRoutes(app: FastifyInstance): void {
  const serve = (html: string) => async (_req: unknown, reply: import('fastify').FastifyReply) => {
    return reply.header('Cache-Control', 'no-store, no-transform').header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
      .header('X-Content-Type-Options', 'nosniff').type('text/html; charset=utf-8').send(html)
  }
  app.get('/privacy', serve(PRIVACY))
  app.get('/about', serve(page('HomeManager · 家庭费用管理', `<p>面向授权成员的店铺费用与工资记录工具，支持凭证附件、汇总报表和完整数据备份。</p><p>Google Drive 是可选的云备份目标。启用后，应用只在您的授权范围内保存并校验自己的备份文件，按最近 5 组的规则清理历史备份。</p><p>业务功能需要应用账号登录；本介绍和隐私政策可公开阅读。</p><p><a href="/login">登录家庭费用管理</a> · <a href="/privacy">阅读隐私政策</a></p><p>联系：应用管理员（通过部署者提供的私密联系方式）</p>`)))
}
