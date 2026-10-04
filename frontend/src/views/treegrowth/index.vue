<template>
  <section class="page" data-module="treegrowth">
    <header class="page-head">
      <div>
        <h2>林木生长管理</h2>
        <p class="page-desc">围绕样地编号、林分类型、平均胸径做登记、复核与归档；状态规则三处入口共用，已归档样地锁定不可改。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记林木生长记录</button>
        <button class="btn" type="button" @click="exportRows">导出林木生长清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <div v-if="batch" class="batch-bar">
      <span>
        批量复核{{ batchResumed ? '（断点续检）' : '' }}：计划 {{ batch.planIds.length }} 个样地，
        已处理 {{ batch.cursor }}，通过 {{ batch.passed }}，未通过 {{ batch.failed }}，跳过 {{ batch.skipped }}
      </span>
      <button class="btn" type="button" :disabled="batchRunning" @click="runBatchChunk">
        {{ batch.done ? '复核完成（点击清理记录）' : batch.cursor === 0 ? '开始批量复核' : '继续批量复核' }}
      </button>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(row)"
              :key="action.name"
              class="link"
              type="button"
              @click="runAction(action.name, row)"
            >
              {{ action.label }}
            </button>
            <span v-if="availableActions(row).length === 0" class="muted-text">—</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无林木生长数据，可先登记林木生长记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条林木生长记录 · 旧数据缺失的调查员/林分类型已按迁移规则补全，样地编号不变</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="creating" class="modal-mask" @click.self="closeForm">
      <form class="modal-card" @submit.prevent="submitCreate">
        <h3>登记林木生长记录</h3>
        <label v-for="field in createFields" :key="field.key" class="form-item">
          <span>{{ field.label }}{{ field.required ? ' *' : '' }}</span>
          <input v-model="createForm[field.key]" :placeholder="field.placeholder ?? ''" />
        </label>
        <p class="form-tip">样地编号一经录入不可更改；调查批次用于历史记录按批次追溯。</p>
        <div class="modal-actions">
          <button class="btn primary" type="submit">提交登记</button>
          <button class="btn ghost" type="button" @click="closeForm">取消</button>
        </div>
      </form>
    </div>

    <div v-if="remeasuring" class="modal-mask" @click.self="closeRemeasure">
      <form class="modal-card" @submit.prevent="submitRemeasure">
        <h3>重新外业测量 · {{ String(remeasureRow?.['样地编号'] ?? '') }}</h3>
        <p class="form-tip">旧测量值已带调查批次进入历史快照，请录入新测量值；提交后记录回到「已录入」。</p>
        <label class="form-item">
          <span>平均胸径（cm，1~200）*</span>
          <input v-model="remeasureForm.avgDbh" placeholder="如 14.2" />
        </label>
        <label class="form-item">
          <span>平均树高（m，0.5~120）*</span>
          <input v-model="remeasureForm.avgHeight" placeholder="如 11.6" />
        </label>
        <label class="form-item">
          <span>郁闭度（0~1）*</span>
          <input v-model="remeasureForm.canopy" placeholder="如 0.62" />
        </label>
        <label class="form-item">
          <span>调查批次（留空沿用原批次）</span>
          <input v-model="remeasureForm.batchCode" :placeholder="String(remeasureRow?.['调查批次'] ?? '')" />
        </label>
        <div class="modal-actions">
          <button class="btn primary" type="submit">提交重新测量</button>
          <button class="btn ghost" type="button" @click="closeRemeasure">取消</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import {
  archiveTreeEntry,
  clearBatchProgress,
  createTreeEntry,
  defaultBatchCode,
  getBatchProgress,
  remeasureTreeEntry,
  reviewTreeEntry,
  runReviewBatchStep,
  transitionTreeEntry,
} from '@/api/treegrowth-service'
import type { BatchProgress } from '@/domain/treegrowth'

const meta = moduleMeta('treegrowth')
// 表格列不含「历史测量值」（内容是快照 JSON，在动作提示里体现）。
const columns = ['记录编号', '样地编号', '所属林区', '林分类型', '平均胸径', '平均树高', '郁闭度', '调查员', '调查批次']
const statuses = ['已录入', '已审核', '需复核', '已归档']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['记录编号', '样地编号', '林分类型']

const batch = ref<BatchProgress | null>(getBatchProgress())
const batchRunning = ref(false)
const batchResumed = ref(false)

