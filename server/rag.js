// ================================================================
// rag.js — RAG 检索增强生成模块
// ================================================================
// 将领域知识文档分段，构建简易向量检索
// 实际生产可接 Claude API 或向量数据库

const fs = require('fs');
const path = require('path');

// 加载知识文档
const kbPath = path.join(__dirname, '..', 'docs', 'KNOWLEDGE_BASE.md');
const kbText = fs.readFileSync(kbPath, 'utf-8');

// 按 ## 分段
const sections = kbText.split('## ').filter(s => s.trim().length > 0);

// 简易 TF-IDF 检索
function search(query, topK = 5) {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const scored = sections.map((section, idx) => {
    const lower = section.toLowerCase();
    let score = 0;
    terms.forEach(term => {
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = lower.match(regex);
      if (matches) score += matches.length;
      // 标题匹配加权
      const title = section.split('\n')[0];
      if (title.toLowerCase().includes(term)) score += 3;
    });
    return { idx, section, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(s => ({
      content: s.section.trim(),
      relevance: Math.min(s.score, 10),
    }));
}

// 从检索结果生成回答
function generateAnswer(query) {
  const results = search(query, 3);
  if (results.length === 0) {
    return {
      answer: '未找到相关知识。请尝试搜索水温、投喂率、溶氧、FCR等关键词。',
      sources: [],
    };
  }

  // 拼接相关知识段落
  const context = results.map(r => r.content).join('\n\n');

  let answer = `基于以下 ${results.length} 条知识来源:\n\n`;
  const sources = results.map((r, i) => ({
    title: r.content.split('\n')[0].replace(/^#+\s*/, ''),
    relevance: r.relevance,
  }));

  // 提取关键数字
  const numbers = context.match(/\d+\.?\d*\s*(mg\/L|℃|g|kg|%)/g) || [];
  if (numbers.length > 0) {
    answer += `📊 关键数据: ${numbers.join(', ')}\n\n`;
  }

  // 精确匹配回答增强
  if (context.includes('DOmaxFI') || context.includes('Remen')) {
    answer += '💡 根据Remen et al.(2016), 维持DO在DOmaxFI以上对最大化摄食和生长至关重要。商业网箱养殖建议在实验室值基础上+40%安全余量。\n';
  }
  if (context.includes('孙国祥') || context.includes('生长模型')) {
    answer += '💡 孙国祥(2014)博士论文建立了首个大西洋鲑循环水养殖投喂-生长-排泄定量模型, 经生产验证偏离度<24%。\n';
  }
  if (context.includes('DB63') || context.includes('行业标准')) {
    answer += '💡 以上数据来源于青海省地方标准, 适用于虹鳟网箱养殖, 其他鲑科鱼类可参考调整。\n';
  }

  return { answer, sources };
}

module.exports = { search, generateAnswer };
