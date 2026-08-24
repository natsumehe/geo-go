package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"
)

type ChatRequest struct {
	CharacterID string `json:"character_id"`
	Message     string `json:"message"`
}

type ChatResponse struct {
	Reply string `json:"reply"`
}

func HandleQwenChat(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != http.MethodPost {
		writeJSONError(
			w,
			http.StatusMethodNotAllowed,
			"method not allowed",
		)
		return
	}

	var req ChatRequest

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf(
			"❌ /api/chat JSON 解析失败: %v",
			err,
		)

		writeJSONError(
			w,
			http.StatusBadRequest,
			"invalid request body",
		)
		return
	}

	if req.Message == "" {
		writeJSONError(
			w,
			http.StatusBadRequest,
			"message is empty",
		)
		return
	}

	if req.CharacterID == "" {
		req.CharacterID = "guide"
	}

	apiKey := os.Getenv("DASHSCOPE_API_KEY")

	if apiKey == "" {
		log.Println(
			"❌ DASHSCOPE_API_KEY 未配置",
		)

		writeJSONError(
			w,
			http.StatusInternalServerError,
			"AI API Key not configured",
		)
		return
	}

	aiReqBody := map[string]interface{}{
		"model": "qwen-plus",
		"messages": []map[string]string{
			{
				"role":    "system",
				"content": getPersona(req.CharacterID),
			},
			{
				"role":    "user",
				"content": req.Message,
			},
		},
	}

	jsonBytes, err := json.Marshal(aiReqBody)

	if err != nil {
		log.Printf(
			"❌ Qwen 请求 JSON 创建失败: %v",
			err,
		)

		writeJSONError(
			w,
			http.StatusInternalServerError,
			"failed to build AI request",
		)
		return
	}

	log.Printf(
		"🤖 AI 请求 character_id=%s message=%q",
		req.CharacterID,
		req.Message,
	)

	httpReq, err := http.NewRequest(
		http.MethodPost,
		"https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
		bytes.NewBuffer(jsonBytes),
	)

	if err != nil {
		log.Printf(
			"❌ 创建 Qwen HTTP 请求失败: %v",
			err,
		)

		writeJSONError(
			w,
			http.StatusInternalServerError,
			"failed to create AI request",
		)
		return
	}

	httpReq.Header.Set(
		"Content-Type",
		"application/json",
	)

	httpReq.Header.Set(
		"Authorization",
		"Bearer "+apiKey,
	)

	client := &http.Client{
		Timeout: 60 * time.Second,
	}

	resp, err := client.Do(httpReq)

	if err != nil {
		log.Printf(
			"❌ Qwen HTTP 请求失败: %v",
			err,
		)

		writeJSONError(
			w,
			http.StatusBadGateway,
			"AI service connection failed",
		)
		return
	}

	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)

	if err != nil {
		log.Printf(
			"❌ 读取 Qwen 响应失败: %v",
			err,
		)

		writeJSONError(
			w,
			http.StatusBadGateway,
			"failed to read AI response",
		)
		return
	}

	log.Printf(
		"🤖 Qwen HTTP 状态码: %d",
		resp.StatusCode,
	)

	log.Printf(
		"🤖 Qwen 原始响应: %s",
		string(respBody),
	)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		log.Printf(
			"❌ Qwen API 返回错误: status=%d body=%s",
			resp.StatusCode,
			string(respBody),
		)

		writeJSONError(
			w,
			http.StatusBadGateway,
			fmt.Sprintf(
				"AI service returned status %d",
				resp.StatusCode,
			),
		)
		return
	}

	var qwenResp map[string]interface{}

	if err := json.Unmarshal(
		respBody,
		&qwenResp,
	); err != nil {
		log.Printf(
			"❌ Qwen JSON 解析失败: %v",
			err,
		)

		writeJSONError(
			w,
			http.StatusBadGateway,
			"invalid AI response",
		)
		return
	}

	replyText := extractContent(qwenResp)

	if replyText == "" {
		log.Printf(
			"❌ Qwen 返回内容为空",
		)

		writeJSONError(
			w,
			http.StatusBadGateway,
			"AI returned empty response",
		)
		return
	}

	log.Printf(
		"✅ AI 回复: %s",
		replyText,
	)

	w.WriteHeader(http.StatusOK)

	json.NewEncoder(w).Encode(
		ChatResponse{
			Reply: replyText,
		},
	)
}

func getPersona(id string) string {
	switch id {
	case "guide":
		return "你是一个赛博朋克地图应用中的智能导游角色，说话简洁、富有科技感。回答控制在3到4行左右，每行大约12到16个字。不要输出动作描写，不要使用星号，不要输出选项列表，不要输出额外提示。"

	default:
		return "你是一个游戏 NPC。回答简洁，不要输出动作描写和选项列表。"
	}
}

func extractContent(resp map[string]interface{}) string {
	choices, ok := resp["choices"].([]interface{})

	if !ok || len(choices) == 0 {
		return ""
	}

	choice, ok := choices[0].(map[string]interface{})

	if !ok {
		return ""
	}

	message, ok := choice["message"].(map[string]interface{})

	if !ok {
		return ""
	}

	content, ok := message["content"].(string)

	if !ok {
		return ""
	}

	return content
}

func writeJSONError(
	w http.ResponseWriter,
	status int,
	message string,
) {
	w.WriteHeader(status)

	json.NewEncoder(w).Encode(
		map[string]string{
			"error": message,
		},
	)
}
