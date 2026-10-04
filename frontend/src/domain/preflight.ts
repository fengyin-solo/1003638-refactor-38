/**
 * 上线前检查：本地开发环境启动、部署检查脚本共用这一份。
 * 校验模块元数据、示例数据完整性（含旧数据补全是否生效、样地编号是否被改写），
 * 以及林木生长状态机/复核/并发/批量续检的关键规则。
 */
import { MODULES, MODULE_BY_KEY } from '../data/modules'
import { CURRENT_SCHEMA_VERSION, migrateAll, repairLegacyTreeRow } from './legacy'
import {
  LEGACY_BATCH_CODE,
  LEGACY_INVESTIGATOR,
  LEGACY_STAND_TYPE,
  RemeasurePlaceholder,
  TREE_FIELDS,
} from './legacy-constants'
import { reviewMeasurements } from './measurement'
import {
  createTreeWorkflow,
  ReviewLock,
  runBatchStep,
  type CheckpointStore,
} from './treegrowth'
import { buildBeltSuggestions, indexBeltsByArea } from './belt-suggestions'
import { decideTransition } from './status-rules'
import type { EntryRow } from '../data/types'

export type CheckIssue = { level: 'error' | 'warn'; message: string }

function memoryStore(initial: EntryRow[]) {
  let rows = initial
  return {
    load: () => rows,
    save: (next: EntryRow[]) => {
      rows = next
    },
  }
}

function memoryCheckpoint(initial: ReturnType<CheckpointStore['load']> | null = null): CheckpointStore & {
  current(): ReturnType<CheckpointStore['load']>
} {
  let value = initial ? { ...initial } : null
  return {
    load: () => (value ? { ...value, planIds: [...value.planIds] } : null),
    save: (progress) => {
      value = { ...progress, planIds: [...progress.planIds] }
    },
    clear: () => {
      value = null
    },
    current: () => value,
  }
}

function newWorkflow(rows: EntryRow[]) {
  return createTreeWorkflow(memoryStore(rows.map((row) => ({ ...row }))), {
    now: () => '2026-10-01 09:00',
    lock: new ReviewLock(),
  })
}

const TREE_META = MODULE_BY_KEY.get('treegrowth')!

export function validateMeta(issues: CheckIssue[]): void {
  for (const meta of MODULES) {
    for (const action of meta.actions) {
      if (!meta.actionTargets[action]) {
        issues.push({ level: 'error', message: `模块 ${meta.key} 的动作「${action}」没有流转目标` })
      }
    }
    for (const target of Object.values(meta.actionTargets)) {
      if (!meta.statuses.includes(target)) {
        issues.push({ level: 'error', message: `模块 ${meta.key} 的流转目标「${target}」不在状态列表里` })
      }
    }
  }
  // 林木生长：已归档不得出现在任何显式白名单的源状态中（归档样地不可改）。
  const sources = Object.keys(TREE_META.transitions ?? {})
  if (sources.includes('已归档')) {
    issues.push({ level: 'error', message: '林木生长状态机白名单包含「已归档」源状态，归档样地仍可能被改' })
  }
}

export function validateSeed(envelope: { version: number; rows: Record<string, EntryRow[]> }, issues: CheckIssue[]): void {
  if (envelope.version !== CURRENT_SCHEMA_VERSION) {
    issues.push({ level: 'error', message: `示例数据版本 ${envelope.version} 与当前 schema ${CURRENT_SCHEMA_VERSION} 不一致，请执行 npm run seed:build` })
  }
  for (const meta of MODULES) {
    const list = envelope.rows[meta.key]
    if (!Array.isArray(list) || list.length === 0) {
      issues.push({ level: 'error', message: `模块 ${meta.key} 缺少示例数据` })
      continue
    }
    for (const row of list) {
      if (!meta.statuses.includes(String(row.status))) {
        issues.push({ level: 'error', message: `模块 ${meta.key} id=${row.id} 的状态「${row.status}」非法` })
      }
    }
  }
  const trees = envelope.rows.treegrowth ?? []
  const plotCodes = new Set<string>()
  for (const row of trees) {
    const plot = String(row[TREE_FIELDS.plotCode] ?? '')
    if (!plot) {
      issues.push({ level: 'error', message: `林木生长 id=${row.id} 缺样地编号` })
    } else if (plotCodes.has(plot)) {
      issues.push({ level: 'error', message: `样地编号 ${plot} 在示例数据中重复` })
    }
    plotCodes.add(plot)
    if (!row[TREE_FIELDS.batchCode]) {
      issues.push({ level: 'error', message: `样地 ${plot} 缺调查批次` })
    }
    if (!row[TREE_FIELDS.investigator] || !row[TREE_FIELDS.standType]) {
      issues.push({ level: 'error', message: `样地 ${plot} 调查员或林分类型未补全` })
    }
  }
  // 幂等性：对已构建数据再迁移一次，任何值都不应变化。
  const again = migrateAll(envelope.rows, CURRENT_SCHEMA_VERSION)
  if (JSON.stringify(again.rows) !== JSON.stringify(envelope.rows)) {
    issues.push({ level: 'error', message: '示例数据重复迁移后发生变化，迁移不幂等' })
  }
}

