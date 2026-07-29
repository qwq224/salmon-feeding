// ================================================================
// vector-store.js — 混合检索向量库 (替代 vector-db.js)
//
// 功能:
// - 分片 JSON 存储 (data/chunks/)
// - BM25 关键词倒排索引 (中文 bigram + 英文词)
// - 向量相似度搜索 (通过 embedder.js)
// - RRF 混合检索融合
// - 文档管理与丰富元数据
// ================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CHUNKS_DIR = path.join(DATA_DIR, 'chunks');
const DOCS_FILE = path.join(DATA_DIR, 'documents.json');
const META_FILE = path.join(DATA_DIR, 'store_meta.json');

// 分片参数
const CHUNKS_PER_SHARD = 500;  // 每个分片最多 500 个 chunk
const CHUNK_SIZE = 800;        // 每个 chunk 文本最大字符数
const CHUNK_OVERLAP = 50;      // 重叠字符数

// 确保目录存在
[DATA_DIR, CHUNKS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});
if (!fs.existsSync(DOCS_FILE)) fs.writeFileSync(DOCS_FILE, '[]');
if (!fs.existsSync(META_FILE)) fs.writeFileSync(META_FILE, JSON.stringify({ shardCount: 0, totalChunks: 0, totalChars: 0 }));

// ============ 数据结构 ============
// documents.json: [{ id, title, sourceType, sourceName, sourceUrl, author, publishDate, language, ingestedAt, chunkCount, totalChars, tags }]
// meta.json: { shardCount, totalChunks, totalChars }
// shard_N.json: [{ id, docId, chunkIndex, text, charCount, sectionTitle, embedding: [...], metadata }]
// bm25_index.json: { terms: { "term": { df, totalTf, posting: [[shardIdx, chunkIdx, tf], ...] } }, docCount, avgLen }

// ============ 中文 + 英文混合分词 ============

/**
 * 分词: 中文用 bigram，英文用空格分词，数字保留
 * 返回 token 数组
 */
function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    // 跳过空白
    if (/\s/.test(ch)) { i++; continue; }

    // 英文/数字序列
    if (/[a-zA-Z0-9]/.test(ch)) {
      let word = '';
      while (i < text.length && /[a-zA-Z0-9]/.test(text[i])) {
        word += text[i]; i++;
      }
      tokens.push(word.toLowerCase());
      continue;
    }

    // 中文字符 (CJK)
    if (/[一-鿿㐀-䶿]/.test(ch)) {
      // 收集连续中文 → bigram
      let cjk = '';
      while (i < text.length && /[一-鿿㐀-䶿]/.test(text[i])) {
        cjk += text[i]; i++;
      }
      // Unigram
      for (let j = 0; j < cjk.length; j++) tokens.push(cjk[j]);
      // Bigram
      for (let j = 0; j < cjk.length - 1; j++) tokens.push(cjk.substring(j, j + 2));
      continue;
    }

    // 其他字符 (标点等) 跳过
    i++;
  }
  return tokens;
}

// ============ BM25 索引 ============

class BM25Index {
  constructor() {
    this.terms = {};    // term → { df, totalTf, posting: [[shardIdx, chunkIdx, tf], ...] }
    this.docCount = 0;
    this.avgLen = 0;
    this.k1 = 1.5;
    this.b = 0.75;
  }

  /** 添加一个文档的分词结果 */
  addDoc(shardIdx, chunkIdx, tokens) {
    this.docCount++;
    const len = tokens.length;
    this.avgLen = ((this.avgLen * (this.docCount - 1)) + len) / this.docCount;

    // 统计词频
    const tf = {};
    for (const t of tokens) {
      tf[t] = (tf[t] || 0) + 1;
    }

    for (const [term, freq] of Object.entries(tf)) {
      if (!this.terms[term]) {
        this.terms[term] = { df: 0, totalTf: 0, posting: [] };
      }
      this.terms[term].df++;
      this.terms[term].totalTf += freq;
      this.terms[term].posting.push([shardIdx, chunkIdx, freq, len]);
    }
  }

