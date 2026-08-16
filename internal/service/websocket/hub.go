package websocket

import (
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

var Upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Hub struct {
	clients map[*websocket.Conn]bool
	mu      sync.RWMutex
}

func NewHub() *Hub {
	return &Hub{
		clients: make(map[*websocket.Conn]bool),
	}
}

func (h *Hub) AddClient(conn *websocket.Conn) {
	h.mu.Lock()
	h.clients[conn] = true
	h.mu.Unlock()
}

func (h *Hub) RemoveClient(conn *websocket.Conn) {
	h.mu.Lock()
	delete(h.clients, conn)
	h.mu.Unlock()
	conn.Close()
}

func (h *Hub) NotifyClients(msg string) {
	h.mu.RLock()
	var targetClients []*websocket.Conn
	for client := range h.clients {
		targetClients = append(targetClients, client)
	}
	h.mu.RUnlock()

	for _, client := range targetClients {
		go func(c *websocket.Conn) {
			err := c.WriteMessage(websocket.TextMessage, []byte(msg))
			if err != nil {
				h.RemoveClient(c)
			}
		}(client)
	}
}
