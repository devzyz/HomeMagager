export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

let csrfToken = ''
export function setCsrfToken(t: string): void {
  csrfToken = t
}
export function getCsrfToken(): string {
  return csrfToken
}

type UnauthorizedHandler = (err: ApiError) => void
let unauthorizedHandler: UnauthorizedHandler | null = null
export function setUnauthorizedHandler(h: UnauthorizedHandler | null): void {
  unauthorizedHandler = h
}

let connectionHandler: ((message: string) => void) | null = null
export function setConnectionHandler(handler: ((message: string) => void) | null): void {
  connectionHandler = handler
}

function networkError(): ApiError {
  const message = '连接未完成，请检查网络；若访问验证已过期，请重新打开当前页面完成验证。'
  connectionHandler?.(message)
  return new ApiError(0, 'NETWORK', message)
}

export function assertApiResponse(res: Response): void {
  if (res.redirected || res.type === 'opaqueredirect' || (res.headers.get('content-type') ?? '').includes('text/html')) {
    const message = '访问入口需要重新验证，或服务暂不可用。请重新打开当前页面后再试。'
    connectionHandler?.(message)
    throw new ApiError(res.status, 'ACCESS_REVALIDATION_REQUIRED', message)
  }
}

export interface RequestOpts {
  query?: Record<string, string | number | undefined | null>
  body?: unknown
}

function cleanQuery(query?: Record<string, string | number | undefined | null>): string {
  if (!query) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

async function parseResponse<T>(res: Response, authRedirect = true): Promise<T> {
  assertApiResponse(res)
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    if (res.ok) throw new ApiError(res.status, 'INVALID_RESPONSE', '服务器返回了无效数据，请稍后重试')
  }
  if (!res.ok) {
    const body = data as { code?: string; message?: string; request_id?: string } | null
    const err = new ApiError(res.status, body?.code ?? 'ERROR', body?.message ?? `请求失败（${res.status}）`, body?.request_id)
    if (res.status === 401 && authRedirect) {
      unauthorizedHandler?.(err)
    }
    throw err
  }
  return data as T
}

async function request<T>(method: string, path: string, opts: RequestOpts = {}): Promise<T> {
  const headers: Record<string, string> = {}
  const hasBody = opts.body !== undefined
  if (hasBody) headers['content-type'] = 'application/json'
  if (csrfToken && method !== 'GET' && path !== '/auth/login') {
    headers['x-csrf-token'] = csrfToken
  }
  let res: Response
  try {
    res = await fetch(`/api${path}${cleanQuery(opts.query)}`, {
      method,
      headers,
      body: hasBody ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    })
  } catch {
    throw networkError()
  }
  const result = await parseResponse<T>(res, path !== '/auth/login')
  return result
}

/** multipart 文件上传（单文件，字段名 file） */
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const fd = new FormData()
  fd.append('file', file)
  const headers: Record<string, string> = {}
  if (csrfToken) headers['x-csrf-token'] = csrfToken
  let res: Response
  try {
    res = await fetch(`/api${path}`, { method: 'POST', headers, body: fd, credentials: 'same-origin' })
  } catch {
    throw networkError()
  }
  return parseResponse<T>(res)
}

export const api = {
  get: <T>(path: string, query?: RequestOpts['query']) => request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  delete: <T>(path: string) => request<T>('DELETE', path),
}