  /** 移除一个文档的所有 chunks */
  removeDoc(shardIdxs) {
    // shardIdxs: [{shardIdx, chunkIdx}]
    const toRemove = new Set(shardIdxs.map(s => `${s.shardIdx}:${s.chunkIdx}`));
    for (const [term, info] of Object.entries(this.terms)) {
      info.posting = info.posting.filter(p => !toRemove.has(`${p[0]}:${p[1]}`));
      if (info.posting.length === 0) {
        delete this.terms[term];
      } else {
        info.df = info.posting.length;
        info.totalTf = info.posting.reduce((s, p) => s + p[2], 0);
      }
    }
    this.docCount -= shardIdxs.length;
  }

  /** 搜索，返回 [{shardIdx, chunkIdx, score}] */
  search(queryTokens, topK = 30) {
    const scores = new Map(); // key: "shardIdx:chunkIdx"
    const avgLen = this.avgLen || 1;

    for (const term of queryTokens) {
      const info = this.terms[term];
      if (!info) continue;
      const idf = Math.log(1 + (this.docCount - info.df + 0.5) / (info.df + 0.5));

      for (const [shardIdx, chunkIdx, tf, docLen] of info.posting) {
        const key = `${shardIdx}:${chunkIdx}`;
        const numerator = tf * (this.k1 + 1);
        const denominator = tf + this.k1 * (1 - this.b + this.b * (docLen / avgLen));
        const score = idf * numerator / denominator;
        scores.set(key, (scores.get(key) || 0) + score);
      }
    }

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([key, score]) => {
        const [shardIdx, chunkIdx] = key.split(':').map(Number);
        return { shardIdx, chunkIdx, score };
      });
  }

  /** 序列化 */
  toJSON() {
    return {
      terms: this.terms,
      docCount: this.docCount,
      avgLen: this.avgLen,
      k1: this.k1,
      b: this.b,
    };
  }

  /** 反序列化 */
  static fromJSON(data) {
    const idx = new BM25Index();
    if (data) {
      idx.terms = data.terms || {};
      idx.docCount = data.docCount || 0;
      idx.avgLen = data.avgLen || 0;
      idx.k1 = data.k1 || 1.5;
      idx.b = data.b || 0.75;
    }
    return idx;
  }
}

// ============ 分片存储 ============

function _shardPath(idx) {
  return path.join(CHUNKS_DIR, `shard_${String(idx).padStart(4, '0')}.json`);
}

function _readShard(idx) {
  const p = _shardPath(idx);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
  catch { return []; }
}

function _writeShard(idx, chunks) {
  fs.writeFileSync(_shardPath(idx), JSON.stringify(chunks));
}

function _readMeta() {
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf-8')); }
  catch { return { shardCount: 0, totalChunks: 0, totalChars: 0 }; }
}

function _writeMeta(meta) {
  fs.writeFileSync(META_FILE, JSON.stringify(meta));
}

function _readDocs() {
  try { return JSON.parse(fs.readFileSync(DOCS_FILE, 'utf-8')); }
  catch { return []; }
}

function _writeDocs(docs) {
  fs.writeFileSync(DOCS_FILE, JSON.stringify(docs, null, 2));
}

// ============ 全局状态 ============

let bm25Index = null;
let allChunks = [];     // [{shardIdx, localIdx, chunk}] 内存缓存
let chunksLoaded = false;

// ============ 初始化 ============

async function init(forceReindex = false) {
  const meta = _readMeta();
  console.log(`📚 向量库: ${meta.totalChunks} 个文本块, ${meta.shardCount} 个分片`);

  // 尝试加载 BM25 索引缓存
  const idxPath = path.join(DATA_DIR, 'bm25_index.json');
  if (!forceReindex && fs.existsSync(idxPath)) {
    try {
      bm25Index = BM25Index.fromJSON(JSON.parse(fs.readFileSync(idxPath, 'utf-8')));
      console.log(`🔍 BM25 索引已加载: ${Object.keys(bm25Index.terms).length} 个词`);
    } catch(e) {
      console.log('⚠️ BM25 索引加载失败:', e.message);
      bm25Index = new BM25Index();
    }
  } else {
    bm25Index = new BM25Index();
  }

  _loadAllChunks();
  chunksLoaded = true;

  // 如果 BM25 为空但有 chunks，从 chunks 重建索引
  if (Object.keys(bm25Index.terms).length === 0 && allChunks.length > 0) {
    console.log('🔨 从 ' + allChunks.length + ' 个文本块重建 BM25 索引...');
    for (const entry of allChunks) {
      const tokens = tokenize(entry.chunk.text || '');
      bm25Index.addDoc(entry.shardIdx, entry.localIdx, tokens);
    }
    _saveBM25Index();
    console.log('✅ BM25 索引重建完成: ' + Object.keys(bm25Index.terms).length + ' 个词');
  }

  return meta;
}

