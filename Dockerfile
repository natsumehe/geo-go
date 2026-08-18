# ========================================
# Stage 1: Frontend build
# ========================================

FROM node:20-alpine AS frontend-builder

WORKDIR /app/web

COPY web/package.json web/package-lock.json ./

RUN npm ci

COPY web/ ./

RUN npm run build


# ========================================
# Stage 2: Go build
# ========================================

FROM golang:1.24-alpine AS backend-builder

ENV GO111MODULE=on
ENV GOPROXY=https://goproxy.cn,direct

WORKDIR /app

COPY go.mod go.sum ./

RUN go mod download

COPY . .

# Copy frontend build result
COPY --from=frontend-builder /app/web/dist /app/static

# Build Go server
RUN CGO_ENABLED=0 GOOS=linux \
    go build -o geo-server ./cmd/server/main.go


# ========================================
# Stage 3: Production
# ========================================

FROM alpine:latest

RUN apk --no-cache add ca-certificates

WORKDIR /app

COPY --from=backend-builder /app/geo-server .
COPY --from=backend-builder /app/static ./static

EXPOSE 8080
EXPOSE 443

CMD ["./geo-server"]
