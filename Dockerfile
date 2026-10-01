# 云端运行环境（Fly.io）：轻量 Node 镜像
FROM node:20-alpine

WORKDIR /app

# 先复制依赖清单，利用 Docker 缓存
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# 复制游戏代码与静态资源
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
