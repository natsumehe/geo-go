package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
)

type ChatRequest struct {
	CharacterID string `json:"character_id"`
	Message     string `json:"message"`
}

func HandleQwenChat(w http.ResponseWriter, r *http.Request) {
	// 生产/开发跨域头支持
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	var req ChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	apiKey := os.Getenv("DASHSCOPE_API_KEY")
	if apiKey == "" {
		http.Error(w, "AI API Key not configured", http.StatusInternalServerError)
		return
	}

	// 组装阿里云千问请求
	aiReqBody := map[string]interface{}{
		"model": "qwen-plus",
		"messages": []map[string]string{
			{"role": "system", "content": getPersona(req.CharacterID)},
			{"role": "user", "content": req.Message},
		},
	}
	jsonBytes, _ := json.Marshal(aiReqBody)

	httpReq, _ := http.NewRequest("POST", "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", bytes.NewBuffer(jsonBytes))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{}
	resp, err := client.Do(httpReq)
	if err != nil || resp.StatusCode != http.StatusOK {
		http.Error(w, "AI service error", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	var qwenResp map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&qwenResp)

	replyText := extractContent(qwenResp)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"reply": replyText,
	})
}

func getPersona(id string) string {
	switch id {
	case "guide":
		return "你是一个赛博朋克地图应用中的智能导游角色，说话简洁、富有科技感。"
	default:
		return "你是一个游戏 NPC。"
	}
}

func extractContent(resp map[string]interface{}) string {
	if choices, ok := resp["choices"].([]interface{}); ok && len(choices) > 0 {
		if choice, ok := choices[0].(map[string]interface{}); ok {
			if msg, ok := choice["message"].(map[string]interface{}); ok {
				if content, ok := msg["content"].(string); ok {
					return content
				}
			}
		}
	}
	return "信号迷失了..."
}
