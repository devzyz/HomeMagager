import type { FastifyReply } from 'fastify'
import type { AppConfig } from '../config.js'

export const SESSION_COOKIE = 'famsid'

export function setSessionCookie(reply: FastifyReply, config: AppConfig, rawId: string): void {
  reply.setCookie(SESSION_COOKIE, rawId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.env === 'production',
    maxAge: config.sessionMaxAgeDays * 86400,
  })
}

export function clearSessionCookie(reply: FastifyReply, config: AppConfig): void {
  reply.clearCookie(SESSION_COOKIE, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.env === 'production',
  })
}
