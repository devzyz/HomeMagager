import fs from 'node:fs'
import path from 'node:path'
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import type { AppConfig } from './config.js'
import type { DB } from './types.js'
import { SessionManager } from './security/session.js'
import { LoginRateLimiter } from './security/loginLimiter.js'
import { registerCoreHooks, requireAuth } from './plugins/hooks.js'
import { registerAuthRoutes } from './modules/auth/routes.js'
import { registerUserRoutes } from './modules/users/routes.js'
import { registerDictionaryRoutes } from './modules/dictionaries.js'
import { registerExpenseRoutes } from './modules/expenses/routes.js'
import { registerAttachmentRoutes } from './modules/attachments/routes.js'
import { registerDashboardRoutes } from './modules/dashboard/routes.js'
import { registerReportRoutes } from './modules/reports/routes.js'
import { registerPayrollRoutes } from './modules/payroll/routes.js'
import { BackupService } from './modules/backup/service.js'
import { registerBackupRoutes } from './modules/backup/routes.js'
import { HttpError } from './lib/errors.js'
import { registerPublicRoutes } from './modules/public.js'

const WEB_DIST_DIR = path.resolve(import.meta.dirname, '..', '..', 'web', 'dist')

const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.body.password',
  'req.body.old_password',
  'req.body.new_password',
  'req.body.operator_password',
]

export async function buildApp(config: AppConfig, db: DB): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.env === 'test' ? 'warn' : 'info',
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    },
    bodyLimit: 64 * 1024,
    trustProxy: config.trustProxy,
  })

  app.decorate('config', config)
  app.decorate('db', db)
  app.decorate('sessions', new SessionManager(db, config.sessionMaxAgeDays))
  app.decorate('limiter', new LoginRateLimiter())

  await app.register(cookie)
  await app.register(rateLimit, {
    global: true,
    // Keep the page shell available to display API throttling errors.
    // Login also has stricter account/IP limits in its route.
    allowList: (req) => !/^\/api(?:\/|\?|$)/.test(req.url),
    max: 1000,
    timeWindow: '1 minute',
    errorResponseBuilder: (req) => ({
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: '请求过于频繁，请稍后再试',
      request_id: req.id,
    }),
  })
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10 },
  })

  registerCoreHooks(app)

  app.setErrorHandler<FastifyError>((err, req, reply) => {
    if (reply.raw.headersSent) return
    const rawStatus = err.statusCode ?? 500
    const status = rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500
    if (status >= 500) {
      req.log.error({ err }, 'internal error')
    } else {
      req.log.info({ msg: err.message }, 'request rejected')
    }
    let code: string
    let message: string
    if (status >= 500) {
      code = 'INTERNAL'
      message = '服务器内部错误'
    } else if (err instanceof HttpError) {
      code = err.code
      message = err.message
    } else {
      const fastifyCode = err.code
      code = typeof fastifyCode === 'string' && !fastifyCode.startsWith('FST_ERR_') ? fastifyCode : status === 401 ? 'UNAUTHORIZED' : status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 429 ? 'RATE_LIMITED' : 'BAD_REQUEST'
      message = err.message
    }
    void reply.code(status).send({ code, message, request_id: req.id })
  })

  let hasStatic = false
  if (fs.existsSync(path.join(WEB_DIST_DIR, 'index.html'))) {
    await app.register(fastifyStatic, { root: WEB_DIST_DIR, wildcard: false })
    hasStatic = true
  }

  app.setNotFoundHandler((req, reply) => {
    const wantsHtml =
      req.method === 'GET' && !req.url.startsWith('/api') && (req.headers.accept ?? '').includes('text/html')
    if (wantsHtml && hasStatic) {
      void reply.sendFile('index.html')
      return
    }
    void reply
      .code(404)
      .send({ code: 'NOT_FOUND', message: req.url.startsWith('/api') ? '接口不存在' : '页面不存在', request_id: req.id })
  })

  registerPublicRoutes(app)
  registerAuthRoutes(app)
  registerUserRoutes(app)
  registerDictionaryRoutes(app, { basePath: '/api/shops', table: 'shops', label: '店铺' })
  registerDictionaryRoutes(app, { basePath: '/api/categories', table: 'expense_categories', label: '类别' })
  registerExpenseRoutes(app)
  registerAttachmentRoutes(app)
  registerDashboardRoutes(app)
  registerReportRoutes(app)
  registerPayrollRoutes(app)
  const backupService = new BackupService(db, config)
  app.decorate('backup', backupService)
  registerBackupRoutes(app, backupService)

  app.get('/api/health', async (_req, reply) => {
    try {
      app.db.prepare('SELECT 1').get()
      return { status: 'ok', database: 'ok' }
    } catch {
      void reply.code(503).send({ status: 'error', database: 'error' })
    }
  })

  return app
}

export { requireAuth }
