import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, BeltSuggestion, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'
import { applyDecision, decideTransition, rejected, succeeded } from '@/domain/status-rules'
import { buildBeltSuggestions, indexBeltsByArea } from '@/domain/belt-suggestions'

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

/**
 * 通用动作入口：状态能不能流转全部交给共用状态机 decideTransition，
 * 页面不再做任何业务判断。林木生长的复核/重新测量走专用服务（带测量值处理）。
 */
export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return rejected(`没有找到编号为 ${id} 的${meta.entity}`)
  }
  const decision = decideTransition(meta, rows[index], action)
  if (!decision.ok) {
    return decision
  }
  const next = [...rows]
  next[index] = applyDecision(rows[index], decision)
  saveRows(key, next)
  return succeeded(`${meta.entity}已${action}，当前状态「${decision.target}」`)
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
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
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

/**
 * 林带建议清单：其它模块（防火林带页、概览页）统一从这里取，
 * 建议内容完全由林木生长的复核结果推导，不另起一套判断。
 */
export function listBeltSuggestions(): BeltSuggestion[] {
  const treeRows = listRows('treegrowth')
  const beltRows = listRows('firebelt')
  return buildBeltSuggestions(treeRows, indexBeltsByArea(beltRows))
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
