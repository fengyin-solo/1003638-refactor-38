import { MODULE_BY_KEY } from '../data/modules'
import type { ActionResult, EntryRow } from '../data/types'
import {
  RemeasurePlaceholder,
  TREE_FIELDS,
} from './legacy-constants'
import {
  applyDecision,
  decideTransition,
  rejected,
  succeeded,
} from './status-rules'
import { reviewMeasurements } from './measurement'

/**
 * 林木生长工作流：录入、复核、归档三个入口共用 status-rules 的判定，
 * 本文件只承载林木生长特有的逻辑（测量值快照、并发去重、批量断点续检）。
 */

const META = MODULE_BY_KEY.get('treegrowth')!
const RUNNING_REVIEW_ERROR = '该样地复核正在进行中，请勿重复提交（并发复核只落一次）'

/** 复核失败时落入「历史测量值」的一条快照，批次随值一起存档，历史记录不再丢批次。 */
export type MeasurementSnapshot = {
  batch: string
  dbh: string
  height: string
  canopy: string
  reason: string
  at: string
}

export function parseSnapshots(raw: unknown): MeasurementSnapshot[] {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as MeasurementSnapshot[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** 行存储：由外层（localStorage / 内存自检）提供。 */
export type TreeRowStore = {
  load(): EntryRow[]
  save(rows: EntryRow[]): void
}

/** 复核落库前的最后一道闸门：并发中的复核直接拒绝，保证同一样地只落一次。 */
export class ReviewLock {
  private heldIds = new Set<number>()
  tryAcquire(id: number): boolean {
    if (this.heldIds.has(id)) {
      return false
    }
    this.heldIds.add(id)
    return true
  }
  release(id: number): void {
    this.heldIds.delete(id)
  }
}

export type WorkflowDeps = {
  now: () => string
  lock: ReviewLock
}

export type CreateInput = {
  plotCode: string
  forestArea: string
  standType: string
  avgDbh: string
  avgHeight: string
  canopy: string
  investigator: string
  batchCode: string
}

export type BatchProgress = {
  token: string
  startedAt: string
  planIds: number[]
  cursor: number
  passed: number
  failed: number
  skipped: number
  done: boolean
}

export type BatchStepEffect = {
  id: number
  recordCode: string
  outcome: 'passed' | 'failed' | 'skipped'
  reason?: string
}

export type BatchStepResult = {
  progress: BatchProgress
  effects: BatchStepEffect[]
  resumed: boolean
}

function blank(value: string): boolean {
  return value.trim() === ''
}

/** 复核失败：旧测量值带批次进历史快照，当前列清成「待补测」，杜绝旧值残留冒充新值。 */
function snapshotFailedMeasurements(row: EntryRow, reason: string, at: string): EntryRow {
  const history = parseSnapshots(row[TREE_FIELDS.history])
  history.push({
    batch: String(row[TREE_FIELDS.batchCode] ?? ''),
    dbh: String(row[TREE_FIELDS.avgDbh] ?? ''),
    height: String(row[TREE_FIELDS.avgHeight] ?? ''),
    canopy: String(row[TREE_FIELDS.canopy] ?? ''),
    reason,
    at,
  })
  return {
    ...row,
    [TREE_FIELDS.avgDbh]: RemeasurePlaceholder,
    [TREE_FIELDS.avgHeight]: RemeasurePlaceholder,
    [TREE_FIELDS.canopy]: RemeasurePlaceholder,
    [TREE_FIELDS.history]: JSON.stringify(history),
  }
}

export type RemeasureInput = {
  avgDbh: string
  avgHeight: string
  canopy: string
  investigator?: string
  batchCode?: string
}

export function createTreeWorkflow(store: TreeRowStore, deps: WorkflowDeps) {
  function persist(rows: EntryRow[]) {
    store.save(rows)
  }

  /** 登记入口：新记录一律「已录入」，样地编号必填且不允许与既有记录重复。 */
  function create(input: CreateInput): ActionResult & { id?: number } {
    if (blank(input.plotCode)) {
      return rejected('样地编号必填（样地编号一经录入不可更改）')
    }
    if (blank(input.standType)) {
      return rejected('林分类型必填')
    }
    if (blank(input.batchCode)) {
      return rejected('调查批次必填，历史记录需要按批次追溯')
    }
    const rows = store.load()
    if (rows.some((row) => String(row[TREE_FIELDS.plotCode]) === input.plotCode.trim())) {
      return rejected(`样地编号 ${input.plotCode} 已存在，登记入口不允许重复建点`)
    }
    const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
    const seq = String(id).padStart(4, '0')
    const row: EntryRow = {
      id,
      status: '已录入',
      pending: true,
      abnormal: false,
      [TREE_FIELDS.recordCode]: `TREE-${seq}`,
      [TREE_FIELDS.plotCode]: input.plotCode.trim(),
      [TREE_FIELDS.forestArea]: input.forestArea.trim(),
      [TREE_FIELDS.standType]: input.standType.trim(),
      [TREE_FIELDS.avgDbh]: input.avgDbh.trim(),
      [TREE_FIELDS.avgHeight]: input.avgHeight.trim(),
      [TREE_FIELDS.canopy]: input.canopy.trim(),
      [TREE_FIELDS.investigator]: input.investigator.trim(),
      [TREE_FIELDS.batchCode]: input.batchCode.trim(),
      [TREE_FIELDS.history]: '',
    }
    persist([...rows, row])
    return { ok: true, message: `林木生长记录 ${row[TREE_FIELDS.recordCode]} 已登记`, id }
  }

  /** 通用流转：提交审核等无附加逻辑的动作从这里走，判定与其它模块共用同一套规则。 */
  function transition(id: number, action: string): ActionResult {
    const rows = store.load()
    const row = rows.find((item) => Number(item.id) === id)
    if (!row) {
      return rejected(`没有找到编号为 ${id} 的林木生长记录`)
    }
    const decision = decideTransition(META, row, action)
    if (!decision.ok) {
      return rejected(decision.message)
    }
    const index = rows.indexOf(row)
    const list = [...rows]
    list[index] = applyDecision(row, decision)
    persist(list)
    return succeeded(`林木生长记录已${action}，当前状态「${decision.target}」`)
  }

  /**
   * 复核入口：已审核 → 复核通过=已归档；测量值越界/缺测则按「要求复核」落「需复核」，
   * 旧测量值带批次移入历史，当前列置「待补测」。
   * forceFail 供复核员人工判定失败（值看似正常但现场存疑）。
   */
  function review(id: number, forceFail = false): ActionResult {
    if (!deps.lock.tryAcquire(id)) {
      return rejected(RUNNING_REVIEW_ERROR)
    }
    try {
      const rows = store.load()
      const index = rows.findIndex((row) => Number(row.id) === id)
      if (index < 0) {
        return rejected(`没有找到编号为 ${id} 的林木生长记录`)
      }
      const row = rows[index]
      const status = String(row.status)
      if (status === '已归档') {
        return rejected('该样地已归档并锁定，复核结果不能再更改')
      }
      if (status !== '已审核') {
        return rejected(`「${status}」状态的记录不在复核范围内，请先提交审核`)
      }
      const outcome = forceFail
        ? { passed: false, reason: '复核员人工判定测量值不可信' }
        : reviewMeasurements(row)
      const action = outcome.passed ? '复核通过' : '要求复核'
      const decision = decideTransition(META, row, action)
      if (!decision.ok) {
        return rejected(decision.message)
      }
      let next = applyDecision(row, decision)
      if (!outcome.passed) {
        next = snapshotFailedMeasurements(next, outcome.reason, deps.now())
      }
      const list = [...rows]
      list[index] = next
      persist(list)
      return outcome.passed
        ? succeeded(`复核通过，样地已归档：${String(row[TREE_FIELDS.plotCode])}`)
        : rejected(`复核未通过：${outcome.reason}；旧测量值已转入历史，请重新外业测量`)
    } finally {
      // 同步落库完成即释放；重入/并发调用在 tryAcquire 处已被挡下，整条流程只会落一次。
      deps.lock.release(id)
    }
  }

  /** 复核员人工要求复核（即使数值在区间内也可打回）。 */
  function requestRecheck(id: number): ActionResult {
    return review(id, true)
  }

  /** 录入入口（重新测量）：需复核 → 已录入；写入新值，批次默认沿用原批次。 */
  function remeasure(id: number, input: RemeasureInput): ActionResult {
    const rows = store.load()
    const index = rows.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      return rejected(`没有找到编号为 ${id} 的林木生长记录`)
    }
    const decision = decideTransition(META, rows[index], '重新测量')
    if (!decision.ok) {
      return rejected(decision.message)
    }
    let next = applyDecision(rows[index], decision)
    next = {
      ...next,
      [TREE_FIELDS.avgDbh]: input.avgDbh.trim(),
      [TREE_FIELDS.avgHeight]: input.avgHeight.trim(),
      [TREE_FIELDS.canopy]: input.canopy.trim(),
      [TREE_FIELDS.investigator]: input.investigator?.trim() || String(next[TREE_FIELDS.investigator] ?? ''),
      [TREE_FIELDS.batchCode]: input.batchCode?.trim() || String(next[TREE_FIELDS.batchCode] ?? ''),
    }
    const list = [...rows]
    list[index] = next
    persist(list)
    return succeeded('重新测量值已录入，记录回到「已录入」，请提交审核')
  }

  /** 归档入口：只接受复核通过的归档，规则与 review 完全一致，避免第二套判断。 */
  function archive(id: number): ActionResult {
    return review(id, false)
  }

  return {
    create,
    transition,
    review,
    requestRecheck,
    remeasure,
    archive,
    store,
  }
}

export class WorkflowError extends Error {}

/**
 * 批量复核（断点续检）：
 * - 开始时把当时全部「已审核」样地固化为执行计划，逐行落 checkpoint；
 * - 中断（关闭页面 / 主动终止）后再次调用 runBatchStep 自动从游标继续，已处理样地不重复复核；
 * - 同时兜底重扫「已审核但不在计划里」的新样地，保证从缺失样地继续而不漏检；
 * - 整批进行中拒绝再起一批（并发复核只落一次）。
 */
export type CheckpointStore = {
  load(): BatchProgress | null
  save(progress: BatchProgress): void
  clear(): void
}

export function runBatchStep(
  workflow: ReturnType<typeof createTreeWorkflow>,
  checkpoint: CheckpointStore,
  deps: { now: () => string; genToken: () => string; lock: ReviewLock; batchHeld: () => boolean; holdBatch: () => void; releaseBatch: () => void },
  limit = 25,
): BatchStepResult {
  const resumed = checkpoint.load() !== null && !checkpoint.load()!.done
  const progress = ensurePlan(workflow, checkpoint, deps)
  const effects: BatchStepEffect[] = []

  while (effects.length < limit) {
    // 每处理一条就持久化游标：无论在哪一行中断，重启都从下一条缺失样地继续。
    if (progress.cursor >= progress.planIds.length) {
      progress.done = true
      break
    }
    const id = progress.planIds[progress.cursor]
    // 每条都重新读取：上一条复核已落库，避免用步骤开始时的旧快照判断后续样地。
    const row = workflow.store.load().find((item) => Number(item.id) === id)
    progress.cursor += 1
    if (!row) {
      progress.skipped += 1
      effects.push({ id, recordCode: `#${id}`, outcome: 'skipped', reason: '记录已不存在' })
    } else if (String(row.status) !== '已审核') {
      progress.skipped += 1
      effects.push({
        id,
        recordCode: String(row[TREE_FIELDS.recordCode] ?? id),
        outcome: 'skipped',
        reason: `当前状态「${row.status}」不在批量复核范围`,
      })
    } else {
      const result = workflow.review(id, false)
      const after = workflow.store.load().find((item) => Number(item.id) === id)
      const recordCode = String(row[TREE_FIELDS.recordCode] ?? id)
      if (result.ok && after && String(after.status) === '已归档') {
        progress.passed += 1
        effects.push({ id, recordCode, outcome: 'passed' })
      } else if (after && String(after.status) === '需复核') {
        progress.failed += 1
        const snapshots = parseSnapshots(after[TREE_FIELDS.history])
        effects.push({
          id,
          recordCode,
          outcome: 'failed',
          reason: snapshots[snapshots.length - 1]?.reason ?? '测量值未通过复核',
        })
      } else {
        // 被并发锁挡下等情况：游标不前进式回退，下一轮重试这一条，保证不漏。
        progress.cursor -= 1
        effects.push({ id, recordCode, outcome: 'skipped', reason: result.message })
        break
      }
    }
    checkpoint.save(progress)
  }

  if (progress.done) {
    checkpoint.save(progress)
    deps.releaseBatch()
  }
  return { progress: { ...progress }, effects, resumed }
}

function ensurePlan(
  workflow: ReturnType<typeof createTreeWorkflow>,
  checkpoint: CheckpointStore,
  deps: { now: () => string; genToken: () => string; lock: ReviewLock; batchHeld: () => boolean; holdBatch: () => void; releaseBatch: () => void },
): BatchProgress {
  const existing = checkpoint.load()
  if (existing && !existing.done) {
    // 断点续检：沿用旧计划，同时把中断期间新出现、尚未入计划的已审核样地补进来。
    const planned = new Set(existing.planIds)
    const missing = workflow
      .store
      .load()
      .filter((row) => String(row.status) === '已审核' && !planned.has(Number(row.id)))
      .map((row) => Number(row.id))
      .sort((a, b) => a - b)
    const merged: BatchProgress = {
      ...existing,
      planIds: [...existing.planIds, ...missing],
    }
    checkpoint.save(merged)
    return merged
  }
  if (existing?.done) {
    checkpoint.clear()
  }
  if (deps.batchHeld()) {
    throw new WorkflowError('已有一批复核正在进行，请等待当前批次结束')
  }
  deps.holdBatch()
  const planIds = workflow
    .store
    .load()
    .filter((row) => String(row.status) === '已审核')
    .map((row) => Number(row.id))
    .sort((a, b) => a - b)
  const fresh: BatchProgress = {
    token: deps.genToken(),
    startedAt: deps.now(),
    planIds,
    cursor: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    done: false,
  }
  checkpoint.save(fresh)
  return fresh
}

export { RUNNING_REVIEW_ERROR }
