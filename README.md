# <img src="image-1.png" width="25" height="25"> 前后端地图系统构建
     本项目是一个高性能的 LBS（基于位置的服务）与 GIS 实时监控及移动采集系统。系统采用前后端分离架构，前端基于 React/Vite 与 MapLibre GL 构建大屏监控与移动端采集双模界面，后端基于 Go 语言开发，深度集成 PostGIS 空间数据库、Redis 实时状态队列以及 Valhalla 高性能导航拓扑引擎。

### 技术栈 React + TypeScript + Vite + GO + Redis +PostGIS + Maplibre-gl + valhalla

## 项目结构说明
``` 
├── cmd
│   └── server
│       └── main.go          # 🚀 后端服务唯一入口（初始化路由、数据库、WebSocket、静态托管）
├── deploy
│   └── postgres
│       └── potsgis.sql      # 💾 PostGIS 空间数据库初始化脚本（空间表、路网/围栏定义）
├── go.mod / go.sum          # 📦 Go 依赖管理文件
├── internal
│   ├── filter
│   │   └── kalmain.go       # 🧮 卡尔曼滤波算法（用于移动轨迹平滑处理与降噪）
│   ├── handler
│   │   ├── device.go        # 📡 设备列表与历史轨迹接口控制
│   │   ├── fence.go         # 🚧 地理围栏告警与逻辑处理
│   │   ├── handler.go       # ⚙️ 核心 ServerHandler 结构体及依赖注入
│   │   ├── proxy.go         # 🔀 导航与第三方路由代理 (Valhalla 转发)
│   │   └── tile.go          # 🗺️ MVT 矢量切片渲染输出处理
│   ├── model
│   │   └── device.go        # 📊 数据模型定义（设备状态、坐标、过滤结构）
│   ├── service
│   │   ├── distance.go      # 📐 空间距离计算与几何分析工具
│   │   └── websocket
│   │       └── hub.go       # 🔌 WebSocket 连接池管理与实时消息广播分发
│   └── store
│       └── mvt.go           # 🗄️ 矢量切片（MVT）底层生成与查询逻辑
├── web                      # ⚛️ React 前端单页应用 (SPA)
│   ├── index.html           # HTML 挂载模板
│   ├── src
│   │   ├── App.tsx          # 根组件（双模视图切换、全局状态管理）
│   │   ├── components
│   │   │   ├── LeftDevicePanel.tsx   # 左侧设备列表与状态控制面板
│   │   │   ├── MapContainer.tsx      # MapLibre GL 地图容器与 MVT 图层渲染
│   │   │   ├── MobileCollector.tsx   # 移动端采集模拟器界面
│   │   │   └── RightControlPanel.tsx # 右侧控制面板与分析工具
│   │   ├── hooks
│   │   │   ├── useGeoCollector.ts    # 采集端业务逻辑 Hook
│   │   │   └── useValhallaRouting.ts # 导航路径规划 Hook
│   │   └── main.tsx         # 前端渲染入口
│   ├── vite.config.ts       # Vite 构建与本地开发代理配置
│   └── tsconfig.*.json      # TypeScript 配置
└── docker-compose.yml       # 🐳 多容器编排（Go应用 + Redis + Valhalla引擎）
```
### 系统运行环境要求
    操作系统：Linux (推荐 Ubuntu 20.04/22.04 阿里云服务器) / macOS (本地开发)
    容器化：Docker 20.10+ & Docker Compose 2.0+
    数据: Openstreetmap 2026年上海路网数据
    硬件建议（含 Valhalla 路网数据）：
        内存：至少 4GB
        存储：视 Valhalla 离线瓦片及 PostGIS 空间数据大小而定（建议 20GB 以上空间）
![Alt text](image.png)