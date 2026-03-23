# 阶段 1: 编译环境
FROM golang:1.21-alpine AS builder
ENV GO111MODULE=on
ENV GOPROXY=https://goproxy.cn,direct
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# 编译时直接指向 src/main.go
RUN CGO_ENABLED=0 GOOS=linux go build -o geo-server ./src/main.go

# 阶段 2: 运行环境
FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /app
# 拷贝二进制
COPY --from=builder /app/geo-server .
# 拷贝静态文件
COPY --from=builder /app/static ./static
# 【新增】必须拷贝证书文件，否则 HTTPS 无法启动
COPY --from=builder /app/server.crt .
COPY --from=builder /app/server.key .

EXPOSE 8080
EXPOSE 443
CMD ["./geo-server"]