/** 旧数据补全：缺调查员/林分类型/批次时按约定补，样地编号原样保留。 */
export function validateLegacyRepair(issues: CheckIssue[]): void {
  const legacy: EntryRow = {
    id: 99,
    status: '已录入',
    pending: true,
    abnormal: false,
    [TREE_FIELDS.recordCode]: 'TREE-0099',
    [TREE_FIELDS.plotCode]: 'YD-KEEP-001',
    [TREE_FIELDS.avgDbh]: '12',
    [TREE_FIELDS.avgHeight]: '9',
    [TREE_FIELDS.canopy]: '0.6',
  }
  const { row, repaired } = repairLegacyTreeRow(legacy)
  if (!repaired) {
    issues.push({ level: 'error', message: '旧数据补全未识别出缺失字段' })
  }
  if (row[TREE_FIELDS.investigator] !== LEGACY_INVESTIGATOR) {
    issues.push({ level: 'error', message: '旧数据调查员补全值不正确' })
  }
  if (row[TREE_FIELDS.standType] !== LEGACY_STAND_TYPE) {
    issues.push({ level: 'error', message: '旧数据林分类型补全值不正确' })
  }
  if (!String(row[TREE_FIELDS.batchCode]).startsWith(LEGACY_BATCH_CODE)) {
    issues.push({ level: 'error', message: '旧数据调查批次补全值不正确' })
  }
  if (row[TREE_FIELDS.plotCode] !== 'YD-KEEP-001') {
    issues.push({ level: 'error', message: '迁移过程改写了样地编号（主键必须原样保留）' })
  }
}

/** 归档锁定：三个入口在已归档状态下都必须被挡住。 */
export function validateArchiveLock(issues: CheckIssue[]): void {
  const archived: EntryRow = {
    id: 1,
    status: '已归档',
    pending: false,
    abnormal: false,
    [TREE_FIELDS.recordCode]: 'TREE-0001',
    [TREE_FIELDS.plotCode]: 'YD-1',
    [TREE_FIELDS.avgDbh]: '12',
    [TREE_FIELDS.avgHeight]: '9',
    [TREE_FIELDS.canopy]: '0.6',
  }
  for (const action of ['提交审核', '复核通过', '要求复核', '重新测量']) {
    const decision = decideTransition(TREE_META, archived, action)
    if (decision.ok) {
      issues.push({ level: 'error', message: `已归档样地仍可执行「${action}」，归档未锁定` })
    }
  }
  const workflow = newWorkflow([archived])
  for (const result of [workflow.review(1), workflow.archive(1), workflow.transition(1, '提交审核')]) {
    if (result.ok) {
      issues.push({ level: 'error', message: '已归档样地的工作流入口未拒绝写操作' })
    }
  }
}

/** 复核失败：旧值进历史快照（带批次），当前测量列不残留旧值。 */
export function validateReviewFailure(issues: CheckIssue[]): void {
  const row: EntryRow = {
    id: 1,
    status: '已审核',
    pending: true,
    abnormal: false,
    [TREE_FIELDS.recordCode]: 'TREE-0001',
    [TREE_FIELDS.plotCode]: 'YD-1',
    [TREE_FIELDS.forestArea]: '青松岭林区',
    [TREE_FIELDS.standType]: '马尾松纯林',
    [TREE_FIELDS.avgDbh]: '260',
    [TREE_FIELDS.avgHeight]: '16',
    [TREE_FIELDS.canopy]: '0.68',
    [TREE_FIELDS.investigator]: '甲',
    [TREE_FIELDS.batchCode]: '2026-09',
    [TREE_FIELDS.history]: '',
  }
  const outcome = reviewMeasurements(row)
  if (outcome.passed) {
    issues.push({ level: 'error', message: '胸径越界的记录复核被判为通过' })
    return
  }
  const workflow = newWorkflow([row])
  const result = workflow.review(1)
  if (result.ok) {
    issues.push({ level: 'error', message: '复核失败却返回成功' })
  }
  const after = workflow.store.load()[0]
  if (after.status !== '需复核') {
    issues.push({ level: 'error', message: '复核失败后状态未流转到「需复核」' })
  }
  for (const field of [TREE_FIELDS.avgDbh, TREE_FIELDS.avgHeight, TREE_FIELDS.canopy]) {
    if (String(after[field]) !== RemeasurePlaceholder) {
      issues.push({ level: 'error', message: `复核失败后旧测量值残留在「${field}」列` })
    }
  }
  const history = String(after[TREE_FIELDS.history] ?? '')
  if (!history.includes('260') || !history.includes('2026-09')) {
    issues.push({ level: 'error', message: '复核失败的旧值或调查批次未进历史快照' })
  }
  // 复核通过路径
  const workflow2 = newWorkflow([{ ...row, [TREE_FIELDS.avgDbh]: '20' }])
  const ok = workflow2.review(1)
  if (!ok.ok || workflow2.store.load()[0].status !== '已归档') {
    issues.push({ level: 'error', message: '测量值正常的记录复核未能归档' })
  }
}

