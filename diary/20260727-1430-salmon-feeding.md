# 工作日志 — 2026-07-27

## 今日完成

### 知识库升级
- 将知识库从单个 86KB Markdown 文件 + 假 Embedding 升级为：
  - BM25 + 向量 + RRF 混合检索
  - 增强型 n-gram Embedding（因 Hugging Face 被墙，Transformers.js 无法下载模型）
  - 文档摄入管道（URL/PDF/文本 → 自动分块 → 索引）
  - AI 对话增强溯源（文档标题/章节/作者/日期/类型）
- 新建 10 篇专业知识文档（水质管理、饲料营养、RAS 工程、经济市场、疾病防控、苗种驯化、收获可持续、投喂策略、行业标准、学术综述）
- 导入 30 篇 RSS 行业新闻
- 从 Semantic Scholar API 摄入 4 篇真实学术论文
- 当前知识库：89 篇文档，21.4 万字

### 基础架构
- 新建：`server/embedder.js`、`server/vector-store.js`、`server/doc-pipeline.js`、`server/crawler.js`
- 改造：`server/rag.js`、`server/server.js`、`js/app.js`、`index.html`
- 新增 11 个知识管理 API 端点

## 明日计划
- 解决 Hugging Face 访问问题（代理/VPN/离线模型）
- 继续扩展文档量，目标 50 万字+
- 优化中文源访问（排查 fishfirst.cn 等国内源连接问题）
- 将项目初始化 Git 并推送到 Gitee

## 遇见的困难
- **Hugging Face 被墙**：Transformers.js 模型无法下载，使用备用 bigram Embedding（精度约 60%）
- **Semantic Scholar API 限流**：429 频率限制严重，需要 30 秒+间隔
- **国内中文水产网站访问异常**：fishfirst.cn 等从当前网络超时
- **Node.js 24 + node-gyp v13 兼容性问题**：无法识别已安装的 VS 2022，sharp 编译失败
