// ================================================================
// build-kb.js v3 — 百万字级知识库构建
// 来源: md文件 + KNOWLEDGE_BASE.md(86KB) + 内置文档 + RSS + PDF
// 运行: node server/build-kb.js
// ================================================================

const vstore = require('./vector-store');
const { embedBatch, init: initEmbedder } = require('./embedder');
const { ingestText, ingestPDF } = require('./doc-pipeline');
const { BUILTIN_DOCS } = require('./crawler');
const fs = require('fs');
const path = require('path');

async function ingest(fullResult, label) {
  const docInfo = { ...fullResult.metadata, title: fullResult.title };
  const texts = fullResult.chunks.map(c => c.text);
  const embeddings = await embedBatch(texts);
  return await vstore.addDocument(docInfo, fullResult.chunks, embeddings);
}

async function main() {
  console.log('🧠 初始化 Embedding...\n');
  await initEmbedder();
  await vstore.init(true);
  let totalDocs = 0, totalChars = 0;

  const add = async (r, label) => {
    try {
      const result = await ingest(r, label);
      totalDocs++; totalChars += result.totalChars;
      console.log(`  ✅ ${result.chunkCount}块 ${result.totalChars}字 → "${r.title?.substring(0,40)}"`);
      return result;
    } catch(e) {
      console.log(`  ❌ ${e.message}`);
      return null;
    }
  };

  // ---- 1. KNOWLEDGE_BASE.md (86KB - 最大单文件) ----
  console.log('📚 [1] KNOWLEDGE_BASE.md...');
  const kbPath = path.join(__dirname, '..', 'docs', 'KNOWLEDGE_BASE.md');
  if (fs.existsSync(kbPath)) {
    const content = fs.readFileSync(kbPath, 'utf-8');
    const r = await ingestText(content, { title: '三文鱼养殖领域知识库 (完整版)', sourceType: 'manual', sourceName: 'SalmonFeeding 原始知识库', tags: ['知识库', '完整'] });
    await add(r);
  }

  // ---- 2. 专题 Markdown 文档 ----
  console.log('\n📝 [2] 专题知识文档...');
  const kd = path.join(__dirname, '..', 'data', 'knowledge');
  if (fs.existsSync(kd)) {
    for (const f of fs.readdirSync(kd).filter(x => x.endsWith('.md'))) {
      const c = fs.readFileSync(path.join(kd, f), 'utf-8');
      const title = c.split('\n')[0].replace(/^#\s*/, '').trim();
      console.log(`  📄 ${title} (${(c.length/1000).toFixed(1)}K)`);
      const r = await ingestText(c, { title, sourceType: 'manual', sourceName: 'SalmonFeeding 专业知识库', tags: ['知识库','养殖技术'] });
      await add(r);
    }
  }

  // ---- 3. 内置长文档 ----
  console.log('\n📝 [3] 内置专题文档...');
  for (const doc of BUILTIN_DOCS) {
    console.log(`  📄 ${doc.title} (${(doc.content.length/1000).toFixed(1)}K)`);
    const r = await ingestText(doc.content, { title: doc.title, author: doc.author, sourceType: doc.type, sourceName: 'SalmonFeeding', tags: doc.tags });
    await add(r);
  }

  // ---- 4. RSS 新闻 ----
  console.log('\n📰 [4] RSS 新闻...');
  const np = path.join(__dirname, '..', 'data', 'news.json');
  if (fs.existsSync(np)) {
    const articles = JSON.parse(fs.readFileSync(np, 'utf-8'));
    let n = 0;
    for (const a of articles.slice(0, 30)) {
      const text = `${a.title||''}\n\n${a.summary||''}`;
      if (text.trim().length < 50) continue;
      const r = await ingestText(text, { title: (a.title||'新闻').substring(0,120), author: a.source||'', sourceType: 'web_article', sourceName: a.source||'RSS', sourceUrl: a.link||'', publishDate: (a.date||'').substring(0,10), tags: ['RSS', a.category||''].filter(Boolean) });
      const texts = r.chunks.map(c => c.text);
      const embs = await embedBatch(texts);
      await vstore.addDocument({...r.metadata, title: r.title}, r.chunks, embs);
      n++; totalDocs++; totalChars += r.chunks.reduce((s,c)=>s+(c.charCount||c.text.length),0);
    }
    console.log(`  ✅ ${n} 篇`);
  }

  // ---- 5. PDF ----
  console.log('\n📄 [5] PDF 文档...');
  const pdfDir = path.join(__dirname, '..', 'data', 'pdfs');
  if (fs.existsSync(pdfDir)) {
    const pdfs = fs.readdirSync(pdfDir).filter(f => f.endsWith('.pdf'));
    if (pdfs.length > 0) {
      for (const pdf of pdfs) {
        console.log(`  📄 ${pdf}`);
        try {
          const r = await ingestPDF(path.join(pdfDir, pdf));
          await add(r);
        } catch(e) { console.log(`  ⚠️ ${e.message}`); }
      }
    } else { console.log('  📭 空 (放PDF至data/pdfs/)'); }
  }

  // ---- 统计 ----
  const s = vstore.getStats();
  const wan = (s.totalChars/10000).toFixed(1);
  console.log('\n'+'='.repeat(55));
  console.log(`  🎉 知识库构建完成`);
  console.log('='.repeat(55));
  console.log(`  📊 文档: ${s.documentCount} 篇`);
  console.log(`  📦 块: ${s.chunkCount} | 📝 ${wan}万字 (${(s.totalChars/1000).toFixed(0)}K)`);
  console.log(`  🔤 BM25: ${s.bm25Terms}词 | 📐 ${s.embeddingDim}维`);
  console.log(`  📂 ${JSON.stringify(s.documentsByType)}`);
  console.log('='.repeat(55));
  const target = 1000000;
  if (s.totalChars >= target) {
    console.log(`🏆 百万字达成! (${(s.totalChars/target*100).toFixed(0)}%)`);
  } else {
    const gap = ((target-s.totalChars)/10000).toFixed(1);
    console.log(`📈 距百万字差 ${gap} 万字 (${(s.totalChars/target*100).toFixed(1)}%)`);
    console.log('💡 下一步: node server/crawler.js → 爬取NOAA/FAO/学术论文');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
