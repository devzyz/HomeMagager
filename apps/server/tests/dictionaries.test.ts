import { afterEach, describe, expect, it } from 'vitest'
import { authHeaders, cleanup, createTestApp, insertUser, login, type SessionRef, type TestCtx } from './helpers.js'

let ctx: TestCtx
afterEach(() => {
  if (ctx) cleanup(ctx)
})

describe('shops & categories', () => {
  async function setup(): Promise<SessionRef> {
    ctx = await createTestApp()
    const alice = await insertUser(ctx.db, { username: 'alice', password: 'password-123456' })
    return login(ctx, alice.username, alice.password)
  }

  it('初始 8 个类别已通过迁移插入', async () => {
    const s = await setup()
    const res = await ctx.app.inject({ method: 'GET', url: '/api/categories', headers: authHeaders(s) })
    expect(res.statusCode).toBe(200)
    const names = res.json().items.map((i: { name: string }) => i.name)
    expect(names).toEqual(['水费', '电费', '房租', '物业费', '燃气费', '网络费', '维修费', '其他'])
  })

  it('店铺：新增、重名拒绝、改名、启停、排序', async () => {
    const s = await setup()
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/shops',
      headers: authHeaders(s),
      payload: { name: '  东门小店  ' },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().item).toMatchObject({ name: '东门小店', is_active: true, sort_order: 1 })
    const id = created.json().item.id

    const dupe = await ctx.app.inject({
      method: 'POST',
      url: '/api/shops',
      headers: authHeaders(s),
      payload: { name: '东门小店' },
    })
    expect(dupe.statusCode).toBe(400)
    expect(dupe.json().code).toBe('NAME_TAKEN')

    await ctx.app.inject({ method: 'POST', url: '/api/shops', headers: authHeaders(s), payload: { name: '西门小店' } })
    await ctx.app.inject({ method: 'POST', url: '/api/shops', headers: authHeaders(s), payload: { name: '北门小店' } })

    const rename = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/shops/${id}`,
      headers: authHeaders(s),
      payload: { name: '东门总店' },
    })
    expect(rename.statusCode).toBe(200)

    const deactivate = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/shops/${id}/active`,
      headers: authHeaders(s),
      payload: { is_active: false },
    })
    expect(deactivate.statusCode).toBe(200)
    let list = await ctx.app.inject({ method: 'GET', url: '/api/shops', headers: authHeaders(s) })
    expect(list.json().items.find((i: { id: string }) => i.id === id).is_active).toBe(false)

    // 排序：把东门总店排到最前
    const items = list.json().items as { id: string }[]
    const reordered = [...items].reverse().map((i) => i.id)
    const sortRes = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/shops/sort',
      headers: authHeaders(s),
      payload: { ids: reordered },
    })
    expect(sortRes.statusCode).toBe(200)
    list = await ctx.app.inject({ method: 'GET', url: '/api/shops', headers: authHeaders(s) })
    expect(list.json().items[0].id).toBe(reordered[0])
  })

  it('名称长度校验', async () => {
    const s = await setup()
    const empty = await ctx.app.inject({
      method: 'POST',
      url: '/api/shops',
      headers: authHeaders(s),
      payload: { name: '   ' },
    })
    expect(empty.statusCode).toBe(400)
    const tooLong = await ctx.app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: authHeaders(s),
      payload: { name: '长'.repeat(51) },
    })
    expect(tooLong.statusCode).toBe(400)
  })

  it('未登录访问被拒', async () => {
    await setup()
    const res = await ctx.app.inject({ method: 'GET', url: '/api/shops' })
    expect(res.statusCode).toBe(401)
  })

  it('停用店铺不出现在默认过滤选项，但列表仍返回（带标记）', async () => {
    const s = await setup()
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/shops',
      headers: authHeaders(s),
      payload: { name: '老店' },
    })
    const id = created.json().item.id
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/shops/${id}/active`,
      headers: authHeaders(s),
      payload: { is_active: false },
    })
    const list = await ctx.app.inject({ method: 'GET', url: '/api/shops', headers: authHeaders(s) })
    const item = list.json().items.find((i: { id: string }) => i.id === id)
    expect(item).toBeTruthy()
    expect(item.is_active).toBe(false)
  })
})
