/**
 * 林木生长记录的共用状态规则。
 *
 * 录入、复核、归档三个入口原本各有一套状态判断，导致：
 * 已归档样地仍可能被改、复核失败后旧测量值残留、历史记录丢失调查批次。
 * 现在规则只维护在这一份文件里，页面、本地数据服务、示例数据构建脚本、
 * 部署检查脚本全部从这里取，改动一处即全链路生效。
 *
 * 纯 JS（ESM），浏览器（Vite）和 Node（scripts/）都能直接 import，不需要编译。
 */

/** 林木生长记录的四个状态。 */
export const STATUS = Object.freeze({
  ENTERED: '已录入',
  REVIEWED: '已审核',
  RECHECK: '需复核',
  ARCHIVED: '已归档',
})

export const STATUSES = Object.freeze([
  STATUS.ENTERED,
  STATUS.REVIEWED,
  STATUS.RECHECK,
  STATUS.ARCHIVED,
])

/** 终态：进入后不允许再执行任何动作（修「已归档样地仍可能被改」）。 */
export const TERMINAL_STATUSES = Object.freeze([STATUS.ARCHIVED])

/** 测量字段：复核失败 / 要求复核时旧值必须清走，不允许残留在记录上。 */
export const MEASURE_FIELDS = Object.freeze(['平均胸径', '平均树高', '郁闭度'])

/** 提交审核前必须齐全的字段。 */
export const REQUIRED_FIELDS = Object.freeze(['记录编号', '样地编号', '林分类型', '调查员'])

/**
 * 旧数据补全默认值：缺调查员、林分类型或调查批次时按这份表补。
 * 注意：样地编号是业务主键，任何情况下补全逻辑都不允许改它。
 */
export const BACKFILL_DEFAULTS = Object.freeze({
  调查员: '待补录',
  林分类型: '待定林分',
  调查批次: '历史批次',
})

/** 历史记录存放在本地库里的 key（不作为业务模块注册）。 */
export const HISTORY_KEY = 'treegrowth-history'

/** 通用「往回走」动作词：命中即把记录标为异常态。 */
export const NEGATIVE_ACTIONS = Object.freeze(['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚'])

/**
 * @typedef {Object} TransitionRule
 * @property {string} action 动作名
 * @property {readonly string[]} from 允许的来源状态
 * @property {string} to 目标状态
 * @property {boolean} [requireFields] 执行前校验必填字段齐全
 * @property {boolean} [requireMeasures] 执行时必须随动作提交一组新测量值
 * @property {boolean} [clearMeasures] 执行时把旧测量值快照进历史并清空（修「复核失败后旧测量值残留」）
 */

/**
 * 流转表：录入、复核、归档共用的唯一一份状态机定义。
 * @type {ReadonlyArray<TransitionRule>}
 */
export const TRANSITIONS = Object.freeze([
  { action: '提交审核', from: [STATUS.ENTERED], to: STATUS.REVIEWED, requireFields: true },
  { action: '要求复核', from: [STATUS.REVIEWED], to: STATUS.RECHECK, clearMeasures: true },
  { action: '复核通过', from: [STATUS.RECHECK], to: STATUS.REVIEWED, requireMeasures: true },
  { action: '复核不通过', from: [STATUS.RECHECK], to: STATUS.ENTERED },
  { action: '确认归档', from: [STATUS.REVIEWED], to: STATUS.ARCHIVED },
])

/**
 * @typedef {Object} RuleMeta 模块元数据里引擎关心的部分
 * @property {string} entity
 * @property {string[]} statuses
 * @property {string[]} actions
 * @property {Record<string, string>} actionTargets
 * @property {string[]} [terminalStatuses]
 * @property {readonly TransitionRule[]} [flow]
 */

/**
 * @typedef {Object} TransitionResult
 * @property {boolean} ok
 * @property {string} message
 * @property {Record<string, any>} [row]
 * @property {Record<string, any>} [history]
 */

