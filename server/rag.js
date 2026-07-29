// ================================================================
// rag.js v6 — 纯知识库检索模块 (无 LLM 依赖)
//
// 功能:
// - 领域检测: 三文鱼养殖外的问题直接拒绝
// - 知识库检索: BM25 + 向量混合检索 (vector-store.js)
// - 相关性过滤: 检索分数太低 → 拒绝
// - 结构化回答: 检索结果原文整理输出
// ================================================================

const fs = require('fs');
const path = require('path');
const vstore = require('./vector-store');

// ============ 领域检测 ============

const DOMAIN_PATTERNS = [
  // 养殖对象
  /三文鱼|大西洋鲑|虹鳟|鲑鱼|鳟鱼|salmon|trout|oncorhynchus|salmo/i,
  // 投喂/饲料/营养
  /投喂|投饲|饲料|饵料|摄食|feeding|feed|diet|nutrition|FCR|饲料系数|feeding rate/i,
  // 水质
  /水质|溶氧|DO|氨氮|亚硝酸|pH值?|碱度|水温|总悬浮物|TSS|water quality|dissolved oxygen|ammonia|nitrite/i,
  // 疾病/健康
  /疾病|弧菌|IPN|IHN|ISA|海虱|水霉|细菌|病毒|疫苗|免疫|disease|pathogen|vaccine|health|welfare/i,
  // 养殖模式/管理
  /养殖|密度|放养|RAS|循环水|网箱|鱼池|流水池|aquaculture|farming|cage|recirculating|stocking/i,
  // 生长/生理
  /生长|体重|体长|SGR|TGC|growth|weight|biomass|metabolism/i,
  // 经济/市场
  /市场|价格|成本|经济|盈亏|market|price|economic|cost|profit/i,
  // 标准/法规
  /标准|法规|认证|ASC|BAP|GlobalGAP|绿色食品|standard|regulation|certification/i,
  // 收获/加工/品质
  /收获|捕捞|加工|屠宰|品质|HACCP|harvest|slaughter|processing|quality/i,
  // 繁殖/育苗
  /繁殖|育苗|鱼苗|鱼卵|降海|smolt|银化|breeding|hatchery|juvenile/i,
  // 环境/可持续
  /环境|可持续|排放|氮磷|environment|sustainable|effluent|waste/i,
  // 鱼类通用
  /鱼体重|投饲率|饲料系数|日增重|特定生长率|肥满度|肝体比/i,
];

/**
 * 判断问题是否在三文鱼养殖领域内
 */
function isInDomain(query) {
  return DOMAIN_PATTERNS.some(p => p.test(query));
}

// ============ 回答构建 (无 LLM) ============

/**
 * 从知识库检索结果构建简洁回答
 * 核心思路：解析用户问题中的参数 → 在检索结果中找匹配的答案 → 简洁输出
 */
function _buildKBAnswer(query, results, sources) {
  if (!results || results.length === 0) {
    return _outOfScopeAnswer('no_match');
  }

  // 解析用户问题中的关键参数
  const qParams = _parseQueryParams(query);

  const allText = results.map(r => r.text || '').join('\n');
  let answer = '';

  // 1. 找与用户参数直接相关的信息
  const relevantLines = _findRelevantInfo(results, qParams);
  if (relevantLines.length > 0) {
    answer += relevantLines.join('\n');
    return answer;
  }

  // 2. 无精确匹配时，取最相关的几个信息点
  const points = [];
  const seen = new Set();
  for (let i = 0; i < Math.min(results.length, 4); i++) {
    const r = results[i];
    const cleaned = _extractInfoSentence(r.text);
    if (cleaned && cleaned.length > 5 && !seen.has(cleaned.substring(0, 40))) {
      seen.add(cleaned.substring(0, 40));
      points.push(`${cleaned} [来源:${i + 1}]`);
    }
  }

  if (points.length > 0) {
    answer = points.map((p, i) => `${i + 1}. ${p}`).join('\n');
  }

  return answer;
}