function _loadAllChunks() {
  allChunks = [];
  const meta = _readMeta();
  for (let s = 0; s < meta.shardCount; s++) {
    const shard = _readShard(s);
    for (let c = 0; c < shard.length; c++) {
      allChunks.push({ shardIdx: s, localIdx: c, chunk: shard[c] });
    }
  }
}

function _saveBM25Index() {
  if (bm25Index) {
    fs.writeFileSync(path.join(DATA_DIR, 'bm25_index.json'), JSON.stringify(bm25Index.toJSON()));
  }
}

// ============ 文档管理 ============

/**
 * 添加文档
 * @param {object} docInfo {title, sourceType, sourceName, sourceUrl, author, publishDate, language, tags}
 * @param {object[]} chunks [{text, sectionTitle, pageNum?, charCount?}]
 * @param {Float32Array[]} embeddings
 */
async function addDocument(docInfo, chunks, embeddings) {
  const docs = _readDocs();
  const meta = _readMeta();

  const docId = 'doc_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
  const totalChars = chunks.reduce((s, c) => s + (c.charCount || c.text.length), 0);

  // 写入文档元数据
  const docEntry = {
    id: docId,
    title: docInfo.title || '未命名文档',
    sourceType: docInfo.sourceType || 'manual',
    sourceName: docInfo.sourceName || '',
    sourceUrl: docInfo.sourceUrl || '',
    author: docInfo.author || '',
    publishDate: docInfo.publishDate || '',
    language: docInfo.language || 'zh',
    tags: docInfo.tags || [],
    chunkCount: chunks.length,
    totalChars,
    ingestedAt: new Date().toISOString(),
  };
  docs.push(docEntry);
  _writeDocs(docs);

  // 写入 chunks 到分片
  for (let i = 0; i < chunks.length; i++) {
    const chunkData = {
      id: docId + '_' + i,
      docId,
      chunkIndex: i,
      text: chunks[i].text,
      charCount: chunks[i].charCount || chunks[i].text.length,
      sectionTitle: chunks[i].sectionTitle || '',
      pageNum: chunks[i].pageNum || null,
    };

    // 存储 embedding 为普通数组 (JSON 序列化)
    if (embeddings && embeddings[i]) {
      chunkData.embedding = Array.from(embeddings[i]);
    }

    // 找到当前最后一个分片
    let shardIdx = meta.shardCount - 1;
    if (shardIdx < 0) {
      shardIdx = 0;
      meta.shardCount = 1;
    }
    let shard = _readShard(shardIdx);

    // 如果分片满了，创建新分片
    if (shard.length >= CHUNKS_PER_SHARD) {
      shardIdx = meta.shardCount;
      meta.shardCount++;
      shard = [];
    }

    // 添加到 BM25
    const tokens = tokenize(chunks[i].text);
    bm25Index.addDoc(shardIdx, shard.length, tokens);

    shard.push(chunkData);
    _writeShard(shardIdx, shard);

    meta.totalChunks++;
    meta.totalChars += chunkData.charCount;
  }

  _writeMeta(meta);
  _saveBM25Index();

  // 刷新内存缓存
  _loadAllChunks();

  console.log(`📄 已索引: "${docEntry.title}" — ${chunks.length} 块, ${totalChars} 字符`);
  return { docId, chunkCount: chunks.length, totalChars };
}

/**
 * 删除文档
 */
