# CLAUDE.md — 项目记忆与需求记录

> 每次启动新会话时，Claude 会自动读取此文件。请保持更新。
> 最后一次更新: 2026-07-27
>
> ⚠️ **重要规则**: 对系统做的每一项改动都必须记录到本文档的「改动日志」中。
> 新增/修改/删除文件、安装依赖、配置变更 — 全部记录，不允许遗漏。

---

## 零、改动日志 (Changelog)

> 格式: `YYYY-MM-DD | 类型 | 文件 | 摘要`
> 类型: NEW / MOD / DEL / DEP (依赖) / CFG (配置)

### 2026-07-27

| 类型 | 文件 | 摘要 |
|------|------|------|
| NEW | `CLAUDE.md` | 项目记忆文件，记录需求、状态、改动日志 |
| NEW | `README.md` | 完整项目文档 |
| NEW | `server/embedder.js` | 语义向量服务：主方案 Transformers.js + 备用增强 n-gram |
| NEW | `server/vector-store.js` | BM25 + 384维向量 + RRF 混合检索存储 |
| NEW | `server/doc-pipeline.js` | 文档摄入管道：URL/PDF/文本 + 智能分块 |
| NEW | `server/crawler.js` | 自动爬虫：NOAA/GSA/Semantic Scholar + 内置文档 |
| NEW | `server/build-kb.js` | 知识库批量构建脚本 |
| NEW | `server/full-build.js` | 完整构建：本地文档 + 爬虫 + 论文 |
| NEW | `server/generate-docs.js` | Claude API 批量生成专业知识文档 |
| NEW | `data/knowledge/01-water-quality.md` | 水质管理完全手册 |
| NEW | `data/knowledge/02-feeding-nutrition.md` | 饲料营养与精准投喂 |
| NEW | `data/knowledge/03-ras-engineering.md` | RAS 循环水系统工程指南 |
| NEW | `data/knowledge/04-economics-market.md` | 经济分析与市场研究 |
| NEW | `data/knowledge/05-disease-biosecurity.md` | 疾病防控与生物安全 |
| NEW | `data/knowledge/06-breeding-smolt.md` | 苗种培育与降海驯化 |
| NEW | `data/knowledge/07-harvest-sustainability.md` | 收获加工与可持续发展 |
| NEW | `data/knowledge/08-feeding-strategy-comprehensive.md` | 精准投喂策略综合指南 |
| NEW | `data/knowledge/09-industry-standards.md` | 行业标准与法规汇编 |
| NEW | `data/knowledge/10-research-review.md` | 学术论文综述 (8篇文献) |
| NEW | `diary/` | 工作日志目录 |
| NEW | `diary/20260727-1430-salmon-feeding.md` | 今日工作日志 |
| MOD | `server/rag.js` | 替换硬编码 KEYWORD_MAP → vector-store 混合检索；增强来源元数据 |
| MOD | `server/server.js` | 新增 11 个知识管理 API 端点；启动时自动导入知识库 |
| MOD | `js/app.js` | 动态文档库 + AI 溯源卡片增强 + 摄入弹窗逻辑 |
| MOD | `index.html` | 知识库页面改造 + 摄入文档弹窗 HTML |
| MOD | `.gitignore` | data/*.json + data/chunks/ + data/pdfs/ (保留 knowledge .md) |
| DEP | `package.json` | 新增 @xenova/transformers ^2.17.0, cheerio ^1.0.0, sharp ^0.32.6 |
| CFG | `server/embedder.js` | Hugging Face 被墙 → 自动降级备用方案 |
| CFG | `server/embedder.js` | mock sharp (文本 Embedding 不需要图像处理) |
| CFG | `server/vector-db.js` | 标记为废弃 (功能迁移到 vector-store.js) |
| FIX | `js/app.js` | 修复投喂记录排序 bug：统计始终基于时间序列计算，排序改用数值比较 |

---

## 一、项目概述

**SalmonFeeding AI** — 三文鱼智能投喂管理系统。AI 驱动的三文鱼（大西洋鲑/虹鳟）养殖管理平台，集成投喂计算、知识库 RAG 检索、Claude 智能问答、企微/飞书机器人。

- 本地路径: `C:\Users\27638\salmon-feeding`
- Gitee: `https://gitee.com/ovo231023/salmon-feeding`
- 启动: `npm start` → http://localhost:3456

---

## 二、用户所有需求记录

### 已完成 ✅

| # | 需求 | 完成情况 |
|---|------|---------|
| 1 | 打开运行 salmon-feeding 项目 | 服务器在 localhost:3456 运行 |
| 2 | 评估完整工作流是否打通 | 发现前后端数据断层（localStorage vs API） |
| 3 | 评估"搜索文档→提炼知识"能力 | RAG 检索 + Claude 回答可用 |
| 4 | **知识库升级到百万字级** | 架构重建完成，当前 21.4万字 |
| 5 | 检索水产养殖投喂策略文档/论文/行业标准 | BM25+向量混合检索 + Semantic Scholar 论文 + 标准文档 |
| 6 | AI 问答能溯源 | [来源:N] 标记 + 可展开来源卡片 |
| 7 | 安装 VS Build Tools 解决 Transformers.js | VS 2022 已存在但 node-gyp 无法检测 |
| 8 | 修复 sharp 编译问题 | mock sharp 绕过，文本 Embedding 不需要 |
| 9 | 建立自动爬虫拉取论文 | crawler.js 完成 (NOAA/GSA/Semantic Scholar) |
| 10 | 导入 RSS 新闻 | 30 篇已入库 |
| 11 | PDF 批量导入管道 | 就绪，data/pdfs/ 放入 PDF 即可 |
| 12 | 记录 Gitee 账号和仓库 | ovo231023，项目已推送 |
| 13 | 工作日志 (diary) 规范 | diary/ 目录，每日生成 |
| 14 | 编写 README | 完成并推送 |
| 15 | 推送代码到 Gitee | 12ebc93 已推送 |

### 待完成 / 进行中 🔶

| # | 需求 | 阻塞原因 |
|---|------|---------|
| 1 | 知识库达到 100 万字 | 当前 21.4 万，差 78.6 万 |
| 2 | Transformers.js 真实 Embedding | Hugging Face 被墙，模型无法下载 |
| 3 | 国内中文水产源接入 | fishfirst.cn 等从当前网络超时 |
| 4 | Semantic Scholar 批量论文 | API 429 限流，需要 30s+ 间隔 |
| 5 | 前后端数据断层修复 | 前端用 localStorage，后端用 JSON 文件，字段名也不一致 |
| 6 | node-gyp / VS 2022 兼容性 | Node 24 的 node-gyp v13 无法检测 VS 2022 |

### 用户偏好与规则 📋

- **Gitee 账号**: ovo231023，所有项目推送到 Gitee
- **私人令牌**: 3eaa816bd5feeaad09ed1f99a1664cd7
- **工作日志**: 每日记录到 `diary/YYYYMMDD-hhmm-{文件名}.md`
- **日志内容**: 今日完成、明日计划、遇见的困难
- **改动记录**: 对系统的每一项改动必须记录到 CLAUDE.md「零、改动日志」
- **CLAUDE.md**: 每次需求变更都要更新此文件
- **不要擅自行动**: 用户说"回答就行"时只回答问题，不要执行
- **每次改动后**: 必须 git commit + push Gitee，并告知用户具体改了什么

---

## 三、当前项目状态

### 知识库
```
📊 89 篇文档 · 348 块 · 21.4 万字
📂 manual: 25篇 | web_article: 60篇 | paper: 4篇
🔤 BM25 索引: 11,000+ 词
📐 Embedding: 增强型 n-gram 备用方案 (384维)
   （主方案 Transformers.js 因 Hugging Face 被墙不可用）
```

### 文档来源
- `data/knowledge/01-10.md` — 10篇专业知识文档
- `docs/KNOWLEDGE_BASE.md` — 原始 86KB 知识库
- 30 篇 RSS 行业新闻 (GSA/Hatch/Aquaculture Magazine)
- 4 篇 Semantic Scholar 学术论文
- 3 篇内置专题文档

### 服务器
- 运行端口: 3456
- API 端点: 25+ (含 11 个知识管理端点)
- Anthropic API Key: 已配置 (.env)
- 启动命令: `npm start` 或 `node server/server.js`

---

## 四、关键文件地图

```
salmon-feeding/
├── CLAUDE.md               ← 你正在读的文件
├── README.md               ← 项目文档 (给人类看)
├── diary/                  ← 工作日志目录
│   └── 20260727-1430-salmon-feeding.md
├── server/
│   ├── server.js           ← Express 主入口 (25+ API)
│   ├── rag.js              ← RAG 检索 + Claude 对话
│   ├── embedder.js    🆕   ← Embedding 服务 (自动降级)
│   ├── vector-store.js 🆕  ← BM25+向量+RRF 混合检索
│   ├── doc-pipeline.js 🆕  ← 文档摄入管道
│   ├── crawler.js    🆕    ← Web 爬虫 + 学术论文
│   ├── build-kb.js   🆕    ← 批量构建脚本
│   ├── full-build.js 🆕    ← 完整构建 (文档+爬虫+论文)
│   ├── generate-docs.js🆕  ← Claude API 批量生成文档
│   ├── vector-db.js        ← 旧向量库 (已废弃)
│   ├── db.js               ← JSON 存储 (记录/计划/日志)
│   ├── news-fetcher.js     ← RSS 新闻抓取
│   └── webhook-handler.js  ← 企微+飞书机器人
├── data/
│   ├── knowledge/    🆕    ← 10篇专业知识文档
│   ├── chunks/       🆕    ← 向量分片存储
│   └── pdfs/               ← 放入 PDF 论文自动索引
├── js/
│   ├── app.js              ← 前端主逻辑 (改造过)
│   ├── feeding.js          ← 投喂计算引擎
│   └── knowledge.js        ← 知识库展示
└── docs/KNOWLEDGE_BASE.md  ← 原始知识库 (86KB)

🆕 = 2026-07-27 知识库升级新增
```

---

## 五、下次启动时要做的事

### 优先级 P0 — 继续推进
1. **提升文档量到百万字**: 当前 21.4 万，目标 100 万
   - 方案 A: `node server/generate-docs.js` (Claude API 生成，需修改 TOPICS 数组扩展更多专题)
   - 方案 B: 写更多 .md 文件到 `data/knowledge/`，运行 `node server/full-build.js`
   - 方案 C: 放 PDF 论文到 `data/pdfs/`，`POST /api/knowledge/import-pdfs`
2. **检查网络状态**: 测试 fishfirst.cn、hf-mirror.com 是否从当前网络可达
   - 如果可达 → 修 crawler.js 加入中文源
   - 如果 Hugging Face 可达 → Transformers.js 自动启用

### 优先级 P1 — 质量提升
3. **修复 Semantic Scholar**: `server/crawler.js` 的 `searchSemanticScholar` 函数限流逻辑
4. **前后端数据打通**: `js/app.js` 的 `loadRecords()` 改为调用 `/api/records`

### 优先级 P2 — 体验优化
5. **VS 2022 兼容性**: 尝试降级 node-gyp 或使用 `--msvs_version=2022`
6. **Embedding 模型**: 网络恢复后，模型在 `~/.cache/huggingface/` 下，重启自动加载

---

## 六、已知问题与解决记录

| 问题 | 状态 | 尝试过的方案 |
|------|------|------------|
| Hugging Face 被墙 | 未解决 | hf-mirror.com 也超时；jsdelivr 没有模型文件 |
| sharp 编译失败 | 绕过 | mock sharp，文本 Embedding 不需要 |
| node-gyp 无法检测 VS 2022 | 未解决 | `--msvs_version=2022`、`GYP_MSVS_VERSION` 均无效，Node 24 的 gyp v13 兼容性问题 |
| Semantic Scholar 429 | 部分解决 | 需 30s+ 间隔；重试逻辑可能无限循环 |
| fishfirst.cn 超时 | 未排查 | 可能是代理/DNS 问题，需用 PowerShell 测 |
| 前后端数据字段不一致 | 未修复 | 前端: feed/rate/weight, 后端: feed_kg/feeding_rate/fish_weight_g |

---

## 七、常见操作命令

```bash
# 启动服务器
npm start

# 重建知识库
node server/build-kb.js         # 只用本地文档
node server/full-build.js        # 本地 + 爬虫 + 论文

# Claude 生成专业文档
node server/generate-docs.js

# 知识库 API
curl http://localhost:3456/api/knowledge/stats
curl "http://localhost:3456/api/knowledge/search?q=投喂策略&limit=5"
curl http://localhost:3456/api/knowledge/documents

# 摄入文档
curl -X POST http://localhost:3456/api/knowledge/ingest \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/article"}'

# 启动爬虫
curl -X POST http://localhost:3456/api/knowledge/crawl \
  -d '{"crawlWeb":true,"searchPapers":true}'

# Git
git push origin master    # 推送到 Gitee

# 生成工作日志
# 对 AI 说: "通过 git commit message 生成今天的工作日志"
```

---

## ⚠️ 给下一个 Claude 会话的提醒

1. **读取此文件后，先检查「改动日志」** 了解此前做了什么
2. **任何代码修改后，必须在「改动日志」追加记录** — 格式: `日期 | 类型 | 文件 | 摘要`
3. **修改完后更新「当前项目状态」** 确保统计数据准确
4. **用户提出新需求 → 追加到「用户所有需求记录」**
5. **问题解决/阻塞排除 → 更新「已知问题与解决记录」**
6. **每天结束 → 生成 diary 日志 + git commit + push Gitee**
