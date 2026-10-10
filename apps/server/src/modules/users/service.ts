import type { DB } from '../../types.js'
import { conflict } from '../../lib/errors.js'
import { nowIso } from '../../lib/time.js'

/**
 * 停用/启用成员。事务内再次保证至少保留一个启用账号。
 * revokeSessions 由调用方注入（停用时撤销目标用户全部 Session）。
 */
export function setUserActive(
  db: DB,
  targetId: string,
  isActive: boolean,
  revokeSessions: (userId: string) => void,
): void {
  const tx = db.transaction(() => {
    if (!isActive) {
      const others = db
        .prepare('SELECT COUNT(*) AS c FROM users WHERE is_active = 1 AND id != ?')
        .get(targetId) as { c: number }
      if (others.c === 0) throw conflict('必须保留至少一个启用账号', 'LAST_ACTIVE_USER')
    }
    db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?').run(
      isActive ? 1 : 0,
      nowIso(),
      targetId,
    )
    if (!isActive) revokeSessions(targetId)
  })
  tx()
}
