import ExcelJS from 'exceljs'
import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import { parseWith } from '../../lib/validate.js'
import { badRequest } from '../../lib/errors.js'
import { requireAuth } from '../../plugins/hooks.js'
import { parseExpenseFilter } from '../expenses/filter.js'
import { listExpenses } from '../expenses/service.js'
import { summarize, describeFilter } from './shared.js'

const PRINT_MAX_ITEMS = 1000
const EXCEL_MAX_ITEMS = 10000

const ReportQuery = Type.Object({
  shop_id: Type.Optional(Type.String()),
  category_id: Type.Optional(Type.String()),
  bill_month_from: Type.Optional(Type.String()),
  bill_month_to: Type.Optional(Type.String()),
  paid_date_from: Type.Optional(Type.String()),
  paid_date_to: Type.Optional(Type.String()),
  keyword: Type.Optional(Type.String()),
})

class Mutex {
  private locked = false
  private queue: (() => void)[] = []

  tryAcquire(): boolean {
    if (this.locked) return false
    this.locked = true
    return true
  }

  release(): void {
    this.locked = false
    const next = this.queue.shift()
    if (next) next()
  }
}

export function registerReportRoutes(app: FastifyInstance): void {
  const excelMutex = new Mutex()

  const shopLabel = (shopId: string | undefined): string => {
    if (!shopId) return '全部店铺'
    const s = app.db.prepare('SELECT name FROM shops WHERE id = ?').get(shopId) as { name: string } | undefined
    return s?.name ?? '指定店铺'
  }

  const summaryPayload = (shopId: string | undefined, filter: ReturnType<typeof parseExpenseFilter>) => {
    const s = summarize(app.db, filter)
    return {
      filter: {
        shop_id: shopId ?? null,
        ...filter,
      },
      filter_description: describeFilter(filter, shopLabel(shopId)),
      stat_basis: '按账单月份统计（bill_month）',
      total_count: s.totalCount,
      total_amount_cents: s.totalCents,
      categories: s.categories,
    }
  }

  app.get('/api/reports', { preHandler: requireAuth }, async (req) => {
    parseWith(ReportQuery, req.query)
    const filter = parseExpenseFilter(req.query as Record<string, unknown>)
    return summaryPayload(filter.shopId, filter)
  })

  app.get('/api/reports/print-data', { preHandler: requireAuth }, async (req) => {
    parseWith(ReportQuery, req.query)
    const filter = parseExpenseFilter(req.query as Record<string, unknown>)
    const r = listExpenses(app.db, filter, 1, PRINT_MAX_ITEMS)
    if (r.total > PRINT_MAX_ITEMS) {
      throw badRequest(`打印最多支持 ${PRINT_MAX_ITEMS} 条明细，当前筛选共 ${r.total} 条，请缩小范围`, 'EXPORT_LIMIT')
    }
    return {
      ...summaryPayload(filter.shopId, filter),
      items: r.items.map((e) => ({
        id: e.id,
        paid_date: e.paid_date,
        shop_name: e.shop_name,
        category_name: e.category_name,
        amount_cents: e.amount_cents,
        bill_month: e.bill_month,
        remark: e.remark,
      })),
      items_truncated: false,
    }
  })

  app.get('/api/reports/excel', { preHandler: requireAuth }, async (req, reply) => {
    parseWith(ReportQuery, req.query)
    const filter = parseExpenseFilter(req.query as Record<string, unknown>)

    if (!excelMutex.tryAcquire()) {
      throw badRequest('已有 Excel 导出任务进行中，请稍后再试', 'EXPORT_BUSY')
    }

    try {
      const r = listExpenses(app.db, filter, 1, EXCEL_MAX_ITEMS)
      if (r.total > EXCEL_MAX_ITEMS) {
        throw badRequest(`Excel 导出最多支持 ${EXCEL_MAX_ITEMS} 条明细，当前筛选共 ${r.total} 条，请缩小范围`, 'EXPORT_LIMIT')
      }
      const summary = summaryPayload(filter.shopId, filter)

      // 说明：规格要求流式写出，但 exceljs 4.4.0 的 stream 写入器在 Node 24 下
      // 会产出 workbook.xml/styles 为空的损坏文件（已实测确认）。
      // 改为内存构建：明细行数硬上限 10000，内存占用有界（约几 MB），并保持全站单任务。
      const workbook = new ExcelJS.Workbook()
      const moneyFmt = '"¥"#,##0.00'

      // Sheet1 费用明细
      const detailSheet = workbook.addWorksheet('费用明细')
      detailSheet.columns = [{ width: 12 }, { width: 18 }, { width: 12 }, { width: 14 }, { width: 12 }, { width: 40 }]
      const header = detailSheet.addRow(['缴费日期', '店铺', '类别', '金额（元）', '账单月份', '备注'])
      header.font = { bold: true }
      for (const e of r.items) {
        detailSheet.addRow([
          e.paid_date,
          e.shop_name ?? '',
          e.category_name ?? '',
          e.amount_cents / 100,
          e.bill_month,
          e.remark ?? '',
        ]).getCell(4).numFmt = moneyFmt
      }
      const detailTotal = detailSheet.addRow(['合计', `${r.total} 笔`, '', r.totalAmountCents / 100, '', ''])
      detailTotal.font = { bold: true }
      detailTotal.getCell(4).numFmt = moneyFmt

      // Sheet2 分类汇总
      const catSheet = workbook.addWorksheet('分类汇总')
      catSheet.columns = [{ width: 16 }, { width: 10 }, { width: 16 }]
      const catHeader = catSheet.addRow(['类别', '笔数', '金额（元）'])
      catHeader.font = { bold: true }
      for (const c of summary.categories) {
        catSheet.addRow([c.name, c.count, c.total_cents / 100]).getCell(3).numFmt = moneyFmt
      }
      const catTotal = catSheet.addRow(['总计', summary.total_count, summary.total_amount_cents / 100])
      catTotal.font = { bold: true }
      catTotal.getCell(3).numFmt = moneyFmt

      // 说明页签（筛选条件与统计口径）
      const infoSheet = workbook.addWorksheet('说明')
      infoSheet.columns = [{ width: 12 }, { width: 80 }]
      infoSheet.addRow(['筛选条件', summary.filter_description])
      infoSheet.addRow(['统计口径', summary.stat_basis])
      infoSheet.addRow(['导出时间', new Date().toISOString()])
      infoSheet.addRow(['应用版本', 'v1-dev'])

      const fileBuffer = Buffer.from(await workbook.xlsx.writeBuffer())

      const monthLabel =
        filter.billMonthFrom || filter.billMonthTo
          ? `${filter.billMonthFrom ?? '始'}${filter.billMonthFrom !== filter.billMonthTo ? `至${filter.billMonthTo ?? '终'}` : ''}`
          : '全部月份'
      const filename = `${shopLabel(filter.shopId)}-${monthLabel}-费用报表.xlsx`
      const encoded = encodeURIComponent(filename)

      void reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="expense-report.xlsx"; filename*=UTF-8''${encoded}`)
        .header('Cache-Control', 'private, no-store')
      return await reply.send(fileBuffer)
    } finally {
      excelMutex.release()
    }
  })
}
