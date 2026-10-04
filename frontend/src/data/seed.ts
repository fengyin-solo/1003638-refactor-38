import seed from './seed.json'
import type { EntryRow } from './types'

// 示例数据：首次打开时播种，之后浏览器里的改动优先，重置才会回到这份。
// 数据本体在 seed.json，由 `npm run seed`（scripts/build-seed.mjs）构建并补全。
export const SEED_ROWS: Record<string, EntryRow[]> = seed as Record<string, EntryRow[]>
