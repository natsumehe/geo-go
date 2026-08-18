package main

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
	"strings"

	"crypto/tls"
	_ "github.com/lib/pq"
	"github.com/redis/go-redis/v9"

	"geo/internal/handler"
	"geo/internal/model"
	wsHub "geo/internal/service/websocket"
)

func main() {
	connStr := os.Getenv("DB_URL")
	if connStr == "" {
		connStr = "postgres://docker:floder123@localhost:5432/gis_db?sslmode=disable"
	}

	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		redisAddr = "geo-go-redis-1:6379"
	}

	rdb := redis.NewClient(&redis.Options{Addr: redisAddr})

	db, err := sql.Open("postgres", connStr)
	if err != nil {
		log.Fatalf("❌ 数据库驱动加载失败: %v", err)
	}

	for i := 0; i < 5; i++ {
		if err = db.Ping(); err == nil {
			fmt.Println("✅ PostGIS 数据库连接成功！")
			break
		}
		fmt.Printf("⚠️ 数据库连接尝试 (%d/5) 失败: %v，等待重试...\n", i+1, err)
		time.Sleep(2 * time.Second)
	}

	hub := wsHub.NewHub()

	valhallaURL := os.Getenv("VALHALLA_URL")
	if valhallaURL == "" {
		valhallaURL = "http://host.docker.internal:8002"
	}

	// 初始化核心 Controller 控制器
	appHandler := handler.NewServerHandler(db, rdb, hub, valhallaURL)

	// 清理过期卡尔曼滤波器的定时任务
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		for range ticker.C {
			now := time.Now()
			appHandler.KfStore.Range(func(key, value interface{}) bool {
				if filterState, ok := value.(*model.DeviceFilters); ok {
					if now.Sub(filterState.LastSeen) > 30*time.Minute {
						appHandler.KfStore.Delete(key)
					}
				}
				return true
			})
		}
	}()

	// 统一 API 路由注册
	http.HandleFunc("/list", appHandler.List)
	http.HandleFunc("/update", appHandler.Update)
	http.HandleFunc("/history", appHandler.History)
	http.HandleFunc("/fences", appHandler.Fences)
	http.HandleFunc("/alarms", appHandler.Alarms)
	http.HandleFunc("/tiles/", appHandler.Tile)
	http.HandleFunc("/route", appHandler.RouteProxy)
	http.HandleFunc("/ws", appHandler.WebSocket)
	http.HandleFunc("/ws/upload", appHandler.WebSocket)

	// =========================================================================
	// 🛡️ 静态文件与 React SPA 路由托管（健壮性修复版）
	// =========================================================================
	staticDir := "/app/static"
	if _, err := os.Stat(staticDir); os.IsNotExist(err) {
		staticDir = "./static"
	}

	fs := http.FileServer(http.Dir(staticDir))

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// 检查本地磁盘是否存在对应的物理文件（无论是文件还是目录，只要存在就直接交由 FileServer 处理）
		targetPath := staticDir + r.URL.Path
		
		if strings.HasSuffix(r.URL.Path, ".mjs") {
			w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		}

		log.Printf("🔍 请求路径: %s -> 映射磁盘路径: %s", r.URL.Path, targetPath)

		if r.URL.Path != "/" {
			if _, err := os.Stat(targetPath); err == nil {
				fs.ServeHTTP(w, r)
				return
			}
		}

		// 找不到物理文件时（说明是 React Router 的前端虚拟路由），统一回退返回 index.html
		r.URL.Path = "/"
		fs.ServeHTTP(w, r)
	})

	// =========================================================================
	// 启动 HTTP/HTTPS 双网关服务
	// =========================================================================
	
	// 1. 在 goroutine 中启动 HTTP 基础监听
	go func() {
		fmt.Println("🔓 HTTP 监控主服务已建立: 8080")
		if err := http.ListenAndServe(":8080", nil); err != nil {
			log.Printf("HTTP 服务异常: %v", err)
		}
	}()

	// 2. 配置 HTTPS Server
	srv := &http.Server{
		Addr: ":443",
		TLSConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
		},
	}

	fmt.Println("🔒 HTTPS 分发网关就绪（仅限 TLS 1.2+/1.3），拉起加密总线...")
	if err := srv.ListenAndServeTLS("/ssl/cert.pem", "/ssl/cert.key"); err != nil {
		log.Printf("⚠️ HTTPS 安全端口监听失败: %v", err)
		log.Println("💡 强退降级防御：保持 8080 纯 HTTP 信道单轨运行...")
		select {}
	}
}
