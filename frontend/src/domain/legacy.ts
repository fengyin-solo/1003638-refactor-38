import { MODULE_BY_KEY } from '../data/modules'
import type { EntryRow } from '../data/types'
import {
  LEGACY_BATCH_CODE,
  LEGACY_BATCH_LABEL,
  LEGACY_FOREST_AREA,
  LEGACY_INVESTIGATOR,
  LEGACY_STAND_TYPE,
  TREE_FIELDS,
} from './legacy-constants'

/**
 * 旧数据迁移：本地 localStorage、示例数据构建、部署检查三处共用同一份补全写法。
 * 注意：任何分支都不写「样地编号」，主键原样保留。
 */

export const CURRENT_SCHEMA_VERSION = 2

function blank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === ''
}

/**
 * 补全一条历史林木生长记录。
 * - 调查员缺失 → 标记为历史补登（调查员待核实）
 * - 林分类型缺失 → 归入「未划分林分」
 * - 调查批次缺失 → 归入统一历史批次（历史记录不再丢批次）
 * - 所属林区缺失 → 待核实林区（林带建议清单按林区关联）
 */
export function repairLegacyTreeRow(row: EntryRow): { row: EntryRow; repaired: boolean } {
  const next: EntryRow = { ...row }
  let repaired = false
  if (blank(next[TREE_FIELDS.investigator])) {
    next[TREE_FIELDS.investigator] = LEGACY_INVESTIGATOR
    repaired = true
  }
  if (blank(next[TREE_FIELDS.standType])) {
    next[TREE_FIELDS.standType] = LEGACY_STAND_TYPE
    repaired = true
  }
  if (blank(next[TREE_FIELDS.batchCode])) {
    next[TREE_FIELDS.batchCode] = `${LEGACY_BATCH_CODE}｜${LEGACY_BATCH_LABEL}`
    repaired = true
  }
  if (blank(next[TREE_FIELDS.forestArea])) {
    next[TREE_FIELDS.forestArea] = LEGACY_FOREST_AREA
    repaired = true
  }
  // 样地编号是业务主键：只校验存在，绝不在迁移中赋值或改写。
  if (blank(next[TREE_FIELDS.plotCode]) || blank(next[TREE_FIELDS.recordCode])) {
    throw new Error(`林木生长记录 id=${row.id} 缺少记录编号或样地编号，无法迁移（主键不允许生成）`)
  }
  return { row: next, repaired }
}

/** 按当前状态机规则重算 pending/abnormal，保证旧库里的标记与收拢后的规则一致。 */
export function reconcileFlags(row: EntryRow, key: string): EntryRow {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    return row
  }
  const status = String(row.status)
  const locked = key === 'treegrowth'
    ? status === '已归档'
    : status === meta.statuses[meta.statuses.length - 1]
  return { ...row, pending: !locked, abnormal: Boolean(row.abnormal) }
}

export type MigrationResult = {
  rows: Record<string, EntryRow[]>
  version: number
  repairedTreeRows: number
}

/**
 * 迁移整库数据：
 * 1. 林木生长记录逐条做旧数据补全；
 * 2. 全模块 pending 标记按共用规则重算（归档即不待处理）；
 * 3. 补齐后的数据打上当前 schema 版本，重复执行是幂等的。
 */
export function migrateAll(
  source: Record<string, EntryRow[]>,
  fromVersion = 0,
): MigrationResult {
  const rows: Record<string, EntryRow[]> = {}
  let repairedTreeRows = 0
  for (const [key, list] of Object.entries(source)) {
    if (!Array.isArray(list)) {
      continue
    }
    rows[key] = list.map((raw) => {
      let row = raw
      if (key === 'treegrowth') {
        const outcome = repairLegacyTreeRow(row)
        row = outcome.row
        if (outcome.repaired) {
          repairedTreeRows += 1
        }
      }
      if (fromVersion < CURRENT_SCHEMA_VERSION) {
        row = reconcileFlags(row, key)
      }
      return row
    })
  }
  return { rows, version: CURRENT_SCHEMA_VERSION, repairedTreeRows }
}
