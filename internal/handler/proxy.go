package handler

import (
	"net/http"
	"net/http/httputil"
)

// /route: Valhalla 反向代理机制
func (h *ServerHandler) RouteProxy(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "*")
	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	proxy := httputil.NewSingleHostReverseProxy(h.ValhallaURL)
	r.URL.Host = h.ValhallaURL.Host
	r.URL.Scheme = h.ValhallaURL.Scheme
	r.Host = h.ValhallaURL.Host
	r.Header.Set("X-Forwarded-Host", r.Header.Get("Host"))

	proxy.ServeHTTP(w, r)
}