function removeDocument(docId) {
  const docs = _readDocs();
  const idx = docs.findIndex(d => d.id === docId);
  if (idx < 0) return false;

  const meta = _readMeta();

  // 收集要删除的 chunk 位置
  const toRemove = [];
  for (const entry of allChunks) {
    if (entry.chunk.docId === docId) {
      toRemove.push({ shardIdx: entry.shardIdx, chunkIdx: entry.localIdx });
    }
  }

  // 从每个分片中删除
  const shardMods = new Map(); // shardIdx → new chunks array
  for (const { shardIdx, chunkIdx } of toRemove) {
    if (!shardMods.has(shardIdx)) shardMods.set(shardIdx, _readShard(shardIdx));
    // 标记为 null
    const shard = shardMods.get(shardIdx);
    if (shard && shard[chunkIdx]) {
      shard[chunkIdx] = null;
    }
  }

  // 重写分片 (移除 null 条目)
  for (const [shardIdx, shard] of shardMods) {
    const newShard = shard.filter(c => c !== null);
    _writeShard(shardIdx, newShard);
  }

  // 更新 BM25 索引
  const bm25Remove = toRemove.map(r => ({ shardIdx: r.shardIdx, chunkIdx: r.chunkIdx }));
  bm25Index.removeDoc(bm25Remove);

  // 更新元数据
  meta.totalChunks -= toRemove.length;
  meta.totalChars -= docs[idx].totalChars || 0;
  _writeMeta(meta);

  // 删除文档记录
  docs.splice(idx, 1);
  _writeDocs(docs);
  _saveBM25Index();
  _loadAllChunks();

  console.log(`🗑️ 已删除: "${docs[idx]?.title || docId}" — ${toRemove.length} 块`);
  return true;
}

/**
 * 列出所有文档
 */
function listDocuments(filters = {}) {
  let docs = _readDocs();
  if (filters.type) docs = docs.filter(d => d.sourceType === filters.type);
  if (filters.q) {
    const q = filters.q.toLowerCase();
    docs = docs.filter(d =>
      (d.title || '').toLowerCase().includes(q) ||
      (d.sourceName || '').toLowerCase().includes(q) ||
      (d.author || '').toLowerCase().includes(q)
    );
  }
  return docs;
}

/**
 * 获取单个文档详情
 */
function getDocument(docId) {
  const docs = _readDocs();
  const doc = docs.find(d => d.id === docId);
  if (!doc) return null;

  // 获取该文档的所有 chunks
  const chunks = [];
  for (const entry of allChunks) {
    if (entry.chunk.docId === docId) {
      const { embedding, ...rest } = entry.chunk;
      chunks.push(rest);
    }
  }
  chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

  return { ...doc, chunks };
}

// ============ 混合检索 ============

const { embed, embedBatch, cosineSim } = require('./embedder');

/**
 * 混合检索: BM25 + 向量 + RRF 融合
 * @param {string} query
 * @param {number} topK
 * @param {object} filters {sourceType?, docId?}
 */
async function search(query, topK = 10, filters = {}) {
  if (!chunksLoaded) await init();
  if (allChunks.length === 0) return [];

  const queryTokens = tokenize(query);

  // 1. BM25 关键词搜索
  const bm25Start = Date.now();
  const bm25Results = bm25Index.search(queryTokens, topK * 3);
  const bm25Ms = Date.now() - bm25Start;

  // 2. 向量语义搜索
  const vecStart = Date.now();
  let queryEmb;
  try {
    queryEmb = await embed(query);
  } catch {
    // embed fallback 已内置
    const { embed: fallbackEmbed } = require('./embedder');
    queryEmb = fallbackEmbed(query);
  }

  // 计算所有 chunk 的余弦相似度 (内存中)
  const vecScores = [];
  let checkedCount = 0;
  for (const entry of allChunks) {
    if (!entry.chunk.embedding) continue;

    // 应用过滤
    if (filters.sourceType || filters.docId) {
      const doc = _readDocs().find(d => d.id === entry.chunk.docId);
      if (filters.sourceType && doc && doc.sourceType !== filters.sourceType) continue;
      if (filters.docId && entry.chunk.docId !== filters.docId) continue;
    }

    const sim = cosineSim(queryEmb, new Float32Array(entry.chunk.embedding));
    vecScores.push({ ...entry, score: sim });
    checkedCount++;
  }

  vecScores.sort((a, b) => b.score - a.score);
  const vecResults = vecScores.slice(0, topK * 3);
  const vecMs = Date.now() - vecStart;

  // 3. RRF 融合
  const k = 60;
  const rrfScores = new Map();

  // BM25 → RRF
  bm25Results.forEach((r, rank) => {
    for (const entry of allChunks) {
      if (entry.shardIdx === r.shardIdx && entry.localIdx === r.chunkIdx) {
        const key = entry.chunk.id;
        rrfScores.set(key, (rrfScores.get(key) || 0) + 1 / (k + rank + 1));
        break;
      }
    }
  });

  // Vector → RRF
  vecResults.forEach((r, rank) => {
    const key = r.chunk.id;
    rrfScores.set(key, (rrfScores.get(key) || 0) + 1 / (k + rank + 1));
  });

  // 排序
  const fused = [...rrfScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK);

  // 4. 构建结果
  const results = [];
  for (const [chunkId, score] of fused) {
    const entry = allChunks.find(e => e.chunk.id === chunkId);
    if (!entry) continue;
    const doc = _readDocs().find(d => d.id === entry.chunk.docId);

    results.push({
      id: chunkId,
      text: entry.chunk.text,
      score: Math.round(score * 1000) / 1000,
      docTitle: doc?.title || entry.chunk.sectionTitle || '',
      docType: doc?.sourceType || 'unknown',
      docUrl: doc?.sourceUrl || '',
      author: doc?.author || '',
      publishDate: doc?.publishDate || '',
      sourceName: doc?.sourceName || '',
      sectionTitle: entry.chunk.sectionTitle || '',
      pageNum: entry.chunk.pageNum || null,
      docId: entry.chunk.docId,
      chunkIndex: entry.chunk.chunkIndex,
      tags: doc?.tags || [],
    });
  }

  console.log(`🔍 搜索 "${query}" → ${results.length} 条 (BM25:${bm25Results.length}/${bm25Ms}ms + Vec:${vecResults.length}/${vecMs}ms)`);

  return results;
}

