/**
 * 旧数据补全规则：迁移老批次林木生长记录时用。
 * 原则：只补缺、不改业务主键，样地编号在任何迁移步骤里都不允许被改写。
 */

/** 林分类型缺失时的兜底值：先归到未划分，由后续外业调查再细分。 */
export const LEGACY_STAND_TYPE = '未划分林分'
/** 调查员缺失时的兜底值：标明是历史补登，责任人待核实。 */
export const LEGACY_INVESTIGATOR = '历史补登（调查员待核实）'
/** 调查批次缺失时的兜底值：归入同一个历史批次，保证历史记录能按批次追溯。 */
export const LEGACY_BATCH_CODE = 'HIST-LEGACY'
export const LEGACY_BATCH_LABEL = '历史批次（迁移前）'
/** 所属林区缺失时的兜底值（林带建议清单按林区关联，缺了就无法关联）。 */
export const LEGACY_FOREST_AREA = '待核实林区'
/** 复核失败后旧测量值移入历史字段时，当前测量列的占位值，提示必须重新外业测量。 */
export const RemeasurePlaceholder = '待补测'

/** 林木生长模块的字段名常量，避免各处手写字符串。 */
export const TREE_FIELDS = {
  recordCode: '记录编号',
  plotCode: '样地编号',
  forestArea: '所属林区',
  standType: '林分类型',
  avgDbh: '平均胸径',
  avgHeight: '平均树高',
  canopy: '郁闭度',
  investigator: '调查员',
  batchCode: '调查批次',
  history: '历史测量值',
} as const

/** 测量值合理区间（厘米 / 米 / 0~1 郁闭度），复核与自检共用。 */
export const MEASURE_LIMITS = {
  dbh: { min: 1, max: 200 },
  height: { min: 0.5, max: 120 },
  canopy: { min: 0, max: 1 },
} as const

/** 已归档但郁闭度低于该阈值的样地，会进入林带建议清单做跟踪补植。 */
export const LOW_CANOPY_THRESHOLD = 0.4
