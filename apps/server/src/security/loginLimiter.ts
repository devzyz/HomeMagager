const WINDOW_MS = 15 * 60 * 1000
const MAX_PER_ACCOUNT = 5
const MAX_PER_IP = 30

type LoginGate = { ok: true } | { ok: false; retryAfterSec: number }
type LoginReservation = { ok: true; release: () => void } | { ok: false; retryAfterSec: number }

interface Bucket {
  hits: number[]
}

/**
 * 登录失败限流：按账号与客户端 IP 分别计数（15 分钟滑动窗口）。
 * 仅内存实现，进程重启清零可接受；不永久锁定账号。
 */
export class LoginRateLimiter {
  private readonly accounts = new Map<string, Bucket>()
  private readonly ips = new Map<string, Bucket>()
  private readonly pendingAccounts = new Map<string, number>()
  private readonly pendingIps = new Map<string, number>()
  private lastSweep = Date.now()

  check(username: string, ip: string): LoginGate {
    this.sweep()
    const now = Date.now()
    const accHits = this.prune(this.accounts.get(username)?.hits ?? [], now)
    const ipHits = this.prune(this.ips.get(ip)?.hits ?? [], now)
    if (accHits.length + (this.pendingAccounts.get(username) ?? 0) >= MAX_PER_ACCOUNT) {
      return { ok: false, retryAfterSec: Math.ceil((WINDOW_MS - (now - (accHits[0] ?? now))) / 1000) }
    }
    if (ipHits.length + (this.pendingIps.get(ip) ?? 0) >= MAX_PER_IP) {
      return { ok: false, retryAfterSec: Math.ceil((WINDOW_MS - (now - (ipHits[0] ?? now))) / 1000) }
    }
    return { ok: true }
  }

  /** Reserve synchronously before awaiting password verification. */
  reserve(username: string, ip: string): LoginReservation {
    const gate = this.check(username, ip)
    if (!gate.ok) return gate
    this.pendingAccounts.set(username, (this.pendingAccounts.get(username) ?? 0) + 1)
    this.pendingIps.set(ip, (this.pendingIps.get(ip) ?? 0) + 1)
    let released = false
    return {
      ok: true,
      release: () => {
        if (released) return
        released = true
        this.releasePending(this.pendingAccounts, username)
        this.releasePending(this.pendingIps, ip)
      },
    }
  }

  private releasePending(map: Map<string, number>, key: string): void {
    const remaining = (map.get(key) ?? 0) - 1
    if (remaining > 0) map.set(key, remaining)
    else map.delete(key)
  }

  recordFailure(username: string, ip: string): void {
    const now = Date.now()
    this.push(this.accounts, username, now)
    this.push(this.ips, ip, now)
  }

  recordSuccess(username: string, ip: string): void {
    this.accounts.delete(username)
    this.ips.delete(ip)
  }

  private push(map: Map<string, Bucket>, key: string, now: number): void {
    const b = map.get(key) ?? { hits: [] }
    b.hits = this.prune(b.hits, now)
    b.hits.push(now)
    map.set(key, b)
  }

  private prune(hits: number[], now: number): number[] {
    return hits.filter((t) => now - t < WINDOW_MS)
  }

  private sweep(): void {
    const now = Date.now()
    if (now - this.lastSweep < 60_000) return
    this.lastSweep = now
    for (const [k, b] of this.accounts) {
      b.hits = this.prune(b.hits, now)
      if (b.hits.length === 0) this.accounts.delete(k)
    }
    for (const [k, b] of this.ips) {
      b.hits = this.prune(b.hits, now)
      if (b.hits.length === 0) this.ips.delete(k)
    }
  }
}