// ============ 批量导入 ============

/**
 * 从 KNOWLEDGE_BASE.md 导入 (向后兼容)
 */
async function importMarkdownFile(mdPath) {
  if (!fs.existsSync(mdPath)) {
    console.log(`📭 文件不存在: ${mdPath}`);
    return null;
  }

  const text = fs.readFileSync(mdPath, 'utf-8');
  const title = path.basename(mdPath, '.md');

  // 按 ## 分段
  const sections = text.split(/\n(?=## )/);
  const titleLine = sections[0].split('\n')[0].replace(/^#+\s*/, '').trim();

  const chunks = [];
  for (const section of sections) {
    const lines = section.split('\n');
    const sectionTitle = lines[0].replace(/^#+\s*/, '').trim();
    const content = lines.slice(1).join('\n').trim();
    if (!content || content.length < 30) continue;

    // 按段落分块
    const paragraphs = content.split(/\n{2,}/);
    let currentChunk = '';
    let currentLen = 0;

    for (const para of paragraphs) {
      if (currentLen + para.length > CHUNK_SIZE && currentLen > 100) {
        chunks.push({
          text: currentChunk.trim(),
          sectionTitle,
          charCount: currentLen,
        });
        currentChunk = para;
        currentLen = para.length;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + para;
        currentLen += para.length + 2;
      }
    }
    if (currentChunk.trim()) {
      chunks.push({
        text: currentChunk.trim(),
        sectionTitle,
        charCount: currentLen,
      });
    }
  }

  console.log(`📖 解析 "${titleLine}": ${chunks.length} 个文本块`);

  // 生成 embeddings
  const texts = chunks.map(c => c.text);
  console.log(`🧠 生成 ${texts.length} 个向量...`);
  const embeddings = await embedBatch(texts);

  // 添加到存储
  return await addDocument(
    {
      title: titleLine,
      sourceType: 'manual',
      sourceName: 'SalmonFeeding 基础知识库',
      language: 'zh',
      tags: ['知识库', '养殖', '投喂', '水质', '疾病'],
    },
    chunks,
    embeddings
  );
}

// ============ 统计 ============

function getStats() {
  const meta = _readMeta();
  const docs = _readDocs();
  return {
    documentCount: docs.length,
    chunkCount: meta.totalChunks,
    totalChars: meta.totalChars,
    shardCount: meta.shardCount,
    bm25Terms: bm25Index ? Object.keys(bm25Index.terms).length : 0,
    embeddingDim: 384,
    documentsByType: docs.reduce((acc, d) => {
      acc[d.sourceType] = (acc[d.sourceType] || 0) + 1;
      return acc;
    }, {}),
  };
}

module.exports = {
  init,
  search,
  addDocument,
  removeDocument,
  listDocuments,
  getDocument,
  importMarkdownFile,
  getStats,
  tokenize,
};