/**
 * 从用户问题中解析关键参数
 */
function _parseQueryParams(query) {
  const params = {};
  // 水温
  const tMatch = query.match(/(\d+\.?\d*)\s*[℃C°度]/);
  if (tMatch) params.temp = parseFloat(tMatch[1]);
  // 体重
  const wMatch = query.match(/(\d+\.?\d*)\s*(?:g|克|kg|公斤|千克)/i);
  if (wMatch) {
    const w = parseFloat(wMatch[1]);
    params.weight = wMatch[0].toLowerCase().includes('kg') || wMatch[0].includes('公斤') || wMatch[0].includes('千克')
      ? w * 1000 : w; // 统一为克
  }
  // 溶氧
  const doMatch = query.match(/(\d+\.?\d*)\s*(?:mg\/L|毫克)/i);
  if (doMatch) params.do = parseFloat(doMatch[1]);
  return params;
}

/**
 * 在检索结果中查找与用户参数直接相关的信息
 */
function _findRelevantInfo(results, qParams) {
  const lines = [];
  let srcIdx = 0;

  for (const r of results) {
    srcIdx++;
    const text = r.text || '';

    // 如果用户问了水温+体重 → 在文本中找匹配的行
    if (qParams.temp && qParams.weight) {
      // 在投饲率矩阵中找接近的水温和体重
      const relevant = _extractFeedingRateLine(text, qParams.temp, qParams.weight);
      if (relevant) {
        lines.push(relevant + ` [来源:${srcIdx}]`);
        continue;
      }
      // 退一步：找包含该水温的投饲率信息
      const tempLine = _findTempMatch(text, qParams.temp);
      if (tempLine) {
        lines.push(tempLine + ` [来源:${srcIdx}]`);
        continue;
      }
    }

    // 如果只问了水温
    if (qParams.temp && !qParams.weight) {
      const tempLine = _findTempMatch(text, qParams.temp);
      if (tempLine) {
        lines.push(tempLine + ` [来源:${srcIdx}]`);
        continue;
      }
    }

    // 如果问了溶氧
    if (qParams.do) {
      const doLine = _findDoMatch(text, qParams.do);
      if (doLine) {
        lines.push(doLine + ` [来源:${srcIdx}]`);
        continue;
      }
    }
  }

  return lines.slice(0, 5);
}

/**
 * 在投饲率矩阵表格中找接近水温+体重的行，返回可读的投饲率建议
 */
function _extractFeedingRateLine(text, temp, weight) {
  // 找文本中的投饲率表格数据
  const lines = text.split('\n');
  const feedingData = [];

  for (const line of lines) {
    // 匹配表格行: | 15℃ | 3.0 | 5.8 | ... (水温行)
    const tempRow = line.match(/^\|\s*(\d{1,2})\s*[℃C°]?\s*\|/);
    if (tempRow) {
      const cells = line.split('|').map(c => c.trim()).filter(c => c && !c.match(/^[-:]+$/));
      if (cells.length >= 3) {
        feedingData.push({ temp: parseFloat(cells[0]), values: cells.slice(1).map(v => parseFloat(v)) });
      }
    }
  }

  if (feedingData.length === 0) return null;

  // 找最接近的水温行
  const closest = feedingData.reduce((best, row) =>
    Math.abs(row.temp - temp) < Math.abs(best.temp - temp) ? row : best
  );

  if (Math.abs(closest.temp - temp) > 5) return null; // 差异太大不显示

  // 尝试根据体重找到对应的投饲率列
  // 体重级参考: <0.18, 0.18-1.5, 1.5-5.1, 5.1-12, 12-23, 23-39, 39-62, 62-92, 92-130, 130-180, >180 (单位g)
  let weightIdx = -1;
  if (weight >= 130) weightIdx = 9;
  else if (weight >= 92) weightIdx = 8;
  else if (weight >= 62) weightIdx = 7;
  else if (weight >= 39) weightIdx = 6;
  else if (weight >= 23) weightIdx = 5;
  else if (weight >= 12) weightIdx = 4;
  else if (weight >= 5.1) weightIdx = 3;
  else if (weight >= 1.5) weightIdx = 2;
  else if (weight >= 0.18) weightIdx = 1;
  else weightIdx = 0;

  const rate = closest.values[weightIdx];
  if (rate === undefined || isNaN(rate)) return null;

  const dailyFeed = ((weight * rate) / 100).toFixed(1);
  return `水温 **${closest.temp}℃**、体重 **${weight}g** 时，投饲率约 **${rate}%**，日投喂量约 **${dailyFeed}g/尾**`;
}

