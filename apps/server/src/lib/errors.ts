export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST'): HttpError =>
  new HttpError(400, code, message)

export const unauthorized = (message = '未登录或登录已过期', code = 'UNAUTHORIZED'): HttpError =>
  new HttpError(401, code, message)

export const forbidden = (message: string, code = 'FORBIDDEN'): HttpError =>
  new HttpError(403, code, message)

export const notFound = (message = '资源不存在'): HttpError => new HttpError(404, 'NOT_FOUND', message)

export const conflict = (message: string, code = 'CONFLICT'): HttpError => new HttpError(409, code, message)

export const payloadTooLarge = (message: string): HttpError =>
  new HttpError(413, 'PAYLOAD_TOO_LARGE', message)

export const tooManyRequests = (message: string): HttpError => new HttpError(429, 'RATE_LIMITED', message)
