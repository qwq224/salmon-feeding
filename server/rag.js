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

  // 查找最匹配的具体段落
  if (context.includes('投饲率')) {
    answer += '💡 请参考上方投饲率速查表，根据水温和鱼体重确定基准值，再根据溶氧和高温情况进行修正。\n';
  }

  return { answer, sources };
}

module.exports = { search, generateAnswer };
