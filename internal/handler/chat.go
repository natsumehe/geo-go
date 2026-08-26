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

	"geo/internal/config"
)

type ChatRequest struct {
	CharacterID string `json:"character_id"`
	Message     string `json:"message"`
}

type ChatResponse struct {
	Reply string `json:"reply"`
}

type QwenResponse struct {
	Choices []QwenChoice `json:"choices"`
}

type QwenChoice struct {
	Message QwenMessage `json:"message"`
}

type QwenMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func HandleQwenChat(
	w http.ResponseWriter,
	r *http.Request,
) {
	w.Header().Set(
		"Access-Control-Allow-Origin",
		"*",
	)

	w.Header().Set(
		"Access-Control-Allow-Headers",
		"Content-Type, Authorization",
	)

	w.Header().Set(
		"Access-Control-Allow-Methods",
		"POST, OPTIONS",
	)

	w.Header().Set(
		"Content-Type",
		"application/json; charset=utf-8",
	)

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

	req.Message = trimString(req.Message)

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

	log.Printf(
		"📨 收到 NPC 请求 character_id=%s message=%q",
		req.CharacterID,
		req.Message,
	)

	aiConfig, err := config.LoadAIConfig(
		req.CharacterID,
	)

	if err != nil {
		log.Printf(
			"❌ AI 配置加载失败 character_id=%s error=%v",
			req.CharacterID,
			err,
		)

		writeJSONError(
			w,
			http.StatusInternalServerError,
			"AI configuration not found",
		)

		return
	}

	log.Printf(
		"🤖 AI 配置加载成功 character_id=%s model=%s temperature=%.2f",
		aiConfig.ID,
		aiConfig.Model,
		aiConfig.Temperature,
	)

	apiKey := os.Getenv(
		"DASHSCOPE_API_KEY",
	)

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
		"model": aiConfig.Model,

		"messages": []map[string]string{
			{
				"role":    "system",
				"content": aiConfig.SystemPrompt,
			},
			{
				"role":    "user",
				"content": req.Message,
			},
		},

		"temperature": aiConfig.Temperature,
	}

	if aiConfig.MaxTokens > 0 {
		aiReqBody["max_tokens"] = aiConfig.MaxTokens
	}

	jsonBytes, err := json.Marshal(
		aiReqBody,
	)

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
		"🤖 Qwen 请求 character_id=%s message=%q",
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

	respBody, err := io.ReadAll(
		resp.Body,
	)

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

	if resp.StatusCode < 200 ||
		resp.StatusCode >= 300 {

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

	var qwenResp QwenResponse

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

	replyText := extractQwenContent(
		&qwenResp,
	)

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

	replyText = cleanAIReply(
		replyText,
	)

	if replyText == "" {
		log.Printf(
			"❌ 清理后的 AI 回复为空",
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

	w.WriteHeader(
		http.StatusOK,
	)

	if err := json.NewEncoder(w).Encode(
		ChatResponse{
			Reply: replyText,
		},
	); err != nil {
		log.Printf(
			"❌ 返回 Godot JSON 失败: %v",
			err,
		)
	}
}

func extractQwenContent(
	resp *QwenResponse,
) string {
	if resp == nil {
		return ""
	}

	if len(resp.Choices) == 0 {
		return ""
	}

	content := resp.Choices[0].Message.Content

	return trimString(content)
}

func cleanAIReply(
	text string,
) string {
	text = trimString(text)

	if len(text) >= 7 &&
		text[:7] == "```json" {
		text = text[7:]
	}

	if len(text) >= 3 &&
		text[:3] == "```" {
		text = text[3:]
	}

	if len(text) >= 3 &&
		text[len(text)-3:] == "```" {
		text = text[:len(text)-3]
	}

	return trimString(text)
}

func trimString(
	text string,
) string {
	for len(text) > 0 {
		switch text[0] {
		case ' ', '\t', '\n', '\r':
			text = text[1:]
		default:
			goto right
		}
	}

right:

	for len(text) > 0 {
		last := text[len(text)-1]

		switch last {
		case ' ', '\t', '\n', '\r':
			text = text[:len(text)-1]
		default:
			return text
		}
	}

	return text
}

func writeJSONError(
	w http.ResponseWriter,
	status int,
	message string,
) {
	w.Header().Set(
		"Content-Type",
		"application/json; charset=utf-8",
	)

	w.WriteHeader(status)

	_ = json.NewEncoder(w).Encode(
		map[string]string{
			"error": message,
		},
	)
}
