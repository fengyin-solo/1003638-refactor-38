/**
 * 离线运行 TS 脚本：用仓库自带的 esbuild 即时打包后再 import，不引入额外依赖。
 * 用法：node scripts/run-ts.mjs scripts/seed-build.ts
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { build } from 'esbuild'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import process from 'node:process'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

// node_modules 可能是在别的平台安装后拷贝过来的（如 macOS 装、Linux 跑），
// 显式指向当前平台二进制；没有对应目录时交还给 esbuild 默认解析。
const platformBinary = resolve(
  root,
  'node_modules',
  '@esbuild',
  `${process.platform}-${process.arch}`,
  'bin',
  'esbuild',
)
if (existsSync(platformBinary)) {
  process.env.ESBUILD_BINARY_PATH = platformBinary
}

const entryArg = process.argv[2]
if (!entryArg) {
  console.error('usage: node scripts/run-ts.mjs <entry.ts>')
  process.exit(2)
}
const entry = resolve(root, entryArg)
const outFile = resolve(tmpdir(), `run-ts-${process.pid}-${Date.now()}.mjs`)

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: outFile,
  logLevel: 'warning',
  alias: {
    '@': resolve(root, 'src'),
  },
})

try {
  await import(pathToFileURL(outFile).href)
} finally {
  rmSync(outFile, { force: true })
}
