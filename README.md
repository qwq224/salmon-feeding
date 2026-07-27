# 🐟 SalmonFeeding AI — 三文鱼智能投喂管理系统

AI 驱动的三文鱼（大西洋鲑/虹鳟）养殖管理平台，集成精准投喂计算、百万字级知识库 RAG 检索、Claude 智能问答、多端接入（Web/企业微信/飞书）。

---

## 功能概览

| 功能 | 说明 |
|------|------|
| 🧮 **投喂计算** | 四法并行（查表插值/科研模型/SGR生长/2025最新），7参数输入，中位数集成 |
| 📋 **投喂记录** | CRUD + 筛选排序 + CSV导出 + 统计摘要 |
| 📊 **数据分析** | ECharts 双轴趋势图 + FCR分析 + 智能异常预警 |
| 📚 **知识库** | 89篇文档 · 21万字 · BM25+向量混合检索 · 论文/标准/手册 |
| 🤖 **AI 助手** | Claude 多轮对话 + 联网搜索 + 来源追溯（[来源:N] 标记） |
| 💬 **企微/飞书** | 消息加解密 + 多轮记忆 + 卡片回复 |
| 🌐 **Web 前端** | 7页面单页应用，响应式布局，Ctrl+K 全局搜索 |

## 快速开始

```bash
# 安装依赖
npm install

# 配置 API Key
cp .env.example .env
# 编辑 .env 填入 ANTHROPIC_API_KEY

# 启动（会自动导入知识库）
npm start

# 打开浏览器
# http://localhost:3456
```

## 项目结构

```
salmon-feeding/
├── index.html              # 单页应用 UI (7页面)
├── js/
│   ├── app.js              # 主应用逻辑 (路由/搜索/仪表盘/AI对话)
│   ├── feeding.js          # 投喂计算引擎 (4法并行)
│   └── knowledge.js        # 前端知识库展示
├── css/style.css           # 完整 UI 样式
├── server/
│   ├── server.js           # Express 后端 (25+ API端点)
│   ├── rag.js              # RAG 引擎 (检索 + Claude 生成 + 联网搜索)
│   ├── embedder.js  🆕     # 语义向量服务 (Transformers.js + 备用)
│   ├── vector-store.js 🆕  # 混合检索存储 (BM25 + 向量 + RRF)
│   ├── doc-pipeline.js 🆕  # 文档摄入管道 (URL/PDF/文本)
│   ├── crawler.js    🆕    # 自动爬虫 (NOAA/GSA/Semantic Scholar)
│   ├── build-kb.js   🆕    # 知识库批量构建脚本
│   ├── full-build.js 🆕    # 完整构建 (本地文档 + 爬虫 + 论文)
│   ├── generate-docs.js🆕  # Claude API 批量生成专业文档
│   ├── vector-db.js        # 旧向量库 (PDF Embedding，已废弃)
│   ├── db.js               # JSON 文件存储 (记录/计划/日志)
│   ├── news-fetcher.js     # 行业新闻 RSS + 价格聚合
│   └── webhook-handler.js  # 企微 + 飞书机器人
├── data/
│   ├── knowledge/    🆕    # 10篇专业知识文档 (.md)
│   ├── chunks/       🆕    # 向量分片存储
│   ├── pdfs/               # 待索引 PDF 论文
│   └── records.json        # 投喂记录
├── docs/KNOWLEDGE_BASE.md  # 原始知识库 (86KB, 18章)
├── diary/            🆕    # 工作日志
├── run.js                  # 一键启动 (服务器+SSH隧道)
├── tunnel.js               # 双隧道保活 (Serveo)
└── package.json

🆕 = 知识库升级新增文件
```

## API 端点

### 投喂管理
| 端点 | 说明 |
|------|------|
| `GET /api/records` | 获取投喂记录 |
| `POST /api/records` | 添加记录 |
| `DELETE /api/records/:id` | 删除记录 |
| `POST /api/plan` | 保存投喂计划 |

### 知识库 (🆕)
| 端点 | 说明 |
|------|------|
| `GET /api/knowledge/stats` | 知识库统计 |
| `GET /api/knowledge/documents` | 文档列表 (支持 ?type= & ?q=) |
| `GET /api/knowledge/documents/:id` | 文档详情 + 完整块 |
| `DELETE /api/knowledge/documents/:id` | 删除文档 |
| `GET /api/knowledge/search?q=&type=&limit=` | 混合检索 |
| `POST /api/knowledge/ingest` | 摄入文档 (URL/文本) |
| `POST /api/knowledge/upload` | 上传文件摄入 |
| `POST /api/knowledge/crawl` | 启动自动爬虫 |
| `POST /api/knowledge/import-news` | 导入 RSS 新闻 |
| `POST /api/knowledge/import-pdfs` | 批量导入 PDF |
| `POST /api/knowledge/reindex` | 重建索引 |
| `GET /api/knowledge/model-download-script` | Embedding 模型下载脚本 |

