// ================================================================
// server.js — 三文鱼投喂管理系统后端
// ================================================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getRecords, addRecord, deleteRecord, savePlan, getPlans, logQuery, getLogs } = require('./db');
const { search, generateAnswer, chat } = require('./rag');
const { indexAll, getStatus } = require('./vector-db');
const { startAutoRefresh, getLatestNews, getLatestPrices, getNewsStats, refreshAll } = require('./news-fetcher');
const { handleWecom, handleFeishu } = require('./webhook-handler');

const app = express();
app.use(cors());
app.use(express.json());

// 静态文件
app.use(express.static(path.join(__dirname, '..')));

// ============ 记录 API ============
app.get('/api/records', (req, res) => {
  res.json(getRecords());
});

app.post('/api/records', (req, res) => {
  const r = req.body;
  const result = addRecord(r);
  res.json({ id: result.lastInsertRowid, ...r });
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
    res.json({ reply: result.answer.replace(/\*\*/g, ''), sources: result.sources.map(s => s.title) });
  } catch(e) {
    res.json({ reply: '抱歉，处理出错了: ' + e.message });
  }
});

// ============ 🤖 飞书机器人 ============
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
app.listen(PORT, async () => {
  console.log(`🐟 三文鱼投喂管理系统已启动: http://localhost:${PORT}`);
  console.log(`📡 API: http://localhost:${PORT}/api/records`);
  console.log(`🤖 AI 对话: http://localhost:${PORT}/api/chat`);
  console.log(`💬 企微 Webhook: http://localhost:${PORT}/api/webhook/wecom`);
  console.log(`🐦 飞书 Webhook: http://localhost:${PORT}/api/webhook/feishu`);
  console.log(`🔧 简易测试: POST /api/webhook/wecom/simple | POST /api/webhook/feishu/simple`);
  // 自动索引 PDF
  const status = getStatus();
  console.log(`📚 向量库: ${status.fileCount} 个PDF, ${status.chunkCount} 个文本块`);
  if (status.fileCount === 0) {
    console.log(`💡 将 PDF 文件放入 data/pdfs/ 目录，访问 POST /api/reindex 建立索引`);
  }
  // 启动时自动索引新增的 PDF
  try { await indexAll(); } catch(e) { console.log('⚠️ PDF索引:', e.message); }
  // 启动新闻自动刷新 (每2小时)
  startAutoRefresh(120);
});
