/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type TransitionRule = {
  action: string
  from: readonly string[]
  to: string
  requireFields?: boolean
  requireMeasures?: boolean
  clearMeasures?: boolean
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
  /** 终态：进入后锁定，任何动作都不允许再改（如「已归档」） */
  terminalStatuses?: string[]
  /** 流转表：声明后动作按来源状态校验，未声明的模块保持旧的宽松行为 */
  flow?: readonly TransitionRule[]
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

/** 林带建议清单条目：由林木生长复核结果推导，防火林带等模块共用 */
export type BeltSuggestion = {
  样地编号: string
  建议: string
  依据: string
  调查批次: string
}