### AI 对话
| 端点 | 说明 |
|------|------|
| `POST /api/rag` | 单轮 RAG 问答 |
| `POST /api/chat` | 多轮对话 (支持 history + searchWeb) |
| `GET /api/knowledge?q=` | 关键词搜索 |

### 其他
| 端点 | 说明 |
|------|------|
| `GET /api/news` | 行业新闻 |
| `GET /api/prices` | 三文鱼价格 |
| `ALL /api/webhook/wecom` | 企业微信机器人 |
| `POST /api/webhook/feishu` | 飞书机器人 |
| `GET /api/vector-status` | 向量库状态 |

## 知识库架构

```
文档来源
  ├── 本地 .md 文件 (data/knowledge/*.md)
  ├── RSS 新闻 (news-fetcher.js 自动抓取)
  ├── PDF 论文 (data/pdfs/ → 自动解析索引)
  ├── Web 爬虫 (NOAA / GSA / FAO)
  ├── 学术 API (Semantic Scholar 论文摘要)
  └── Claude 生成 (generate-docs.js)

         ↓ doc-pipeline.js
    文本提取 → 智能分块 → 元数据提取 (标题/章节/作者/日期/来源)
         ↓ embedder.js
    Transformers.js (主) 或 增强 n-gram (备用) → 384维向量
         ↓ vector-store.js
    BM25 倒排索引 + 向量相似度 → RRF 融合 → Top-K
         ↓ rag.js
    Claude API 生成回答 + [来源:N] 标注 + 可展开来源卡片
```

## 提升文档量的方法

```bash
# 1. 写 .md 文件放入 data/knowledge/ → 重建
node server/full-build.js

# 2. 放 PDF 论文 → 自动解析
cp *.pdf data/pdfs/
curl -X POST http://localhost:3456/api/knowledge/import-pdfs

# 3. Claude API 批量生成专业文档
node server/generate-docs.js

# 4. 爬取外部网站 (NOAA/GSA)
curl -X POST http://localhost:3456/api/knowledge/crawl \
  -d '{"crawlWeb":true,"searchPapers":true}'

# 5. 摄入单个 URL
curl -X POST http://localhost:3456/api/knowledge/ingest \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/article"}'
```

## 投喂计算引擎

四法并行计算，取中位数推荐：

| 方法 | 模型 | 来源 |
|------|------|------|
| 查表插值法 | 8水温×11体重级双线性插值 + 高温/大鱼/溶氧修正 | 《水产动物营养与饲料学》 |
| 科研模型法 | FI = α×BW^β×e^(γT)×h(DO) | Azevedo et al. 2026 |
| SGR生长法 | SGR→投喂率映射 + 氮磷排放估算 | FAO + 孙国祥 2014 |
| 2025最新模型 | FI = 0.006×BW^0.80×exp(0.287T−0.012T²)×h(DO) | Azevedo et al. 2025 |

每次计算集成：综合评分/环境修正/7天预测/生长阶段分析/经济概算/FCR 分析/风险提示。

## 技术栈

- **前端**: Vanilla JS + ECharts 5.5 + Marked
- **后端**: Node.js 24 + Express 4.18
- **AI**: Claude API (Sonnet 5) + Transformers.js (可选)
- **检索**: BM25 关键词 + 384维向量 + RRF 融合
- **分词**: 中文 bigram + 英文单词混合
- **存储**: JSON 文件 + 分片向量库
- **机器人**: 企业微信 (AES加密) + 飞书 (卡片消息)

## 环境要求

- Node.js ≥18
- Anthropic API Key (Claude)
- 可选: Visual Studio 2022 + C++ 工具链 (Transformers.js 本地模型需要)
- 可选: 企微/飞书开发者账号 (机器人功能)

## 已知限制

- **Embedding**: Hugging Face 被墙，Transformers.js 模型无法下载，使用增强 n-gram 备用方案
- **学术论文**: Semantic Scholar API 免费但限流严重 (429)，需要 30s+ 调用间隔
- **中文源**: fishfirst.cn 等国内网站从当前网络环境访问异常

## License

MIT
