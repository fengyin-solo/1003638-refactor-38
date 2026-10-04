import type { ActionResult, EntryRow, ModuleMeta } from '../data/types'

/**
 * 状态规则集中点：录入、复核、归档三处入口都只认这里的判断，
 * 页面和各服务不再各自写一遍「这个状态能不能做这个动作」。
 */

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

/** 模块的终态（最后一个状态）：默认视为锁定态，任何动作都不能再改。 */
export function lockedStatuses(meta: ModuleMeta): Set<string> {
  const locked = new Set<string>()
  if (meta.key === 'treegrowth') {
    // 林木生长：已归档是法律意义上的归档，样地记录锁死，任何入口都改不了。
    locked.add('已归档')
  } else if (meta.statuses.length > 0) {
    locked.add(meta.statuses[meta.statuses.length - 1])
  }
  return locked
}

/** pending 标记：终态/锁定态不再待处理，其余状态都待处理。 */
export function isPendingStatus(meta: ModuleMeta, status: string): boolean {
  return !lockedStatuses(meta).has(status)
}

/** abnormal 标记：显式规则优先，其次按「往回走」动作的语义推断。 */
export function isNegativeAction(action: string): boolean {
  return NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb))
}

/**
 * 动作在当前状态下的流转目标；返回 null 表示不允许执行。
 * - 林木生长（有显式 transitions）：严格按白名单走，白名单没列就拒绝。
 * - 普通模块：线性状态机，目标态不允许自循环，锁定态一律拒绝。
 */
export function resolveTarget(meta: ModuleMeta, status: string, action: string): string | null {
  if (lockedStatuses(meta).has(status)) {
    return null
  }
  if (meta.transitions) {
    const target = meta.transitions[status]?.[action]
    return target === undefined || target === status ? null : target
  }
  const target = meta.actionTargets[action]
  if (!target || target === status) {
    return null
  }
  // 普通模块不允许从更早的状态跳到锁定态之外的回头路：沿用 actionTargets 即目标本身，
  // 这里只挡住「已经在某状态、又被改成同一个状态」和终态两种情况，保持原线性语义。
  return target
}

/** 统一的动作前置校验文案，三个入口拿到的拒绝原因完全一致。 */
export function describeBlock(meta: ModuleMeta, status: string, action: string): string {
  if (lockedStatuses(meta).has(status)) {
    return `${meta.entity}已「${status}」并锁定，不能再执行「${action}」`
  }
  if (!meta.actionTargets[action]) {
    return `${meta.entity}没有登记「${action}」这个动作`
  }
  return `「${status}」状态的${meta.entity}不能执行「${action}」，请先完成前置状态流转`
}

export type TransitionDecision =
  | { ok: true; target: string; pending: boolean; abnormal: boolean }
  | { ok: false; message: string }

/** 一次状态流转判定的唯一入口：所有写操作（含复核、归档）都从这里过。 */
export function decideTransition(
  meta: ModuleMeta,
  row: Pick<EntryRow, 'status'>,
  action: string,
): TransitionDecision {
  const status = String(row.status)
  if (!meta.actionTargets[action]) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const target = resolveTarget(meta, status, action)
  if (target === null) {
    return { ok: false, message: describeBlock(meta, status, action) }
  }
  return {
    ok: true,
    target,
    pending: isPendingStatus(meta, target),
    abnormal: isNegativeAction(action),
  }
}

/** 把判定结果套用到行数据上，产出可落库的新行（不修改原行）。 */
export function applyDecision(row: EntryRow, decision: Extract<TransitionDecision, { ok: true }>): EntryRow {
  return {
    ...row,
    status: decision.target,
    pending: decision.pending,
    abnormal: decision.abnormal ? true : row.abnormal,
  }
}

/** ActionResult 便捷构造，供服务层复用。 */
export function rejected(message: string): ActionResult {
  return { ok: false, message }
}

export function succeeded(message: string): ActionResult {
  return { ok: true, message }
}
