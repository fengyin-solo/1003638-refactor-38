.PHONY: install frontend build seed check

install:
	cd frontend && npm install

frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

seed:
	cd frontend && npm run seed

check:
	cd frontend && npm run check