/** 并发复核：同一样地重入只落一次。 */
export function validateConcurrentReview(issues: CheckIssue[]): void {
  const lock = new ReviewLock()
  if (!lock.tryAcquire(1) || lock.tryAcquire(1)) {
    issues.push({ level: 'error', message: '复核锁未能正确拦截并发重入' })
  }
  lock.release(1)
  if (!lock.tryAcquire(1)) {
    issues.push({ level: 'error', message: '复核锁释放后无法重新获取' })
  }
}

/** 批量复核：中断后从缺失样地继续，已处理的不重复落库。 */
export function validateBatchResume(issues: CheckIssue[]): void {
  const rows: EntryRow[] = [1, 2, 3].map((id) => ({
    id,
    status: '已审核',
    pending: true,
    abnormal: false,
    [TREE_FIELDS.recordCode]: `TREE-000${id}`,
    [TREE_FIELDS.plotCode]: `YD-${id}`,
    [TREE_FIELDS.forestArea]: '青松岭林区',
    [TREE_FIELDS.standType]: '马尾松纯林',
    [TREE_FIELDS.avgDbh]: '14',
    [TREE_FIELDS.avgHeight]: '11',
    [TREE_FIELDS.canopy]: '0.6',
    [TREE_FIELDS.investigator]: '甲',
    [TREE_FIELDS.batchCode]: '2026-09',
    [TREE_FIELDS.history]: '',
  }))
  const store = memoryStore(rows.map((row) => ({ ...row })))
  const workflow = createTreeWorkflow(store, { now: () => '2026-10-01 09:00', lock: new ReviewLock() })
  const checkpoint = memoryCheckpoint()
  let held = false
  const deps = {
    now: () => '2026-10-01 09:00',
    genToken: () => 'BATCH-1',
    lock: new ReviewLock(),
    batchHeld: () => held,
    holdBatch: () => {
      held = true
    },
    releaseBatch: () => {
      held = false
    },
  }
  const first = runBatchStep(workflow, checkpoint, deps, 2)
  if (first.progress.cursor !== 2 || first.progress.passed !== 2) {
    issues.push({ level: 'error', message: '首批复核未按步长处理 2 条' })
  }
  // 模拟中断：批次锁释放，但 checkpoint 保留；继续时应从第 3 条开始。
  const second = runBatchStep(workflow, checkpoint, deps, 10)
  if (!second.resumed) {
    issues.push({ level: 'error', message: '中断后未识别为断点续检' })
  }
  if (second.progress.passed !== 3 || !second.progress.done) {
    issues.push({ level: 'error', message: '续检未从缺失样地继续并完成整批' })
  }
  if (second.effects.some((effect) => effect.id === 1 || effect.id === 2)) {
    issues.push({ level: 'error', message: '续检重复处理了已复核样地' })
  }
  const done = checkpoint.current()
  if (!done?.done) {
    issues.push({ level: 'error', message: '批量复核完成后 checkpoint 未标记 done' })
  }
}

/** 林带建议清单：复核结果驱动，失败与低郁闭度归档两类建议都要出现。 */
export function validateBeltSuggestions(issues: CheckIssue[], treeSeed: EntryRow[], beltSeed: EntryRow[]): void {
  const index = indexBeltsByArea(beltSeed)
  const suggestions = buildBeltSuggestions(treeSeed, index)
  if (!suggestions.some((item) => item.kind === '复核失败-重点核查')) {
    issues.push({ level: 'error', message: '林带建议清单缺少复核失败建议' })
  }
  if (!suggestions.some((item) => item.kind === '归档-跟踪补植')) {
    issues.push({ level: 'warn', message: '林带建议清单缺少低郁闭度归档跟踪建议' })
  }
  for (const item of suggestions) {
    if (!item.plotCode || item.plotCode.includes('样例')) {
      issues.push({ level: 'error', message: '林带建议丢失了来源样地编号' })
    }
  }
}

export function runAllChecks(seedEnvelope: { version: number; rows: Record<string, EntryRow[]> }): CheckIssue[] {
  const issues: CheckIssue[] = []
  validateMeta(issues)
  validateSeed(seedEnvelope, issues)
  validateLegacyRepair(issues)
  validateArchiveLock(issues)
  validateReviewFailure(issues)
  validateConcurrentReview(issues)
  validateBatchResume(issues)
  validateBeltSuggestions(issues, seedEnvelope.rows.treegrowth ?? [], seedEnvelope.rows.firebelt ?? [])
  return issues
}
