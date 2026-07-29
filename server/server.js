// ================================================================
// server.js — 三文鱼投喂管理系统后端
// ================================================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getRecords, addRecord, deleteRecord, savePlan, getPlans, logQuery, getLogs } = require('./db');
const { search, generateAnswer, chat } = require('./rag');
const vstore = require('./vector-store');
const { embedBatch } = require('./embedder');
const { ingestURL, ingestPDF, ingestText } = require('./doc-pipeline');
const { indexAll, getStatus } = require('./vector-db');
const { startAutoRefresh, getLatestNews, getLatestPrices, getNewsStats, refreshAll } = require('./news-fetcher');
const { handleWecom, handleFeishu } = require('./webhook-handler');
const { runAllCrawlers, importNewsArticles, importPDFs, getModelDownloadScript } = require('./crawler');

const app = express();
app.use(cors());
app.use(express.json());

// ============ Anthropic API 代理 (Render → ECS) ============
// ECS 在国内访问不了 api.anthropic.com，通过 Render 转发
const ANTHROPIC_BASE = 'https://api.anthropic.com';
app.use('/api/anthropic-proxy', async (req, res) => {
  try {
    const targetUrl = ANTHROPIC_BASE + req.path;
    const headers = {
      'x-api-key': req.headers['x-api-key'] || process.env.ANTHROPIC_API_KEY || '',
      'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
      'Content-Type': 'application/json',
    };

    const fetchOptions = {
      method: req.method,
      headers,
    };
    if (req.method !== 'GET' && req.body && Object.keys(req.body).length > 0) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    console.log(`🔄 API代理: ${req.method} ${targetUrl}`);
    const response = await fetch(targetUrl, fetchOptions);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch(e) {
    console.error('API代理失败:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// 静态文件
app.use(express.static(path.join(__dirname, '..')));

// ============ 记录 API ============
app.get('/api/records', (req, res) => {
  res.json(getRecords());
});

app.post('/api/records', (req, res) => {
  const r = req.body;
  const result = addRecord(r);
  res.json(result);  // result 已经包含 id + 所有字段
});

app.delete('/api/records/:id', (req, res) => {
  deleteRecord(req.params.id);
  res.json({ ok: true });
});

// ============ 投喂计划 API ============
app.post('/api/plan', (req, res) => {
  const p = req.body;
  // 使用 FeedingEngine 计算 (需要加载前端模块)
  // 这里简化: 直接存储前端计算结果
  const result = savePlan(p);
  res.json({ id: result.lastInsertRowid });
});

app.get('/api/plans', (req, res) => {
  res.json(getPlans());
});

// ============ 知识检索 API (保留原有) ============
app.post('/api/rag', async (req, res) => {
  const { query } = req.body;
  const result = await generateAnswer(query);
  logQuery(query, result.answer, JSON.stringify(result.sources));
  res.json(result);
});

// ============ 🌟 智能对话 API (多轮记忆 + 可选联网搜索) ============
app.post('/api/chat', async (req, res) => {
  const { query, history, searchWeb } = req.body;
  if (!query) return res.status(400).json({ error: '请输入问题' });
  try {
    const result = await chat(query, history || [], { searchWeb: searchWeb || false });
    logQuery(query, result.answer, JSON.stringify(result.sources));
    res.json(result);
  } catch(e) {
    console.error('Chat API error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/knowledge', (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ results: [] });
  const results = search(q, 5);
  res.json({ results });
});

// 向量库状态
app.get('/api/vector-status', (req, res) => {
  res.json(getStatus());
});

// 手动触发 PDF 索引
app.post('/api/reindex', async (req, res) => {
  try {
    const results = await indexAll();
    res.json({ ok: true, results });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// 行业新闻
app.get('/api/news', (req, res) => {
  const limit = parseInt(req.query.limit) || 30;
  res.json({
    articles: getLatestNews(limit),
    stats: getNewsStats(),
  });
});

// 三文鱼价格
app.get('/api/prices', (req, res) => {
  const limit = parseInt(req.query.limit) || 30;
  res.json(getLatestPrices(limit));
});

// 手动刷新
app.post('/api/refresh', async (req, res) => {
  await refreshAll();
  res.json({ ok: true, stats: getNewsStats() });
});

// ============ 📚 知识库管理 API (NEW) ============

// 知识库统计
app.get('/api/knowledge/stats', (req, res) => {
  res.json(vstore.getStats());
});

// 文档列表
app.get('/api/knowledge/documents', (req, res) => {
  const { type, q } = req.query;
  const docs = vstore.listDocuments({ type, q });
  res.json(docs);
});

// 文档详情
app.get('/api/knowledge/documents/:id', (req, res) => {
  const doc = vstore.getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: '文档不存在' });
  res.json(doc);
});

// 删除文档
app.delete('/api/knowledge/documents/:id', (req, res) => {
  const ok = vstore.removeDocument(req.params.id);
  if (!ok) return res.status(404).json({ error: '文档不存在' });
  res.json({ ok: true });
});

// 高级搜索 (支持过滤)
app.get('/api/knowledge/search', async (req, res) => {
  const { q, type, docId, limit } = req.query;
  if (!q) return res.json({ results: [] });
  const topK = parseInt(limit) || 10;
  const filters = {};
  if (type) filters.sourceType = type;
  if (docId) filters.docId = docId;
  const results = await vstore.search(q, topK, filters);
  res.json({ results, query: q });
});

// 摄入文档 (URL)
app.post('/api/knowledge/ingest', async (req, res) => {
  const { url, text, options } = req.body;
  try {
    let result;
    if (url) {
      result = await ingestURL(url, options || {});
    } else if (text) {
      result = await ingestText(text, options || {});
    } else {
      return res.status(400).json({ error: '请提供 url 或 text' });
    }

    // 生成 embeddings
    const chunkTexts = result.chunks.map(c => c.text);
    const embeddings = await embedBatch(chunkTexts);

    // 添加到向量库
    const docResult = await vstore.addDocument(result.metadata, result.chunks, embeddings);

    res.json({
      ok: true,
      document: { id: docResult.docId, title: result.title, chunkCount: docResult.chunkCount },
    });
  } catch(e) {
    console.error('摄入失败:', e);
    res.status(500).json({ error: e.message });
  }
});

// 上传文件摄入
app.post('/api/knowledge/upload', async (req, res) => {
  // 简单 JSON 格式上传 (文件内容在 body 中)
  const { content, filename, options } = req.body;
  if (!content) return res.status(400).json({ error: '请提供文件内容' });

  try {
    const ext = (filename || '').toLowerCase();
    let result;

    if (ext.endsWith('.md') || ext.endsWith('.txt')) {
      result = await ingestText(content, { ...options, title: options?.title || filename });
    } else {
      result = await ingestText(content, { ...options, title: options?.title || filename });
    }

    const chunkTexts = result.chunks.map(c => c.text);
    const embeddings = await embedBatch(chunkTexts);

    const docResult = await vstore.addDocument(result.metadata, result.chunks, embeddings);

    res.json({
      ok: true,
      document: { id: docResult.docId, title: result.title, chunkCount: docResult.chunkCount },
    });
  } catch(e) {
    console.error('文件摄入失败:', e);
    res.status(500).json({ error: e.message });
  }
});

// 重建索引
app.post('/api/knowledge/reindex', async (req, res) => {
  try {
    await vstore.init(true);
    // 重新导入 KNOWLEDGE_BASE.md
    const kbPath = path.join(__dirname, '..', 'docs', 'KNOWLEDGE_BASE.md');
    if (require('fs').existsSync(kbPath)) {
      await vstore.importMarkdownFile(kbPath);
    }
    res.json({ ok: true, stats: vstore.getStats() });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// 批量采集文档 (爬虫)
app.post('/api/knowledge/crawl', async (req, res) => {
  const options = req.body || {};
  try {
    const stats = await runAllCrawlers(options);
    res.json({ ok: true, stats });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// 导入 RSS 新闻
app.post('/api/knowledge/import-news', async (req, res) => {
  try {
    const result = await importNewsArticles();
    res.json({ ok: true, ...result, stats: vstore.getStats() });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// 导入 PDF
app.post('/api/knowledge/import-pdfs', async (req, res) => {
  try {
    const result = await importPDFs();
    res.json({ ok: true, ...result, stats: vstore.getStats() });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取模型下载脚本
app.get('/api/knowledge/model-download-script', (req, res) => {
  res.json({ script: getModelDownloadScript() });
});

// ============ 🤖 企业微信机器人 ============
// GET: URL 验证 | POST: 接收消息
app.all('/api/webhook/wecom', async (req, res) => {
  try {
    const config = {
      token: process.env.WECOM_TOKEN || '',
      encodingAESKey: process.env.WECOM_ENCODING_AES_KEY || '',
      corpId: process.env.WECOM_CORP_ID || '',
    };
    const result = await handleWecom(req.query, req.body, config);
    if (result.contentType === 'application/xml') {
      res.set('Content-Type', 'application/xml');
    }
    res.status(result.status).send(result.body);
  } catch(e) {
    console.error('企微 Webhook 异常:', e);
    res.status(500).json({ error: e.message });
  }
});

// 企微简化接口 (POST JSON，用于本地测试 + 群机器人 outgoing webhook)
app.post('/api/webhook/wecom/simple', async (req, res) => {
  const { msg, text, content } = req.body;
  const query = msg || text || content || '';
  if (!query) return res.json({ reply: '请发送查询内容，如: 水温15度体重200g的投喂量？' });
  try {
    const result = await chat(query);
    let reply = result.answer.replace(/\*\*/g, '');
    if (result.outOfDomain) {
      reply = '抱歉，我只专注于三文鱼养殖领域的问题解答。您有什么养殖技术相关的问题吗？';
    }
    res.json({ reply, sources: (result.sources || []).map(s => s.title) });
  } catch(e) {
    res.json({ reply: '抱歉，处理出错了: ' + e.message });
  }
});

// ============ 🤖 飞书机器人 ============
// GET: 飞书控制台预检 + URL验证备用
app.get('/api/webhook/feishu', (req, res) => {
  console.log('🐦 飞书 GET:', JSON.stringify(req.query));
  if (req.query.challenge) {
    // 某些版本飞书用 GET + query 验证
    return res.json({ challenge: req.query.challenge });
  }
  res.json({ status: 'ok', message: 'SalmonFeeding 飞书机器人就绪' });
});

app.post('/api/webhook/feishu', async (req, res) => {
  try {
    const config = {
      appId: process.env.FEISHU_APP_ID || '',
      appSecret: process.env.FEISHU_APP_SECRET || '',
      verificationToken: process.env.FEISHU_VERIFICATION_TOKEN || '',
      encryptKey: process.env.FEISHU_ENCRYPT_KEY || '',
    };
    const result = await handleFeishu(req.body, req.headers, config);
    res.status(result.status).json(result.body);
  } catch(e) {
    console.error('飞书 Webhook 异常:', e);
    res.status(500).json({ msg: e.message });
  }
});

// 飞书简化接口 (POST JSON测试)
app.post('/api/webhook/feishu/simple', async (req, res) => {
  const query = req.body.text || req.body.msg || req.body.content || '';
  if (!query) return res.json({ msg: '请发送查询内容' });
  try {
    const result = await chat(query);
    if (result.outOfDomain) {
      return res.json({
        msg_type: 'interactive',
        card: {
          header: { title: { tag: 'plain_text', content: '🐟 鲑鱼博士' }, template: 'blue' },
          elements: [{ tag: 'div', text: { tag: 'lark_md', content: '抱歉，我只能解答三文鱼养殖相关问题。有什么养殖技术问题需要帮助吗？' } }],
        },
      });
    }
    const card = buildFeishuSimpleCard(result, query);
    res.json(card);
  } catch(e) {
    res.json({ msg: '抱歉，处理出错了: ' + e.message });
  }
});

// 飞书简易卡片
function buildFeishuSimpleCard(result, query) {
  const answer = result.answer.replace(/\*\*/g, '**').replace(/\n{3,}/g, '\n\n').substring(0, 3000);
  return {
    msg_type: 'interactive',
    card: {
      header: { title: { tag: 'plain_text', content: '🐟 鲑鱼博士' }, template: 'blue' },
      elements: [
        { tag: 'div', text: { tag: 'lark_md', content: `**Q:** ${query.substring(0, 200)}\n\n${answer}` } },
        { tag: 'hr' },
        { tag: 'note', elements: [{ tag: 'plain_text', content: '📚 来源: ' + (result.sources || []).slice(0, 3).map(s => s.title).join(' | ') }] },
      ],
    },
  };
}

// ============ 启动 ============
const PORT = process.env.PORT || 3456;
const isRender = !!process.env.RENDER;

app.listen(PORT, async () => {
  console.log(`🐟 三文鱼投喂管理系统已启动: http://localhost:${PORT}`);
  console.log(`📡 API: http://localhost:${PORT}/api/records`);
  console.log(`🤖 AI 对话: http://localhost:${PORT}/api/chat`);
  console.log(`📚 知识库: http://localhost:${PORT}/api/knowledge/stats`);
  console.log(`💬 企微 Webhook: http://localhost:${PORT}/api/webhook/wecom`);
  console.log(`🐦 飞书 Webhook: http://localhost:${PORT}/api/webhook/feishu`);

  if (isRender) {
    // Render 免费版 512MB 内存，仅服务静态文件和轻量 API
    console.log('☁️ Render 轻量模式：仅服务 Web + 基础 API');
  } else {
    // 本地完整模式
    console.log(`🔧 简易测试: POST /api/webhook/wecom/simple | POST /api/webhook/feishu/simple`);

    // 初始化向量库
    try {
      await vstore.init();
      const stats = vstore.getStats();
      console.log(`📚 向量库: ${stats.documentCount} 篇文档, ${stats.chunkCount} 个文本块`);

      // 首次启动自动导入 KNOWLEDGE_BASE.md
      if (stats.documentCount === 0) {
        const kbPath = path.join(__dirname, '..', 'docs', 'KNOWLEDGE_BASE.md');
        if (require('fs').existsSync(kbPath)) {
          console.log('🆕 首次启动，导入基础知识库...');
          await vstore.importMarkdownFile(kbPath);
          const newStats = vstore.getStats();
          console.log(`✅ 已导入: ${newStats.documentCount} 篇文档, ${newStats.chunkCount} 块`);
        }
      }
    } catch(e) {
      console.error('⚠️ 向量库初始化失败:', e.message);
    }

    // 自动索引 PDF
    const status = getStatus();
    if (status.fileCount > 0) {
      console.log(`📄 检测到 ${status.fileCount} 个待索引 PDF`);
      try { await indexAll(); } catch(e) { console.log('⚠️ PDF索引:', e.message); }
    }
    if (status.fileCount === 0 && vstore.getStats().documentCount <= 1) {
      console.log(`💡 将 PDF 文件放入 data/pdfs/ 目录，或通过 API 摄入文档`);
    }

    // 启动新闻自动刷新
    startAutoRefresh(120);
  }
});
