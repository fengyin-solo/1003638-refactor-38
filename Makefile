.PHONY: install seed frontend build check deploy-check

install:
	cd frontend && npm install

# 示例数据构建：改完 scripts/seed-build.ts 后必须重新生成并提交产物
seed:
	cd frontend && npm run seed:build

frontend:
	cd frontend && npm run dev

# 本地构建（先跑示例数据构建与上线前规则检查，再类型检查与打包）
build:
	cd frontend && npm run seed:build && npm run build

# 上线前部署检查：示例数据一致性 + 状态机/复核/并发/断点续检规则 + 类型检查 + 生产构建
check deploy-check:
	cd frontend && npm run check:deploy