const stats = computed(() => [
  { label: '样地数量', value: new Set(rows.value.map((row) => String(row['样地编号'] ?? ''))).size },
  { label: '待审核记录', value: rows.value.filter((row) => row.status === '已录入').length },
  { label: '待复核/已审核', value: rows.value.filter((row) => row.status === '已审核' || row.status === '需复核').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 三个入口共用一套状态规则：页面只按白名单渲染按钮，能不能点由 domain 层终判。
const ACTION_VIEWS: Record<string, { name: string; label: string }[]> = {
  已录入: [{ name: '提交审核', label: '提交审核' }],
  已审核: [
    { name: '__review__', label: '复核' },
    { name: '__archive__', label: '归档' },
    { name: '__requestRecheck__', label: '人工要求复核' },
  ],
  需复核: [{ name: '__remeasure__', label: '录入重新测量值' }],
  已归档: [],
}

function availableActions(row: EntryRow) {
  return ACTION_VIEWS[String(row.status)] ?? []
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

// ===== 登记入口 =====
const creating = ref(false)
const createFields = [
  { key: 'plotCode', label: '样地编号', required: true, placeholder: '如 YD-2026-007' },
  { key: 'forestArea', label: '所属林区', required: false, placeholder: '如 青松岭林区' },
  { key: 'standType', label: '林分类型', required: true, placeholder: '如 马尾松纯林' },
  { key: 'avgDbh', label: '平均胸径（cm）', required: false, placeholder: '1~200' },
  { key: 'avgHeight', label: '平均树高（m）', required: false, placeholder: '0.5~120' },
  { key: 'canopy', label: '郁闭度', required: false, placeholder: '0~1' },
  { key: 'investigator', label: '调查员', required: false, placeholder: '调查员姓名' },
  { key: 'batchCode', label: '调查批次', required: true, placeholder: '如 2026-10' },
] as const

const emptyCreateForm = () => ({
  plotCode: '',
  forestArea: '',
  standType: '',
  avgDbh: '',
  avgHeight: '',
  canopy: '',
  investigator: '',
  batchCode: defaultBatchCode(),
})
const createForm = ref(emptyCreateForm())

function openCreate() {
  createForm.value = emptyCreateForm()
  errorMessage.value = ''
  creating.value = true
}

function closeForm() {
  creating.value = false
}

function submitCreate() {
  const result = createTreeEntry(createForm.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  creating.value = false
  errorMessage.value = ''
  reload()
}

// ===== 重新测量入口 =====
const remeasuring = ref(false)
const remeasureRow = ref<EntryRow | null>(null)
const remeasureForm = ref({ avgDbh: '', avgHeight: '', canopy: '', batchCode: '' })

function openRemeasure(row: EntryRow) {
  remeasureRow.value = row
  remeasureForm.value = { avgDbh: '', avgHeight: '', canopy: '', batchCode: '' }
  errorMessage.value = ''
  remeasuring.value = true
}

function closeRemeasure() {
  remeasuring.value = false
  remeasureRow.value = null
}

function submitRemeasure() {
  if (!remeasureRow.value) {
    return
  }
  const result = remeasureTreeEntry(Number(remeasureRow.value.id), remeasureForm.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  closeRemeasure()
  errorMessage.value = ''
  reload()
}

// ===== 动作分发（复核/归档都走共用规则） =====
function runAction(actionName: string, row: EntryRow) {
  errorMessage.value = ''
  const id = Number(row.id)
  let result: { ok: boolean; message: string }
  if (actionName === '__review__') {
    result = reviewTreeEntry(id, false)
  } else if (actionName === '__requestRecheck__') {
    result = reviewTreeEntry(id, true)
  } else if (actionName === '__archive__') {
    result = archiveTreeEntry(id)
  } else if (actionName === '__remeasure__') {
    openRemeasure(row)
    return
  } else {
    result = transitionTreeEntry(id, actionName)
  }
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

// ===== 批量复核（并发只落一次；中断后从缺失样地继续） =====
function runBatchChunk() {
  if (batch.value?.done) {
    clearBatchProgress()
    batch.value = null
    return
  }
  if (batchRunning.value) {
    errorMessage.value = '已有一批复核正在执行，请稍候'
    return
  }
  batchRunning.value = true
  try {
    const step = runReviewBatchStep(25)
    batchResumed.value = step.resumed
    batch.value = step.progress
    const failed = step.effects.filter((effect) => effect.outcome === 'failed')
    if (failed.length > 0) {
      errorMessage.value = `本批 ${failed.length} 个样地复核未通过，旧值已入历史，请安排重新测量`
    } else {
      errorMessage.value = ''
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '批量复核启动失败'
  } finally {
    batchRunning.value = false
    reload()
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '林木生长列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.batch-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  background: #eef2f7;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 13px;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-card {
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  width: 460px;
  max-height: 86vh;
  overflow: auto;
}
.modal-card h3 { margin: 0 0 12px; font-size: 16px; }
.form-item { display: block; margin-bottom: 10px; font-size: 13px; }
.form-item span { display: block; color: var(--muted); margin-bottom: 4px; }
.form-item input { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; }
.form-tip { font-size: 12px; color: var(--muted); margin: 4px 0 12px; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
.muted-text { color: var(--muted); }
</style>
