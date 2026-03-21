# 阶段 1: 编译环境
FROM golang:1.21-alpine AS builder

# 核心：设置国内代理，解决 go mod download 超时
ENV GO111MODULE=on
ENV GOPROXY=https://goproxy.cn,direct

WORKDIR /app
# 先拷贝依赖文件，利用 Docker 缓存层
COPY go.mod go.sum ./
RUN go mod download

# 拷贝全量代码并编译
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o geo-server ./src/main.go

# 阶段 2: 运行环境
FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /root/
# 从编译阶段拷贝二进制文件
COPY --from=builder /app/geo-server .
# 别忘了拷贝静态文件（地图 HTML/JS）
COPY --from=builder /app/static ./static

EXPOSE 8080
CMD ["./geo-server"]
