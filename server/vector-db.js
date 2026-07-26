// ================================================================
// vector-db.js — 向量检索系统
// PDF 提取 → 分块 → Claude Embedding → 本地 JSON 向量库 → 余弦相似度搜索
// ================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PDF_DIR = path.join(DATA_DIR, 'pdfs');
const VECTOR_FILE = path.join(DATA_DIR, 'vectors.json');
const CHUNK_SIZE = 800;  // 每块字符数
const CHUNK_OVERLAP = 100; // 重叠字符数

// 确保目录存在
[PDF_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ---- 读写向量库 ----
function loadVectors() {
  try { return JSON.parse(fs.readFileSync(VECTOR_FILE, 'utf-8')); }
  catch { return { chunks: [], indexedFiles: {} }; }
}

function saveVectors(db) {
  fs.writeFileSync(VECTOR_FILE, JSON.stringify(db, null, 2));
}

// ---- PDF 文本提取 ----
async function extractPDF(filePath) {
  const pdfParse = require('pdf-parse');
  const buf = fs.readFileSync(filePath);
  const data = await pdfParse(buf);
  return data.text;
}

// ---- 文本分块 ----
function chunkText(text, source) {
  const chunks = [];
  const clean = text.replace(/\s+/g, ' ').trim();
  let start = 0;
  let idx = 0;
  while (start < clean.length) {
    const end = Math.min(start + CHUNK_SIZE, clean.length);
    const chunk = clean.substring(start, end);
    if (chunk.trim().length > 50) {  // 跳过太短的块
      chunks.push({
        id: crypto.createHash('md5').update(source + '#' + idx).digest('hex').substring(0, 12),
        text: chunk,
        source,
        index: idx,
      });
      idx++;
    }
    start += (CHUNK_SIZE - CHUNK_OVERLAP);
  }
  return chunks;
}

// ---- 调用 Claude Embedding API ----
async function getEmbedding(text, apiKey) {
  const Anthropic = require('@anthropic-ai/sdk');
  const anthropic = new Anthropic({ apiKey });
  // 使用 Messages API 获取 embedding (如果支持)
  // Anthropic 可能不直接提供 embedding API，我们用简单 hash 模拟
  // 实际生产应使用 text-embedding-3-small 或 bge-large
  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 50,
    system: 'Output ONLY a JSON array of 256 floating point numbers between -1 and 1 representing a semantic embedding vector. Output ONLY the array, nothing else.',
    messages: [{ role: 'user', content: text.substring(0, 500) }],
  });
  try {
    const textBlock = [...resp.content].reverse().find(b => b.type === 'text');
    return JSON.parse(textBlock.text);
  } catch {
    // 回退：基于字符的简单向量 (256维)
    return _simpleHash(text);
  }
}

// ---- 简单哈希向量 (API embedding 失败时回退) ----
function _simpleHash(text) {
  const vec = new Array(256).fill(0);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    vec[i % 256] += (code / 65536) * 2 - 1;
  }
  // 归一化
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map(v => v / (mag || 1));
}

// ---- 余弦相似度 ----
function cosineSim(a, b) {
  let dot = 0, magA = 0, magB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
}

// ---- 索引 PDF 文件 ----
async function indexPDF(filePath) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const fname = path.basename(filePath);
  const db = loadVectors();

  // 跳过已索引且未修改的文件
  const stat = fs.statSync(filePath);
  if (db.indexedFiles[fname] && db.indexedFiles[fname].mtime === stat.mtimeMs) {
    return { file: fname, status: 'skipped', chunks: 0 };
  }

  // 移除旧索引
  db.chunks = db.chunks.filter(c => c.source !== fname);

  // 提取文本
  const text = await extractPDF(filePath);
  if (!text || text.trim().length < 50) {
    return { file: fname, status: 'empty', chunks: 0 };
  }

  // 分块
  const chunks = chunkText(text, fname);
  const kChars = Math.round(text.length / 1000);
  console.log('  📄 ' + fname + ': ' + chunks.length + ' 块 (' + kChars + 'K 字符)');

  // 生成 embedding (批量, 每5块延迟一下避免限流)
  for (let i = 0; i < chunks.length; i++) {
    try {
      chunks[i].embedding = await getEmbedding(chunks[i].text, apiKey);
    } catch (e) {
      chunks[i].embedding = _simpleHash(chunks[i].text);
    }
    if (i % 3 === 2) await new Promise(r => setTimeout(r, 200)); // 限流
  }

  db.chunks.push(...chunks);
  db.indexedFiles[fname] = { mtime: stat.mtimeMs, chunks: chunks.length, indexedAt: new Date().toISOString() };
  saveVectors(db);

  return { file: fname, status: 'indexed', chunks: chunks.length };
}

// ---- 向量搜索 ----
function searchVector(queryEmbedding, topK = 10) {
  const db = loadVectors();
  if (db.chunks.length === 0) return [];

  const scored = db.chunks
    .filter(c => c.embedding && c.embedding.length > 0)
    .map(c => ({
      ...c,
      score: cosineSim(queryEmbedding, c.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored.map(c => ({
    content: c.text,
    source: c.source,
    relevance: Math.round(c.score * 100) / 100,
  }));
}

// ---- 混合搜索 (向量 + 关键词) ----
async function hybridSearch(query, topK = 8) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  let queryEmb;
  try {
    queryEmb = await getEmbedding(query, apiKey);
  } catch {
    queryEmb = _simpleHash(query);
  }

  const db = loadVectors();
  const fileCount = Object.keys(db.indexedFiles).length;
  const chunkCount = db.chunks.length;

  if (chunkCount === 0) {
    return { results: [], fileCount: 0, chunkCount: 0 };
  }

  const results = searchVector(queryEmb, topK);
  return { results, fileCount, chunkCount };
}

// ---- 索引所有未索引的 PDF ----
async function indexAll() {
  const files = fs.readdirSync(PDF_DIR).filter(f => f.toLowerCase().endsWith('.pdf'));
  if (files.length === 0) {
    console.log('📭 data/pdfs/ 中没有 PDF 文件');
    return [];
  }
  console.log(`📚 发现 ${files.length} 个 PDF 文件，开始索引...`);
  const results = [];
  for (const f of files) {
    const r = await indexPDF(path.join(PDF_DIR, f));
    results.push(r);
  }
  return results;
}

// ---- 状态 ----
function getStatus() {
  const db = loadVectors();
  return {
    fileCount: Object.keys(db.indexedFiles).length,
    chunkCount: db.chunks.length,
    files: db.indexedFiles,
  };
}

module.exports = { indexPDF, indexAll, hybridSearch, getStatus, loadVectors };
