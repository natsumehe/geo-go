package main

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

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
	
		// 🎯 修改 1：将 REDIS_URL 改为 REDIS_ADDR，并对齐 docker-compose 的服务名
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
	
		// 🎯 修改 2：Valhalla 路由地址从环境变量读取，更具灵活性
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

	// 统一路由注册
	http.HandleFunc("/list", appHandler.List)
	http.HandleFunc("/update", appHandler.Update)
	http.HandleFunc("/history", appHandler.History)
	http.HandleFunc("/fences", appHandler.Fences)
	http.HandleFunc("/alarms", appHandler.Alarms)
	http.HandleFunc("/tiles/", appHandler.Tile)
	http.HandleFunc("/route", appHandler.RouteProxy)
	http.HandleFunc("/ws", appHandler.WebSocket)
	http.HandleFunc("/ws/upload", appHandler.WebSocket)

	// 静态文件配置
	staticDir := "/app/static"
	if _, err := os.Stat(staticDir); os.IsNotExist(err) {
		staticDir = "./static"
	}
	fs := http.FileServer(http.Dir(staticDir))
	http.Handle("/static/", http.StripPrefix("/static/", fs))
	http.Handle("/", fs)

	// 启动 HTTP/HTTPS 双门路服务
	go func() {
		fmt.Println("🔓 HTTP 监控主服务已建立: 8080")
		_ = http.ListenAndServe(":8080", nil)
	}()

	fmt.Println("🔒 HTTPS 分发网关就绪，拉起加密总线...")
	if err := http.ListenAndServeTLS(":443", "/ssl/cert.pem", "/ssl/cert.key", nil); err != nil {
		log.Printf("⚠️ HTTPS 安全端口监听失败: %v", err)
		log.Println("💡 强退降级防御：保持 8080 纯 HTTP 信道单轨运行...")
		select {}
	}
}