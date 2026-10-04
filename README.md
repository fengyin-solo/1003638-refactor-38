# 森林防火巡护管理系统

面向森林火险监测、巡护任务调度、防火设施维护与应急响应指挥的林区防火管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据(seed.json) / localStorage 持久化
│   ├── src/shared/           共用状态规则（浏览器与 Node 脚本同用一份）
│   ├── src/stores/           会话与筛选状态
│   ├── scripts/              示例数据构建 build-seed / 部署检查 deploy-check
│   ├── data/                 上线前旧数据快照（补全输入）
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── Makefile                  install / frontend / build / seed / check
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。
`npm run dev` 前会自动确认示例数据已构建（`predev` 钩子，缺失时才重建）。

生产构建：

```bash
cd frontend
npm run build
```

## 上线前检查

```bash
cd frontend
npm run seed    # 示例数据构建：旧数据补全后写回 src/data/seed.json
npm run check   # 部署检查：构建产物、状态规则自检、逐样地校验
```

`npm run check` 逐样地校验时把进度写在 `frontend/.deploy-check.state.json`，
每通过一个样地就落盘；检查中断后重跑会自动跳过已通过样地，从缺失样地继续，
全部通过后状态文件自动清除。仓库根目录也可以用 `make seed` / `make check`。

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 巡护任务 | `patrol` | 巡护任务 | 任务编号、巡护区域、巡护路线 |
| 火险监测 | `firewatch` | 火险监测点 | 监测点编号、监测区域、火险等级 |
| 瞭望台管理 | `lookout` | 瞭望台 | 瞭望台编号、所在山头、海拔高度 |
| 防火隔离带 | `firebreak` | 防火隔离带 | 隔离带编号、所属林区、起止坐标 |
| 扑火队伍 | `fireteam` | 扑火队伍 | 队伍编号、队伍名称、所属林场 |
| 消防装备 | `equipment` | 消防装备 | 装备编号、装备名称、装备类型 |
| 气象观测 | `weather` | 气象观测记录 | 记录编号、观测站点、观测时间 |
| 火情报告 | `firereport` | 火情报告 | 报告编号、起火地点、起火时间 |
| 无人机巡查 | `drone` | 无人机巡查任务 | 任务编号、飞行区域、飞行路线 |
| 防火宣传 | `campaign` | 防火宣传活动 | 活动编号、宣传主题、宣传方式 |
| 防火检查站 | `checkpoint` | 防火检查站 | 站点编号、站点位置、值守人员 |
| 值勤排班 | `duty` | 值勤排班表 | 排班编号、值勤日期、值勤时段 |
| 物资储备 | `supply` | 防火物资 | 物资编号、物资名称、物资类别 |
| 林区道路 | `forestroad` | 林区道路 | 道路编号、道路名称、起点位置 |
| 防火林带 | `firebelt` | 防火林带 | 林带编号、林带名称、所属林区 |
| 应急演练 | `drill` | 应急演练 | 演练编号、演练主题、参演队伍 |
| 焚烧审批 | `burnpermit` | 用火审批单 | 审批编号、申请单位、用火类型 |
| 林木生长 | `treegrowth` | 林木生长记录 | 记录编号、样地编号、林分类型 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.json`，由 `npm run seed` 构建。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `forest-fire-patrol:entries` 这一项，或调用 `resetModule(模块)`。

## 林木生长的共用状态规则

录入、复核、归档三个入口共用 `frontend/src/shared/treegrowth-rules.mjs` 这一份规则
（纯 ESM，页面、本地服务、构建脚本、部署检查都从这里取）：

- 状态机：`已录入 → 已审核 → 已归档`，审核后也可 `要求复核` 回到 `需复核`，
  复核后 `复核通过 / 复核不通过` 分别进入 `已审核 / 已录入`。
- `已归档` 是终态：记录锁定，任何动作都会被拒绝。
- `要求复核` 会把旧测量值（平均胸径/平均树高/郁闭度）快照进历史并清空，
  记录上不再残留旧值；`复核通过` 必须随动作提交重新测量的三项指标。
- 每次流转都写一条带 `调查批次` 的历史记录（本地库 `treegrowth-history`），
  页面「历史」按钮可查。
- 复核是幂等的：只有 `需复核` 状态能落复核结果，并发或重复提交只会落一次。
- 旧数据缺 `调查员 / 林分类型 / 调查批次` 时按 `BACKFILL_DEFAULTS` 补默认值
  （待补录 / 待定林分 / 历史批次），`样地编号` 一律不动；浏览器里的旧数据
  在加载时自动补全，`data/legacy-treegrowth.json` 里的旧数据由 `npm run seed` 补全。
- 防火林带页面的「林带建议清单」同步使用复核结果：需复核的样地建议优先补植，
  复核通过的样地建议常规巡查。
