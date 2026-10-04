import { SEED_ENVELOPE } from './seed'
import { SEED_STORAGE_VERSION_KEY } from './seed-meta'
import { CURRENT_SCHEMA_VERSION, migrateAll } from '../domain/legacy'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'forest-fire-patrol:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  return window.localStorage
}

type LoadedData = {
  rows: Record<string, EntryRow[]>
  /** 本次加载是否对旧库做过迁移；为 true 时调用方应立刻落盘。 */
  migrated: boolean
}

function readStorage(): LoadedData {
  const fallback = { rows: clone(SEED_ENVELOPE.rows), migrated: false }
  const storage = getStorage()
  if (!storage) {
    return fallback
  }
  const raw = storage.getItem(STORAGE_KEY)
  if (!raw) {
    // 首次打开：直接播种当前版本的示例数据。
    storage.setItem(STORAGE_KEY, JSON.stringify(fallback.rows))
    storage.setItem(SEED_STORAGE_VERSION_KEY, String(CURRENT_SCHEMA_VERSION))
    return fallback
  }
  let parsed: Record<string, EntryRow[]>
  try {
    parsed = JSON.parse(raw) as Record<string, EntryRow[]>
  } catch {
    storage.setItem(STORAGE_KEY, JSON.stringify(fallback.rows))
    return fallback
  }
  // 旧库可能缺新版本才有的模块键，用种子数据兜底补齐，但浏览器里的改动优先。
  const version = Number(storage.getItem(SEED_STORAGE_VERSION_KEY) ?? 1)
  const merged: Record<string, EntryRow[]> = { ...clone(SEED_ENVELOPE.rows), ...clone(parsed) }
  const outcome = migrateAll(merged, version)
  if (version < outcome.version) {
    // 旧数据补全/规则收拢后的迁移结果立即落盘，之后重复加载是幂等无操作。
    storage.setItem(STORAGE_KEY, JSON.stringify(outcome.rows))
    storage.setItem(SEED_STORAGE_VERSION_KEY, String(outcome.version))
  }
  return { rows: outcome.rows, migrated: version < outcome.version }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage().rows
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  const storage = getStorage()
  if (storage) {
    storage.setItem(STORAGE_KEY, JSON.stringify(next))
    storage.setItem(SEED_STORAGE_VERSION_KEY, String(CURRENT_SCHEMA_VERSION))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ENVELOPE.rows[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
