import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'
import { backfillRow } from '@/shared/treegrowth-rules.mjs'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'forest-fire-patrol:entries'

// 需要旧数据补全的模块：缺调查员/林分类型/调查批次时按共用规则补默认值。
const MIGRATED_KEYS = ['treegrowth']

function migrateRows(rows: Record<string, EntryRow[]>): boolean {
  let changed = false
  for (const key of MIGRATED_KEYS) {
    const list = rows[key]
    if (!list) {
      continue
    }
    rows[key] = list.map((row) => {
      const result = backfillRow(row)
      if (result.changed) {
        changed = true
      }
      return result.row as EntryRow
    })
  }
  return changed
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

function persist(rows: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
  }
}

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
    // 旧数据补全：只补缺失字段，不动样地编号；有改动就写回。
    if (migrateRows(cache)) {
      persist(cache)
    }
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  persist(next)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
