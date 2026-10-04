import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  BeltSuggestion,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'
import {
  HISTORY_KEY,
  applyReview,
  applyTransition,
  availableActions,
  buildBeltSuggestions,
  buildEntry,
} from '@/shared/treegrowth-rules.mjs'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/** 某条记录当前可执行的动作：统一问共用状态规则，页面不再各自判断。 */
export function rowActions(key: string, row: EntryRow): string[] {
  return availableActions(moduleMeta(key), row)
}

/** 历史条目落库：id 递增，其余字段（含调查批次）由共用引擎生成。 */
function appendHistory(history: Record<string, unknown>): void {
  const rows = listRows(HISTORY_KEY)
  const id = Math.max(0, ...rows.map((row) => Number(row.id) || 0)) + 1
  saveRows(HISTORY_KEY, [...rows, { ...history, id } as EntryRow])
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const result = applyTransition(meta, rows[index], action)
  if (!result.ok || !result.row) {
    return { ok: false, message: result.message }
  }
  const next = [...rows]
  next[index] = result.row as EntryRow
  saveRows(key, next)
  if (result.history) {
    appendHistory(result.history)
  }
  return { ok: true, message: result.message }
}

/** 录入入口：登记一条林木生长记录，状态从「已录入」起步。 */
export function createTreegrowthEntry(input: Record<string, string>): ActionResult {
  const meta = moduleMeta('treegrowth')
  const rows = listRows('treegrowth')
  const result = buildEntry(meta, input, rows)
  if (!result.ok || !result.row) {
    return { ok: false, message: result.message }
  }
  saveRows('treegrowth', [...rows, result.row as EntryRow])
  if (result.history) {
    appendHistory(result.history)
  }
  return { ok: true, message: result.message }
}

/**
 * 复核入口：并发只落一次。
 * 只有「需复核」状态能落复核结果；并发或重复提交时状态已变，
 * 共用引擎直接拒绝，第二次调用不会重复写状态和历史。
 */
export function reviewTreegrowth(
  id: number,
  payload: { pass: boolean; measures?: Record<string, string> },
): ActionResult {
  const meta = moduleMeta('treegrowth')
  const rows = listRows('treegrowth')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const result = applyReview(meta, rows[index], payload)
  if (!result.ok || !result.row) {
    return { ok: false, message: result.message }
  }
  const next = [...rows]
  next[index] = result.row as EntryRow
  saveRows('treegrowth', next)
  if (result.history) {
    appendHistory(result.history)
  }
  return { ok: true, message: result.message }
}

/** 流转历史：可按记录编号过滤，每条都带调查批次。 */
export function listTreegrowthHistory(recordNo?: string): EntryRow[] {
  const rows = listRows(HISTORY_KEY)
  if (!recordNo) {
    return rows
  }
  return rows.filter((row) => String(row['记录编号']) === recordNo)
}

/** 林带建议清单：其余模块同步使用林木生长的复核结果。 */
export function listBeltSuggestions(): BeltSuggestion[] {
  return buildBeltSuggestions(listRows('treegrowth'), listRows(HISTORY_KEY))
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
