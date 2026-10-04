<template>
  <section class="page" data-module="treegrowth">
    <header class="page-head">
      <div>
        <h2>林木生长管理</h2>
        <p class="page-desc">维护林木生长记录，围绕记录编号、样地编号、林分类型、平均胸径做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="showCreate = !showCreate">登记林木生长记录</button>
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

    <form v-if="showCreate" class="filter-bar" @submit.prevent="submitCreate">
      <label v-for="field in createFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="createForm[field]" :placeholder="`必填`" />
      </label>
      <button class="btn primary" type="submit">提交登记</button>
      <button class="btn ghost" type="button" @click="showCreate = false">取消</button>
    </form>

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
              v-for="action in actionsFor(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="toggleHistory(row)">历史</button>
            <span v-if="actionsFor(row).length === 0" class="locked-hint">已锁定</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无林木生长数据，可先登记林木生长记录</td>
        </tr>
      </tbody>
    </table>

    <section v-if="reviewTarget" class="panel">
      <h3>复核 {{ reviewTarget['记录编号'] }}（样地 {{ reviewTarget['样地编号'] }} · {{ reviewTarget['调查批次'] }}）</h3>
      <p class="panel-desc">复核通过必须重新测量并填写三项指标；复核不通过将退回「已录入」重新登记。</p>
      <form class="filter-bar" @submit.prevent="submitReview(true)">
        <label v-for="field in measureFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="reviewForm[field]" placeholder="重新测量值" />
        </label>
        <button class="btn primary" type="submit">复核通过</button>
        <button class="btn" type="button" @click="submitReview(false)">复核不通过</button>
        <button class="btn ghost" type="button" @click="reviewTarget = null">取消</button>
      </form>
    </section>

    <section v-if="historyTarget" class="panel">
      <h3>流转历史：{{ historyTarget['记录编号'] }}（样地 {{ historyTarget['样地编号'] }}）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in historyColumns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in historyRows" :key="String(item.id)">
            <td v-for="column in historyColumns" :key="column">{{ item[column] || '—' }}</td>
          </tr>
          <tr v-if="!historyRows.length">
            <td :colspan="historyColumns.length" class="empty-state">暂无流转历史</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条林木生长记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  createTreegrowthEntry,
  downloadEntries,
  listEntries,
  listTreegrowthHistory,
  moduleMeta,
  reviewTreegrowth,
  rowActions,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { MEASURE_FIELDS, STATUS, currentBatch } from '@/shared/treegrowth-rules.mjs'

const meta = moduleMeta('treegrowth')
const columns = meta.fields
const statuses = meta.statuses
const measureFields = MEASURE_FIELDS
const createFields = ['样地编号', '林分类型', ...MEASURE_FIELDS, '调查员']
const historyColumns = ['时间', '动作', '原状态', '新状态', '调查批次', '测量快照']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const showCreate = ref(false)
const createForm = ref<Record<string, string>>({})
const reviewTarget = ref<EntryRow | null>(null)
const reviewForm = ref<Record<string, string>>({})
const historyTarget = ref<EntryRow | null>(null)
const historyRows = ref<EntryRow[]>([])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '样地数量', value: new Set(rows.value.map((row) => String(row['样地编号']))).size },
  { label: '待审核记录', value: rows.value.filter((row) => row.status === STATUS.ENTERED).length },
  {
    label: '本月录入',
    value: rows.value.filter((row) => String(row['调查批次']) === currentBatch()).length,
  },
])

function resetFilters() {
  filters.value = {}
  reload()
}

/** 行内可执行动作统一问共用状态规则；复核动作走复核面板。 */
function actionsFor(row: EntryRow): string[] {
  return rowActions(meta.key, row).map((action) =>
    action === '复核通过' || action === '复核不通过' ? '复核' : action,
  ).filter((action, index, list) => list.indexOf(action) === index)
}

function exportRows() {
  downloadEntries(meta.key)
}

function submitCreate() {
  errorMessage.value = ''
  const result = createTreegrowthEntry(createForm.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  createForm.value = {}
  showCreate.value = false
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  if (action === '复核') {
    reviewForm.value = {}
    reviewTarget.value = row
    return
  }
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function submitReview(pass: boolean) {
  if (!reviewTarget.value) {
    return
  }
  errorMessage.value = ''
  const result = reviewTreegrowth(Number(reviewTarget.value.id), {
    pass,
    measures: pass ? reviewForm.value : undefined,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reviewTarget.value = null
  reviewForm.value = {}
  reload()
}

function toggleHistory(row: EntryRow) {
  if (historyTarget.value && Number(historyTarget.value.id) === Number(row.id)) {
    historyTarget.value = null
    return
  }
  historyTarget.value = row
  historyRows.value = listTreegrowthHistory(String(row['记录编号']))
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    if (historyTarget.value) {
      historyRows.value = listTreegrowthHistory(String(historyTarget.value['记录编号']))
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '林木生长列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin-top: 12px;
}
.panel h3 {
  margin: 0 0 8px;
  font-size: 14px;
}
.panel-desc {
  color: var(--muted);
  font-size: 12px;
  margin: 0 0 8px;
}
.locked-hint {
  color: var(--muted);
  font-size: 12px;
}
</style>
