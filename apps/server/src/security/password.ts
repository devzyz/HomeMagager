import { hash, verify } from '@node-rs/argon2'

// OWASP 推荐的 Argon2id 参数下限：m=19 MiB, t=2, p=1
const ARGON2_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 }

class Semaphore {
  private queue: (() => void)[] = []
  private active = 0

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      const next = this.queue.shift()
      if (next) next()
    }
  }
}

const argonLimit = new Semaphore(2)

export function hashPassword(plain: string): Promise<string> {
  return argonLimit.run(() => hash(plain, ARGON2_OPTS))
}

export function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  return argonLimit.run(() => verify(storedHash, plain))
}

const USERNAME_RE = /^[a-z0-9_-]{3,32}$/

/** 用户名规范化：去空白 + 小写；规范化后需满足 3~32 位 [a-z0-9_-] */
export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase()
}

export function validateUsername(input: string): { username: string } | { error: string } {
  const username = normalizeUsername(input)
  if (!USERNAME_RE.test(username)) {
    return { error: '用户名需 3~32 位，仅限小写字母、数字、下划线和短横线' }
  }
  return { username }
}

/** 密码 12~128 字符，不截断；按 Unicode 码点计数 */
export function validatePassword(plain: string): string | { error: string } {
  const len = [...plain].length
  if (len < 12 || len > 128) return { error: '密码长度需为 12~128 个字符' }
  return plain
}

/** 显示名 1~50 字（去除首尾空白） */
export function validateDisplayName(input: string): string | { error: string } {
  const name = input.trim()
  const len = [...name].length
  if (len < 1 || len > 50) return { error: '显示名需为 1~50 个字符' }
  return name
}
