import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'
import {
  createTreeWorkflow,
  ReviewLock,
  runBatchStep,
  type BatchStepResult,
  type CheckpointStore,
  type CreateInput,
  type RemeasureInput,
} from '@/domain/treegrowth'

/**
 * 林木生长服务：录入、复核、归档三个入口的页面调用都收敛到这里，
 * 底层状态判定与其它模块共用 domain/status-rules。
 */

const CHECKPOINT_KEY = 'forest-fire-patrol:treegrowth-batch'
const REVIEW_LOCK = new ReviewLock()

// 整批复核的内存互斥：本标签页内同时只能有一批在跑。
let batchHeld = false

const store = {
  load: () => listRows('treegrowth'),
  save: (rows: EntryRow[]) => saveRows('treegrowth', rows),
}

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function getWorkflow() {
  return createTreeWorkflow(store, { now: nowText, lock: REVIEW_LOCK })
}

export function createTreeEntry(input: CreateInput): ActionResult & { id?: number } {
  return getWorkflow().create(input)
}

export function remeasureTreeEntry(id: number, input: RemeasureInput): ActionResult {
  return getWorkflow().remeasure(id, input)
}

export function reviewTreeEntry(id: number, forceFail = false): ActionResult {
  // 每次重新取 workflow，保证读到最新 localStorage；锁是共享单例，并发重入仍只落一次。
  return getWorkflow().review(id, forceFail)
}

export function transitionTreeEntry(id: number, action: string): ActionResult {
  return getWorkflow().transition(id, action)
}

export function archiveTreeEntry(id: number): ActionResult {
  return getWorkflow().archive(id)
}

/** 当前默认调查批次：按「年-月」给出，录入表单预填。 */
export function defaultBatchCode(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
}

const localStorageCheckpoint: CheckpointStore = {
  load() {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null
    }
    const raw = window.localStorage.getItem(CHECKPOINT_KEY)
    if (!raw) {
      return null
    }
    try {
      return JSON.parse(raw) as ReturnType<CheckpointStore['load']>
    } catch {
      return null
    }
  },
  save(progress) {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(progress))
    }
  },
  clear() {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(CHECKPOINT_KEY)
    }
  },
}

/**
 * 跑一步批量复核（默认每步 25 条，页面可逐步调用避免长任务卡顿）。
 * 中断后再次调用会自动从 checkpoint 的缺失样地继续。
 */
export function runReviewBatchStep(limit = 25): BatchStepResult {
  const deps = {
    now: nowText,
    genToken: () => `BATCH-${Date.now()}`,
    lock: REVIEW_LOCK,
    batchHeld: () => batchHeld,
    holdBatch: () => {
      if (batchHeld) {
        throw new Error('已有一批复核正在进行，请等待当前批次结束')
      }
      batchHeld = true
    },
    releaseBatch: () => {
      batchHeld = false
    },
  }
  try {
    return runBatchStep(getWorkflow(), localStorageCheckpoint, deps, limit)
  } catch (error) {
    // 批次正常结束会释放锁；异常时也释放，避免一次报错后再也起不了批。
    if (error instanceof Error && error.message.includes('正在进行')) {
      throw error
    }
    batchHeld = false
    throw error
  }
}

export function getBatchProgress(): ReturnType<CheckpointStore['load']> {
  return localStorageCheckpoint.load()
}

export function clearBatchProgress(): void {
  localStorageCheckpoint.clear()
  batchHeld = false
}
