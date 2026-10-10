import type { LocationQuery } from 'vue-router'

/** 只读取 URL 中已生效的筛选，供列表、汇总、导出和打印共用。 */
export function expenseFiltersFromQuery(query: LocationQuery): Record<string, string> {
  const params: Record<string, string> = {}
  const fields = {
    shop: 'shop_id', category: 'category_id',
    bm_from: 'bill_month_from', bm_to: 'bill_month_to',
    pd_from: 'paid_date_from', pd_to: 'paid_date_to', kw: 'keyword',
  }
  for (const [source, target] of Object.entries(fields)) {
    const value = query[source]
    if (typeof value === 'string' && value && !(source === 'shop' && value === 'all')) params[target] = value
  }
  return params
}
