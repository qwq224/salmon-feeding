// full-build.js — 完整知识库构建：本地文档 + Web爬虫 + 学术论文
const vstore = require('./vector-store');
const { embedBatch, init: initEmbedder } = require('./embedder');
const { ingestText, ingestPDF } = require('./doc-pipeline');
const { searchSemanticScholar, ingestPaper, importNewsArticles } = require('./crawler');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('🧠 初始化 Embedding...');
  await initEmbedder();
  await vstore.init(true);

  let stats = { docs: 0, chars: 0 };

  async function addDoc(r) {
    const info = { ...r.metadata, title: r.title };
    const texts = r.chunks.map(c => c.text);
    const embs = await embedBatch(texts);
    const res = await vstore.addDocument(info, r.chunks, embs);
    stats.docs++; stats.chars += res.totalChars;
    return res;
  }

  // ====== 1. 所有本地 .md 文档 ======
  console.log('\n📝 [1/4] 本地知识文档...');
  const kd = path.join(__dirname, '..', 'data', 'knowledge');
  const kbPath = path.join(__dirname, '..', 'docs', 'KNOWLEDGE_BASE.md');

  // KNOWLEDGE_BASE.md first
  if (fs.existsSync(kbPath)) {
    const c = fs.readFileSync(kbPath, 'utf-8');
    const r = await ingestText(c, { title: '三文鱼养殖领域知识库 (完整版)', sourceType: 'manual', sourceName: 'SalmonFeeding', tags: ['知识库','完整'] });
    const i = await addDoc(r);
    console.log(`  ✅ [${i.chunkCount}块 ${i.totalChars}字] ${r.title}`);
  }

  // 专题 .md 文件
  if (fs.existsSync(kd)) {
    for (const f of fs.readdirSync(kd).filter(x => x.endsWith('.md'))) {
      const c = fs.readFileSync(path.join(kd, f), 'utf-8');
      const title = c.split('\n')[0].replace(/^#\s*/, '').trim();
      const r = await ingestText(c, { title, sourceType: 'manual', sourceName: 'SalmonFeeding', tags: ['知识库','养殖技术'] });
      const i = await addDoc(r);
      console.log(`  ✅ [${i.chunkCount}块 ${i.totalChars}字] ${title}`);
    }
  }

  // ====== 2. 内置文档 ======
  console.log('\n📝 [2/4] 内置专题文档...');
  const { BUILTIN_DOCS } = require('./crawler');
  for (const doc of BUILTIN_DOCS) {
    const r = await ingestText(doc.content, { title: doc.title, author: doc.author, sourceType: 'manual', sourceName: 'SalmonFeeding', tags: doc.tags });
    const i = await addDoc(r);
    console.log(`  ✅ [${i.chunkCount}块 ${i.totalChars}字] ${doc.title}`);
  }

  // ====== 3. RSS 新闻 + 学术论文 ======
  console.log('\n📰 [3/4] RSS新闻 + 学术论文...');
  const newsRes = await importNewsArticles();
  stats.docs += newsRes.count; stats.chars += newsRes.chars;
  console.log(`  ✅ ${newsRes.count} 篇新闻`);

  // Semantic Scholar 学术论文
  console.log('\n🎓 搜索学术论文...');
  const queries = [
    'salmon feeding strategy optimization',
    'Atlantic salmon feed conversion ratio',
    'rainbow trout feeding rate temperature',
    'aquaculture dissolved oxygen feed intake',
    'salmon recirculating aquaculture system RAS',
    'fish meal replacement salmon nutrition',
    'salmon growth model bioenergetics',
  ];
  let paperCount = 0;
  for (const q of queries) {
    console.log(`  🔍 "${q}"`);
    const papers = await searchSemanticScholar(q, 3);
    for (const p of papers) {
      const text = `Title: ${p.title}\nAuthors: ${p.authors}\nJournal: ${p.journal} (${p.year})\n\nAbstract: ${p.abstract}`;
      const r = await ingestText(text, {
        title: p.title,
        author: p.authors,
        sourceType: 'paper',
        sourceName: p.journal || 'Academic Paper',
        sourceUrl: p.url,
        publishDate: String(p.year || ''),
        tags: ['学术论文', 'Semantic Scholar', '投喂策略'],
      });
      try {
        const i = await addDoc(r);
        paperCount++;
        console.log(`    ✅ [${i.chunkCount}块 ${i.totalChars}字] ${p.title.substring(0,60)}...`);
      } catch(e) { console.log(`    ⚠️ ${e.message}`); }
      await new Promise(r => setTimeout(r, 1500));
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  stats.docs += paperCount;
  console.log(`  📄 ${paperCount} 篇学术论文`);

  // ====== 4. PDF ======
  console.log('\n📄 [4/4] PDF 文档...');
  const pdfDir = path.join(__dirname, '..', 'data', 'pdfs');
  if (fs.existsSync(pdfDir)) {
    const pdfs = fs.readdirSync(pdfDir).filter(f => f.endsWith('.pdf'));
    if (pdfs.length > 0) {
      for (const pdf of pdfs) {
        try {
          const r = await ingestPDF(path.join(pdfDir, pdf));
          const i = await addDoc(r);
          console.log(`  ✅ [${i.chunkCount}块 ${i.totalChars}字] ${pdf}`);
        } catch(e) { console.log(`  ⚠️ ${pdf}: ${e.message}`); }
      }
    } else { console.log('  📭 无PDF'); }
  }

  // ====== 最终 ======
  const s = vstore.getStats();
  console.log('\n' + '='.repeat(60));
  console.log('  🎉 完整知识库构建完毕');
  console.log('='.repeat(60));
  console.log(`  📊 ${s.documentCount} 篇文档 | ${s.chunkCount} 块`);
  console.log(`  📝 ${(s.totalChars/10000).toFixed(1)} 万字 (${(s.totalChars/1000).toFixed(0)}K字)`);
  console.log(`  📂 ${JSON.stringify(s.documentsByType)}`);
  console.log('='.repeat(60));

  if (s.totalChars >= 1000000) {
    console.log(`🏆🏆🏆 百万字达成! (${(s.totalChars/10000).toFixed(1)}万字)`);
  } else {
    const gap = ((1000000-s.totalChars)/10000).toFixed(1);
    console.log(`📈 距百万字: ${gap}万字 (${(s.totalChars/10000).toFixed(1)}/100)`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