/**
 * 在文本中找与用户水温相关的信息行
 */
function _findTempMatch(text, temp) {
  const lines = text.split(/[。.\n]/);
  for (const line of lines) {
    if (line.includes(temp + '℃') || line.includes(temp + '°C') || line.includes(temp + '度')) {
      const cleaned = line.replace(/^\s*[-*•●|]\s*/, '').trim();
      if (cleaned.length > 15 && cleaned.length < 150) {
        return cleaned;
      }
    }
  }
  return null;
}

/**
 * 在文本中找与用户溶氧值相关的信息行
 */
function _findDoMatch(text, doVal) {
  const lines = text.split(/[。.\n]/);
  for (const line of lines) {
    if (line.includes(doVal + 'mg') || line.includes(doVal + ' mg')) {
      const cleaned = line.replace(/^\s*[-*•●|]\s*/, '').trim();
      if (cleaned.length > 15 && cleaned.length < 150) return cleaned;
    }
  }
  return null;
}

/**
 * 从文本中提取一句干净的信息陈述
 * 跳过表格行(|...|)、标题行(#)、FAQ标记、纯列表等
 */
function _extractInfoSentence(text) {
  if (!text) return '';

  // 按句号、换行拆分，过滤掉噪音行
  const lines = text.split(/[。.\n]/).map(s => s.trim()).filter(s => {
    if (s.length < 10 || s.length > 120) return false;
    if (/^\s*#/.test(s)) return false;                 // 标题
    if (/^\s*\|/.test(s) || /\|\s*$/.test(s)) return false;  // 表格行
    if (/^\s*[-*•●]\s/.test(s) && s.length < 30) return false; // 短列表
    if (/Q\d+[:：]/.test(s)) return false;              // FAQ 标记
    if (/^[①②③④⑤⑥⑦⑧⑨⑩]/.test(s)) return false;      // 编号列表
    if (/第[一二三四五六七八九十]章/.test(s)) return false;  // 章节标题
    return true;
  });

  // 返回第一条有效的信息句
  for (const line of lines) {
    const cleaned = line
      .replace(/^\d+[\.\、\)）]\s*/, '')  // 去掉编号
      .replace(/^[-*•●]\s*/, '')          // 去掉列表标记
      .replace(/\*\*/g, '')               // 去掉加粗标记
      .trim();
    if (cleaned.length >= 10) return cleaned;
  }

  return '';
}

/**
 * 提取文本中的关键数值参数
 */