/** 当前调查批次，格式 `2026-10批次`。 */
export function currentBatch(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${now.getFullYear()}-${month}批次`
}

/** 状态是否被显式声明为终态（锁定，不可再改）。 */
export function isLocked(meta, status) {
  return (meta.terminalStatuses ?? []).includes(String(status))
}

/** 目标状态是否仍算「待处理」（看板统计用）：未显式声明终态时退回「状态表末位」语义。 */
function isPending(meta, target) {
  const last = meta.statuses[meta.statuses.length - 1]
  return target !== last
}

/**
 * 某条记录当前可执行的动作：终态锁定后为空；有流转表按来源状态过滤；
 * 其余模块退回「目标状态不等于当前状态」的旧语义。
 */
export function availableActions(meta, row) {
  const status = String(row.status)
  if (isLocked(meta, status)) {
    return []
  }
  if (meta.flow) {
    return meta.flow.filter((rule) => rule.from.includes(status)).map((rule) => rule.action)
  }
  return meta.actions.filter((action) => {
    const target = meta.actionTargets[action]
    return Boolean(target) && target !== status
  })
}

/**
 * 共用流转引擎：所有模块的动作都走这里。
 * 有流转表（flow）的模块获得来源状态校验、测量值清理和历史条目；
 * 没有流转表的模块保持旧的宽松行为，只是同样享受终态锁定。
 *
 * @param {RuleMeta} meta
 * @param {Record<string, any>} row
 * @param {string} action
 * @param {{ measures?: Record<string, string>, now?: Date }} [ctx]
 * @returns {TransitionResult}
 */
export function applyTransition(meta, row, action, ctx = {}) {
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const status = String(row.status)
  if (isLocked(meta, status)) {
    return { ok: false, message: `${meta.entity}已归档锁定，不允许再改动` }
  }
  if (status === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const rule = meta.flow?.find((item) => item.action === action)
  if (rule && !rule.from.includes(status)) {
    return { ok: false, message: `当前状态「${status}」不允许执行「${action}」` }
  }
  if (rule?.requireFields) {
    const missing = REQUIRED_FIELDS.filter((field) => !String(row[field] ?? '').trim())
    if (missing.length > 0) {
      return { ok: false, message: `缺少必填字段：${missing.join('、')}` }
    }
  }
  let measures = null
  if (rule?.requireMeasures) {
    measures = {}
    for (const field of MEASURE_FIELDS) {
      const value = String(ctx.measures?.[field] ?? '').trim()
      if (!value) {
        return { ok: false, message: `复核通过前必须重新测量并填写「${field}」` }
      }
      measures[field] = value
    }
  }
  /** @type {Record<string, any>} */
  const next = { ...row, status: target }
  next.pending = isPending(meta, target)
  next.abnormal =
    target === STATUS.RECHECK || NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb))
  let snapshot = ''
  if (rule?.clearMeasures) {
    /** @type {Record<string, any>} */
    const old = {}
    for (const field of MEASURE_FIELDS) {
      if (String(next[field] ?? '').trim()) {
        old[field] = next[field]
      }
    }
    if (Object.keys(old).length > 0) {
      snapshot = JSON.stringify(old)
    }
    for (const field of MEASURE_FIELDS) {
      next[field] = ''
    }
  }
  if (measures) {
    Object.assign(next, measures)
  }
  if ('记录状态' in next) {
    next['记录状态'] = target
  }
  const history = meta.flow
    ? buildHistory(next, row, action, status, target, snapshot, ctx.now ?? new Date())
    : null
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」`, row: next, history }
}

/**
 * 复核入口：并发只落一次。
 * 只有「需复核」状态允许落复核结果；并发或重复请求到达时状态已变，
 * 直接拒绝且不写任何数据，第二次调用不会重复落库。
 *
 * @param {RuleMeta} meta
 * @param {Record<string, any>} row
 * @param {{ pass: boolean, measures?: Record<string, string>, now?: Date }} payload
 * @returns {TransitionResult}
 */
export function applyReview(meta, row, payload) {
  if (String(row.status) !== STATUS.RECHECK) {
    return {
      ok: false,
      message: `记录当前状态「${row.status}」，复核请求已忽略（可能已被并发处理）`,
    }
  }
  return applyTransition(meta, row, payload.pass ? '复核通过' : '复核不通过', payload)
}

/**
 * 录入入口：校验必填、样地编号不重复，自动生成记录编号与调查批次。
 *
 * @param {RuleMeta} meta
 * @param {Record<string, any>} input
 * @param {Array<Record<string, any>>} existing
 * @param {Date} [now]
 * @returns {TransitionResult}
 */
export function buildEntry(meta, input, existing, now = new Date()) {
  const required = ['样地编号', '林分类型', '调查员', ...MEASURE_FIELDS]
  const missing = required.filter((field) => !String(input[field] ?? '').trim())
  if (missing.length > 0) {
    return { ok: false, message: `录入缺少必填项：${missing.join('、')}` }
  }
  const plot = String(input['样地编号']).trim()
  if (existing.some((row) => String(row['样地编号']) === plot)) {
    return { ok: false, message: `样地编号 ${plot} 已存在生长记录，不能重复登记` }
  }
  const id = Math.max(0, ...existing.map((row) => Number(row.id) || 0)) + 1
  const batch = currentBatch(now)
  /** @type {Record<string, any>} */
  const row = {
    id,
    status: STATUS.ENTERED,
    pending: true,
    abnormal: false,
    记录编号: `TREE-${String(id).padStart(4, '0')}`,
    样地编号: plot,
    林分类型: String(input['林分类型']).trim(),
    调查员: String(input['调查员']).trim(),
    调查批次: batch,
    记录状态: STATUS.ENTERED,
  }
  for (const field of MEASURE_FIELDS) {
    row[field] = String(input[field]).trim()
  }
  const history = buildHistory(row, row, '登记录入', '', STATUS.ENTERED, '', now)
  return { ok: true, message: `${meta.entity}已登记，当前状态「${STATUS.ENTERED}」`, row, history }
}

