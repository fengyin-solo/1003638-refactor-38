import { MEASURE_LIMITS, RemeasurePlaceholder, TREE_FIELDS } from './legacy-constants'
import type { EntryRow, ReviewOutcome } from '../data/types'

/** 解析数值测量列；无法解析为数字时返回 NaN（复核直接判失败）。 */
export function parseMeasure(value: unknown): number {
  if (typeof value === 'number') {
    return value
  }
  if (typeof value !== 'string' || value.trim() === '' || value.includes(RemeasurePlaceholder)) {
    return Number.NaN
  }
  return Number(value)
}

function within(value: number, range: { min: number; max: number }): boolean {
  return Number.isFinite(value) && value >= range.min && value <= range.max
}

/**
 * 复核一条林木生长记录的测量值是否可信。
 * 平均胸径（cm）/平均树高（m）/郁闭度（0~1）任一越界或缺测都判失败。
 */
export function reviewMeasurements(row: EntryRow): ReviewOutcome {
  const checks: { label: string; value: number; range: { min: number; max: number } }[] = [
    { label: '平均胸径', value: parseMeasure(row[TREE_FIELDS.avgDbh]), range: MEASURE_LIMITS.dbh },
    { label: '平均树高', value: parseMeasure(row[TREE_FIELDS.avgHeight]), range: MEASURE_LIMITS.height },
    { label: '郁闭度', value: parseMeasure(row[TREE_FIELDS.canopy]), range: MEASURE_LIMITS.canopy },
  ]
  for (const check of checks) {
    if (!Number.isFinite(check.value)) {
      return { passed: false, reason: `${check.label}缺失或不是数值，需要重新外业测量` }
    }
    if (!within(check.value, check.range)) {
      return {
        passed: false,
        reason: `${check.label}=${check.value} 超出合理区间 ${check.range.min}~${check.range.max}`,
      }
    }
  }
  return { passed: true, reason: '' }
}

/** 郁闭度（用于归档样地的低郁闭度林带建议）；解析不了返回 null。 */
export function readCanopy(row: EntryRow): number | null {
  const value = parseMeasure(row[TREE_FIELDS.canopy])
  return Number.isFinite(value) ? value : null
}
