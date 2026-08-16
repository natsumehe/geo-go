# =========================================================================
# 阶段 1: 前端静态资源编译 (React / Vite)
# =========================================================================
FROM node:18-alpine AS frontend-builder
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# =========================================================================
# 阶段 2: Go 后端编译环境
# =========================================================================
FROM golang:1.21-alpine AS backend-builder
ENV GO111MODULE=on
ENV GOPROXY=https://goproxy.cn,direct
WORKDIR /app

# 拷贝 Go 模块依赖文件
COPY go.mod go.sum ./
RUN go mod download

# 拷贝整体后端源码
COPY . .

# 🎯 核心修改：从前端阶段构建好的产物 (dist) 复制到后端的 static 目录中
# 根据你的 Vite 配置，打包产物通常在 web/dist，我们将其移到后端期望的 ./static
COPY --from=frontend-builder /web/dist ./static

# 🎯 核心修改：入口文件真实路径为 cmd/server/main.go
RUN CGO_ENABLED=0 GOOS=linux go build -o geo-server ./cmd/server/main.go

# =========================================================================
# 阶段 3: 极简生产运行环境
# =========================================================================
FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /app

# 从后端编译阶段拷贝二进制服务
COPY --from=backend-builder /app/geo-server .

# 从后端编译阶段拷贝已包含前端产物的 static 目录
COPY --from=backend-builder /app/static ./static

EXPOSE 8080
EXPOSE 443

CMD ["./geo-server"]