/**
 * 历史条目：每一次流转都带上当时的调查批次，历史不再丢批次。
 * id 由调用方落库时分配。
 */
function buildHistory(next, prev, action, from, to, snapshot, now) {
  return {
    id: 0,
    status: '历史',
    pending: false,
    abnormal: false,
    记录编号: String(next['记录编号'] ?? prev['记录编号'] ?? ''),
    样地编号: String(next['样地编号'] ?? prev['样地编号'] ?? ''),
    调查批次: String(next['调查批次'] ?? prev['调查批次'] ?? BACKFILL_DEFAULTS['调查批次']),
    动作: action,
    原状态: from,
    新状态: to,
    测量快照: snapshot,
    时间: now.toISOString(),
  }
}

/**
 * 旧数据补全：缺调查员、林分类型、调查批次时补默认值。
 * 绝不修改样地编号——它是历史数据与检查断点续跑的对齐主键。
 *
 * @param {Record<string, any>} row
 * @returns {{ row: Record<string, any>, changed: boolean }}
 */
export function backfillRow(row) {
  const next = { ...row }
  let changed = false
  for (const [field, value] of Object.entries(BACKFILL_DEFAULTS)) {
    if (next[field] === undefined || next[field] === null || String(next[field]).trim() === '') {
      next[field] = value
      changed = true
    }
  }
  return { row: next, changed }
}

/**
 * 林带建议清单：其余模块（防火林带）同步使用林木生长的复核结果。
 * 需复核 → 建议优先补植；复核通过后已审核 → 建议常规巡查；已归档不再出建议。
 *
 * @param {Array<Record<string, any>>} rows 林木生长记录
 * @param {Array<Record<string, any>>} historyRows 流转历史
 * @returns {Array<{ 样地编号: string, 建议: string, 依据: string, 调查批次: string }>}
 */
export function buildBeltSuggestions(rows, historyRows = []) {
  /** @type {Array<{ 样地编号: string, 建议: string, 依据: string, 调查批次: string }>} */
  const suggestions = []
  for (const row of rows) {
    const plot = String(row['样地编号'] ?? '')
    const batch = String(row['调查批次'] ?? '')
    if (row.status === STATUS.RECHECK) {
      suggestions.push({
        样地编号: plot,
        建议: '优先安排防火林带补植',
        依据: '复核未通过，生长指标待重测',
        调查批次: batch,
      })
    } else if (
      row.status === STATUS.REVIEWED &&
      historyRows.some((item) => item['样地编号'] === plot && item['动作'] === '复核通过')
    ) {
      suggestions.push({
        样地编号: plot,
        建议: '林带保持常规巡查',
        依据: '复核通过，生长指标达标',
        调查批次: batch,
      })
    }
  }
  return suggestions
}

/**
 * 部署检查用的单样地校验：返回问题清单，空数组表示通过。
 *
 * @param {Record<string, any>} row
 * @returns {string[]}
 */
export function checkPlot(row) {
  /** @type {string[]} */
  const problems = []
  const plot = String(row['样地编号'] ?? '').trim()
  if (!plot) {
    problems.push('缺少样地编号')
  }
  for (const field of Object.keys(BACKFILL_DEFAULTS)) {
    if (!String(row[field] ?? '').trim()) {
      problems.push(`缺少${field}`)
    }
  }
  if (!STATUSES.includes(/** @type {any} */ (String(row.status)))) {
    problems.push(`状态「${row.status}」不合法`)
  }
  if (row.status === STATUS.RECHECK) {
    for (const field of MEASURE_FIELDS) {
      if (String(row[field] ?? '').trim()) {
        problems.push(`需复核记录仍残留旧测量值「${field}」`)
      }
    }
  }
  return problems
}

/**
 * 历史条目校验：每一条都必须带调查批次（修「历史记录会丢失调查批次」）。
 *
 * @param {Array<Record<string, any>>} historyRows
 * @returns {string[]}
 */
export function checkHistoryBatch(historyRows) {
  return historyRows
    .filter((item) => !String(item['调查批次'] ?? '').trim())
    .map((item) => `历史条目 #${item.id}（${item['记录编号'] ?? '?'}）缺少调查批次`)
}
