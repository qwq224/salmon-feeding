// ================================================================
// server.js — 三文鱼投喂管理系统后端
// ================================================================
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getRecords, addRecord, deleteRecord, savePlan, getPlans, logQuery, getLogs } = require('./db');
const { search, generateAnswer } = require('./rag');

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

// ============ 知识检索 API ============
app.post('/api/rag', (req, res) => {
  const { query } = req.body;
  const result = generateAnswer(query);
  logQuery(query, result.answer, JSON.stringify(result.sources));
  res.json(result);
});

app.get('/api/knowledge', (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ results: [] });
  const results = search(q, 5);
  res.json({ results });
});

// ============ Webhook (企微/飞书) ============
app.post('/api/webhook/wecom', (req, res) => {
  const { msg } = req.body;
  if (!msg) return res.json({ reply: '请发送查询内容' });
  const result = generateAnswer(msg);
  res.json({
    reply: result.answer,
    sources: result.sources.map(s => s.title),
  });
});

app.post('/api/webhook/feishu', (req, res) => {
  const { text } = req.body;
  if (!text) return res.json({ msg: '请发送查询内容' });
  const result = generateAnswer(text);
  res.json({
    msg: result.answer,
    cards: result.sources.map(s => ({ title: s.title })),
  });
});

// ============ 启动 ============
const PORT = process.env.PORT || 3456;
app.listen(PORT, () => {
  console.log(`🐟 三文鱼投喂管理系统已启动: http://localhost:${PORT}`);
  console.log(`📡 API: http://localhost:${PORT}/api/records`);
  console.log(`🤖 RAG: http://localhost:${PORT}/api/rag?q=投喂率`);
  console.log(`🔗 Webhook: http://localhost:${PORT}/api/webhook/wecom`);
});
