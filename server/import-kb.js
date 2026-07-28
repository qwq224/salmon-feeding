// 导入 KNOWLEDGE_BASE.md 所有章节到知识库
const { embedBatch } = require('./embedder');
const vstore = require('./vector-store');
const { ingestText } = require('./doc-pipeline');
const fs = require('fs');
const path = require('path');

(async () => {
  await vstore.init();

  const kbPath = path.join(__dirname, '..', 'docs', 'KNOWLEDGE_BASE.md');
  const fullText = fs.readFileSync(kbPath, 'utf-8');

  // 按 ## 和 # 标题拆分
  const sections = fullText.split(/\n(?=#{1,2} [^\n]+)/);

  let imported = 0, totalChars = 0, skipped = 0;

  for (const section of sections) {
    const text = section.trim();
    if (text.length < 500) continue;

    const titleMatch = text.match(/^#{1,2}\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].replace(/[#*]/g, '').trim() : '知识库章节';

    try {
      const result = await ingestText(text, {
        title,
        author: 'SalmonFeeding 知识库',
        sourceType: 'manual',
        sourceName: '领域知识库 v3',
        tags: ['知识库', '投喂', '养殖', '综合'],
      });

      const chunks = result.chunks.map(c => c.text);
      const embeddings = await embedBatch(chunks);
      const docResult = await vstore.addDocument(result.metadata, result.chunks, embeddings);

      console.log(`✅ ${title.substring(0, 50)} — ${docResult.chunkCount}块 ${docResult.totalChars}字`);
      imported++;
      totalChars += docResult.totalChars;
    } catch(e) {
      console.log(`⚠️ ${title.substring(0, 50)}: ${e.message.substring(0, 80)}`);
      skipped++;
    }
  }

  const stats = vstore.getStats();
  console.log(`\n📊 导入 ${imported} 章节, ${totalChars.toLocaleString()} 字 (跳过 ${skipped})`);
  console.log(`📊 知识库总计: ${stats.documentCount} 篇, ${stats.chunkCount} 块, ${(stats.totalChars/10000).toFixed(1)} 万字`);
})();