function _extractKeyParams(text) {
  const params = [];
  const seen = new Set();

  // 水温 + 投饲率
  const tempFeedRe = /(\d{1,2})\s*[℃C°度]\s*[^。\n]{0,30}?(\d+\.?\d*)\s*[%％]/g;
  for (const m of text.matchAll(tempFeedRe)) {
    const key = `水温 ${m[1]}℃ → 投饲率 ${m[2]}%`;
    if (!seen.has(key)) { seen.add(key); params.push(key); }
  }

  // 溶氧
  const doRe = /溶?解?氧.{0,5}?(\d+\.?\d*)\s*(?:mg\/L|毫克\/升)/gi;
  for (const m of text.matchAll(doRe)) {
    const key = `溶氧: ${m[1]} mg/L`;
    if (!seen.has(key)) { seen.add(key); params.push(key); }
  }

  // FCR
  const fcrRe = /FCR.{0,10}?(\d+\.?\d*)/gi;
  for (const m of text.matchAll(fcrRe)) {
    const key = `FCR: ${m[1]}`;
    if (!seen.has(key)) { seen.add(key); params.push(key); }
  }

  // 投饲率
  const frRe = /投饲率.{0,10}?(\d+\.?\d*)\s*[%％]/g;
  for (const m of text.matchAll(frRe)) {
    const key = `投饲率: ${m[1]}%`;
    if (!seen.has(key)) { seen.add(key); params.push(key); }
  }

  // 养殖密度
  const densityRe = /密度.{0,10}?(\d+\.?\d*)\s*(?:kg\/m³|公斤\/立方)/gi;
  for (const m of text.matchAll(densityRe)) {
    const key = `养殖密度: ${m[1]} kg/m³`;
    if (!seen.has(key)) { seen.add(key); params.push(key); }
  }

  return params;
}

// ============ 搜索接口 ============

async function search(query, topK = 10) {
  return await vstore.search(query, topK);
}

// ============ 上下文与来源构建 (保留) ============

function _buildContext(results) {
  if (!results || results.length === 0) return '';

  return results.map((r, i) => {
    const header = `[来源:${i + 1} | ${r.docTitle} | ${r.sectionTitle || ''} | 类型:${r.docType}${r.author ? ' | ' + r.author : ''}]`;
    return `${header}\n${r.text.substring(0, 1200)}`;
  }).join('\n\n---\n\n');
}

function _buildSources(results) {
  if (!results || results.length === 0) return [];

  return results.map((r, i) => ({
    id: i + 1,
    title: r.docTitle || r.sectionTitle || '未知来源',
    source: r.sourceName || r.docType || '知识库',
    relevance: Math.min(5, Math.round(r.score * 5 + 1)),
    chapter: r.chunkIndex,
    snippet: r.text ? r.text.substring(0, 300) : '',
    link: r.docUrl || '',
    docType: r.docType,
    sectionTitle: r.sectionTitle || '',
    author: r.author || '',
    publishDate: r.publishDate || '',
    pageNum: r.pageNum || null,
  }));
}

// ============ 拒绝话术 ============

function _outOfScopeAnswer(reason) {
  if (reason === 'no_match') {
    return '📭 **未找到相关知识**\n\n知识库中暂无与您问题匹配的内容。\n\n💡 建议:\n- 尝试更具体的关键词，如"虹鳟投饲率"、"溶氧管理"\n- 换一种表述方式重新提问\n- 知识库正在持续扩充中，敬请期待';
  }
  // reason === 'out_of_domain' 或其他
  return '🚫 **抱歉，这超出了我的知识范围**\n\n我是三文鱼（大西洋鲑/虹鳟）养殖领域的专业助手，只能回答以下方面的问题：\n\n- 🧮 **投喂管理**: 投饲率、饲料配方、FCR、投喂策略\n- 💧 **水质管理**: 溶氧、氨氮、pH、温度、RAS 循环水系统\n- 🩺 **疾病防控**: 常见病害诊断、治疗、疫苗、生物安全\n- 📊 **生长分析**: 生长模型、SGR、体重预测\n- 🐟 **养殖技术**: 密度、育苗、降海驯化、收获加工\n- 📈 **经济与标准**: 市场行情、成本分析、行业标准\n\n💡 请提出与三文鱼/虹鳟养殖相关的问题，我很乐意帮助！';
}

// ============ 本地回退 (保留原有逻辑) ============

