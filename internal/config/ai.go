package config

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"gopkg.in/yaml.v3"
)

type AIConfig struct {
	ID           string  `yaml:"id"`
	Model        string  `yaml:"model"`
	Temperature  float64 `yaml:"temperature"`
	MaxTokens    int     `yaml:"max_tokens"`
	SystemPrompt string  `yaml:"system_prompt"`
}

var (
	configCache = make(map[string]*AIConfig)

	configMutex sync.RWMutex
)

func LoadAIConfig(
	id string,
) (*AIConfig, error) {

	// --------------------------------------------------------
	// 先查缓存
	// --------------------------------------------------------

	configMutex.RLock()

	cached, ok :=
		configCache[id]

	configMutex.RUnlock()

	if ok {
		return cached, nil
	}

	// --------------------------------------------------------
	// 配置文件路径
	// --------------------------------------------------------

	path := filepath.Join(
		"internal",
		"config",
		"ai",
		id+".yaml",
	)

	// --------------------------------------------------------
	// 读取 YAML
	// --------------------------------------------------------

	data, err := os.ReadFile(
		path,
	)

	if err != nil {

		return nil, fmt.Errorf(
			"read AI config %s: %w",
			id,
			err,
		)
	}

	// --------------------------------------------------------
	// YAML -> Go Struct
	// --------------------------------------------------------

	var config AIConfig

	if err := yaml.Unmarshal(
		data,
		&config,
	); err != nil {

		return nil, fmt.Errorf(
			"parse AI config %s: %w",
			id,
			err,
		)
	}

	// --------------------------------------------------------
	// 默认 ID
	// --------------------------------------------------------

	if config.ID == "" {
		config.ID = id
	}

	// --------------------------------------------------------
	// 默认 Model
	// --------------------------------------------------------

	if config.Model == "" {
		config.Model = "qwen-plus"
	}

	// --------------------------------------------------------
	// 放入缓存
	// --------------------------------------------------------

	configMutex.Lock()

	configCache[id] =
		&config

	configMutex.Unlock()

	return &config, nil
}
