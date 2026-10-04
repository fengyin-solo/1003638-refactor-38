/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  /**
   * 共用状态机：只在「当前状态 ∈ 键集合」时允许该动作，值为流转目标。
   * 缺省（普通模块）沿用线性规则：除最后一个状态外都可提交，目标状态不允许自循环。
   * 林木生长用显式规则，已归档等终态不会出现在任何键集合里，因此永远不可再改。
   */
  transitions?: Record<string, Record<string, string>>
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 林木生长：复核判定结果。 */
export type ReviewOutcome = {
  /** 复核是否通过（测量值在合理区间内）。 */
  passed: boolean
  /** 不通过时给出的原因，用于页面提示。 */
  reason: string
}

/** 林带建议清单中的一条建议，数据来自林木生长复核结果。 */
export type BeltSuggestion = {
  /** 触发建议的林木生长记录编号。 */
  recordCode: string
  /** 建议来源样地编号（绝不参与改写）。 */
  plotCode: string
  forestArea: string
  beltCode: string
  /** 建议类型：复核失败 → 重点补植核查；已归档但郁闭度偏低 → 跟踪补植。 */
  kind: '复核失败-重点核查' | '归档-跟踪补植'
  reason: string
}
