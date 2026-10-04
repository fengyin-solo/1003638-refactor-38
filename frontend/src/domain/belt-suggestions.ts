import type { BeltSuggestion, EntryRow } from '../data/types'
import { LOW_CANOPY_THRESHOLD, TREE_FIELDS } from './legacy-constants'
import { parseSnapshots } from './treegrowth'
import { readCanopy } from './measurement'

/**
 * 林带建议清单：防火林带等模块只展示从林木生长复核结果推导出的建议，
 * 不自己再判断测量值。复核失败与归档低郁闭度两类结果会实时同步到清单。
 */

export type BeltRowSource = {
  beltCode: string
  forestArea: string
  status: string
}

/** 样地林区 → 该林区现有林带编号的映射；同林区多条时全部列出。 */
export function indexBeltsByArea(rows: EntryRow[]): Map<string, BeltRowSource[]> {
  const map = new Map<string, BeltRowSource[]>()
  for (const row of rows) {
    const area = String(row['所属林区'] ?? '').trim()
    if (!area) {
      continue
    }
    const list = map.get(area) ?? []
    list.push({
      beltCode: String(row['林带编号'] ?? ''),
      forestArea: area,
      status: String(row.status ?? ''),
    })
    map.set(area, list)
  }
  return map
}

function matchBelts(index: Map<string, BeltRowSource[]>, area: string): BeltRowSource[] {
  return index.get(area) ?? []
}

/**
 * 依据复核结果生成建议：
 * - 需复核（复核失败）：最近一次历史快照即失败原因，建议重点核查、补植；
 * - 已归档：测量值已锁定，郁闭度低于阈值的样地建议跟踪补植。
 */
export function buildBeltSuggestions(
  treeRows: EntryRow[],
  beltIndex: Map<string, BeltRowSource[]>,
): BeltSuggestion[] {
  const suggestions: BeltSuggestion[] = []
  for (const row of treeRows) {
    const status = String(row.status)
    const area = String(row[TREE_FIELDS.forestArea] ?? '').trim()
    const recordCode = String(row[TREE_FIELDS.recordCode] ?? '')
    const plotCode = String(row[TREE_FIELDS.plotCode] ?? '')
    const belts = matchBelts(beltIndex, area)
    const beltCodes = belts.map((belt) => belt.beltCode).filter(Boolean)
    const beltText = beltCodes.length > 0 ? beltCodes.join('、') : '暂无同林区林带档案'

    if (status === '需复核') {
      const snapshots = parseSnapshots(row[TREE_FIELDS.history])
      const last = snapshots[snapshots.length - 1]
      suggestions.push({
        recordCode,
        plotCode,
        forestArea: area,
        beltCode: beltText,
        kind: '复核失败-重点核查',
        reason: last
          ? `${last.batch} 批次复核未通过（${last.reason}），旧值已入历史，林带建议重点核查补植`
          : '复核未通过，林带建议重点核查补植',
      })
      continue
    }

    if (status === '已归档') {
      const canopy = readCanopy(row)
      if (canopy !== null && canopy < LOW_CANOPY_THRESHOLD) {
        suggestions.push({
          recordCode,
          plotCode,
          forestArea: area,
          beltCode: beltText,
          kind: '归档-跟踪补植',
          reason: `样地已归档且郁闭度 ${canopy} 低于 ${LOW_CANOPY_THRESHOLD}，建议对同林区林带跟踪补植`,
        })
      }
    }
  }
  // 复核失败优先处理，其次按记录编号排序，保证各模块看到的清单顺序一致。
  return suggestions.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === '复核失败-重点核查' ? -1 : 1
    }
    return a.recordCode.localeCompare(b.recordCode)
  })
}
