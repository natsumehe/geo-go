package handler

import (
	"database/sql"
	"log"
	"net/http"
	"net/url"
	"sync"

	"github.com/redis/go-redis/v9"

	wsHub "geo/internal/service/websocket"
)

type ServerHandler struct {
	DB          *sql.DB
	RDB         *redis.Client
	Hub         *wsHub.Hub
	PosCache    *sync.Map
	KfStore     *sync.Map
	ValhallaURL *url.URL
}

func NewServerHandler(db *sql.DB, rdb *redis.Client, hub *wsHub.Hub, valhallaStr string) *ServerHandler {
	vURL, _ := url.Parse(valhallaStr)
	return &ServerHandler{
		DB:          db,
		RDB:         rdb,
		Hub:         hub,
		PosCache:    &sync.Map{},
		KfStore:     &sync.Map{},
		ValhallaURL: vURL,
	}
}

// WebSocket 订阅通道
func (h *ServerHandler) WebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := wsHub.Upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf(" [❌ WS 升级失败]: %v", err)
		return
	}
	h.Hub.AddClient(conn)
	defer h.Hub.RemoveClient(conn)
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}
}