function _fallbackAnswer(query, results, sources) {
  const qLower = query.toLowerCase();
  let answer = '';
  const allContent = results.map(r => r.text || '').join('\n');

  // 提取关键参数
  const params = [];
  const tempMatch = allContent.match(/(\d+\.?\d*)\s*[℃C]/g);
  const doMatch = allContent.match(/(\d+\.?\d*)\s*mg\/L/g);
  if (tempMatch) params.push('水温: ' + [...new Set(tempMatch)].slice(0, 3).join(', '));
  if (doMatch) params.push('溶氧: ' + [...new Set(doMatch)].slice(0, 3).join(', '));
  if (params.length > 0) answer += '📊 **关键参数**: ' + params.join(' | ') + '\n\n';

  if (qLower.match(/溶氧|DO|溶解氧|缺氧/i))
    answer += '💧 三文鱼 DO≥9mg/L, DOmaxFI=66%(15℃), Sigmoid修正\n';
  if (qLower.match(/fcr|饲料系数|饲料转化/i))
    answer += '📈 FCR: 优秀1.0-1.2 | RAS 1.15 | 网箱 1.00 | >2.0需排查\n';
  if (qLower.match(/疾病|弧菌|水霉|海虱|治疗/i))
    answer += '🩺 预防为主。弧菌: 磺胺类75-100mg/kg饲料/周。禁用药: 孔雀石绿\n';
  if (qLower.match(/氨氮|NH3|亚硝酸/i))
    answer += '🧪 NH₃-N<0.2安全, >0.6危急。pH>8时NH₃占比急剧上升\n';

  answer += '\n📚 **参考** (' + sources.length + '条): ';
  answer += sources.slice(0, 4).map(s => s.title).join(' | ');

  return answer;
}

// ============ RAG 单轮回答 ============

async function generateAnswer(query) {
  // 1. 领域检测
  if (!isInDomain(query)) {
    return {
      answer: _outOfScopeAnswer('out_of_domain'),
      sources: [],
      outOfDomain: true,
    };
  }

  // 2. 知识库混合检索
  const results = await search(query, 8);

  // 3. 构建来源
  const sources = _buildSources(results);

  // 4. 相关性过滤: 最高分 < 0.01 或无结果 → 无匹配
  // 注: 当 BM25 索引为空时, RRF 纯向量最高分约 0.016 (1/61)
  if (!results || results.length === 0 || results[0].score < 0.01) {
    return {
      answer: _outOfScopeAnswer('no_match'),
      sources: [],
      noMatch: true,
    };
  }

  // 5. 构建纯 KB 回答 (不调用任何 LLM)
  const answer = _buildKBAnswer(query, results, sources);

  // 6. 如果构建的回答太短（极端情况），用 fallback 补充
  if (!answer || answer.length < 20) {
    const fb = _fallbackAnswer(query, results, sources);
    return { answer: fb, sources };
  }

  return { answer, sources };
}

// ============ 智能对话 (多轮 + KB only) ============

async function chat(query, history = [], options = {}) {
  // 1. 领域检测
  if (!isInDomain(query)) {
    return {
      answer: _outOfScopeAnswer('out_of_domain'),
      sources: [],
      outOfDomain: true,
    };
  }

  // 2. 知识库混合检索
  let localResults = [];
  try {
    localResults = await vstore.search(query, 8);
  } catch (e) {
    console.warn('向量检索失败:', e.message);
  }

  // 3. 构建来源
  const sources = _buildSources(localResults);

  // 4. 相关性过滤: 最高分 < 0.01 -> 无匹配 (BM25 为空时 RRF 纯向量 ~0.016)
  if (!localResults || localResults.length === 0 || localResults[0].score < 0.01) {
    return {
      answer: _outOfScopeAnswer('no_match'),
      sources: [],
      noMatch: true,
    };
  }

  // 5. 构建纯 KB 回答
  const answer = _buildKBAnswer(query, localResults, sources);

  if (!answer || answer.length < 20) {
    const fb = _fallbackAnswer(query, localResults, sources);
    return { answer: fb, sources };
  }

  return { answer, sources };
}

module.exports = { search, generateAnswer, chat, isInDomain };
