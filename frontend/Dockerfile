# 构建阶段：在容器内原生安装依赖，跑示例数据构建 + 上线前检查 + 生产构建。
FROM node:20-alpine AS build
WORKDIR /srv/web
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
# check:deploy = seed 构建 → 规则检查 → 类型检查 → vite build，任何一关失败都中止镜像构建
RUN npm run seed:build && npm run check:deploy

# 运行阶段：只托管静态产物，dev server 不进生产。
FROM nginx:1.27-alpine
COPY --from=build /srv/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
