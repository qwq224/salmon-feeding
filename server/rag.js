// ================================================================
// rag.js v7 — 纯知识库检索 + 回答质检
//
// 功能:
// - 领域检测: 三文鱼养殖外的问题直接拒绝
// - 知识库检索: BM25 + 向量混合检索 (vector-store.js)
// - 定向提取: 根据问题意图从结果中匹配最相关句子
// - 回答质检: 验证答案是否真的回答了用户问题，不合格就说不知道
// ================================================================

const vstore = require('./vector-store');

// ============ 投饲率速查表 (来源:《水产动物营养与饲料学》) ============

const FEEDING_TABLE = {
  temps: [2, 5, 8, 10, 12, 15, 18, 20],
  weightCols: [
    { max: 0.18,  label: '<0.18g' },
    { max: 1.5,   label: '0.18-1.5g' },
    { max: 5.1,   label: '1.5-5.1g' },
    { max: 12,    label: '5.1-12g' },
    { max: 23,    label: '12-23g' },
    { max: 39,    label: '23-39g' },
    { max: 62,    label: '39-62g' },
    { max: 92,    label: '62-92g' },
    { max: 130,   label: '92-130g' },
    { max: 180,   label: '130-180g' },
    { max: Infinity, label: '>180g' },
  ],
  rates: {
     2: [2.1, 1.8, 1.4, 1.0, 1.0, 0.8, 0.7, 0.6, 0.5, 0.5, 0.4],
     5: [2.6, 2.2, 1.8, 1.4, 1.3, 1.1, 0.9, 0.8, 0.7, 0.6, 0.5],
     8: [3.2, 2.8, 2.2, 1.7, 1.6, 1.3, 1.1, 1.0, 0.9, 0.8, 0.7],
    10: [3.9, 3.4, 2.6, 2.1, 2.0, 1.6, 1.4, 1.2, 1.1, 0.9, 0.8],
    12: [4.8, 4.0, 3.2, 2.5, 2.4, 1.9, 1.6, 1.4, 1.3, 1.1, 1.0],
    15: [5.8, 4.8, 3.9, 3.0, 2.8, 2.3, 1.9, 1.7, 1.5, 1.3, 1.3],
    18: [7.0, 5.8, 4.8, 3.7, 3.4, 2.8, 2.2, 2.0, 1.8, 1.6, 1.5],
    20: [7.9, 6.6, 5.5, 4.4, 4.0, 3.2, 2.5, 2.2, 2.0, 1.8, 1.7],
  },
};

function _lookupFeedingRate(temp, weightG) {
  const temps = FEEDING_TABLE.temps;
  let tIdx = 0;
  for (let i = 0; i < temps.length; i++) {
    if (temps[i] >= temp) { tIdx = i; break; }
    tIdx = i;
  }
  if (tIdx > 0 && temps[tIdx] !== temp) {
    if (Math.abs(temps[tIdx - 1] - temp) < Math.abs(temps[tIdx] - temp)) tIdx = tIdx - 1;
  }
  const cols = FEEDING_TABLE.weightCols;
  let wIdx = 0;
  for (let i = 0; i < cols.length; i++) {
    if (weightG <= cols[i].max) { wIdx = i; break; }
  }
  const closestTemp = temps[tIdx];
  const rate = FEEDING_TABLE.rates[closestTemp][wIdx];
  return { temp: closestTemp, rate, label: cols[wIdx].label, diff: Math.abs(closestTemp - temp) };
}

// ============ 领域检测 ============

const DOMAIN_PATTERNS = [
  // 明确养殖对象
  /三文鱼|大西洋鲑|虹鳟|鲑鱼|鳟鱼|salmon|trout|oncorhynchus|salmo/i,
  // 技术术语
  /投喂|投饲|饲料|饵料|摄食|feeding|feed|diet|nutrition|FCR|饲料系数/i,
  /水质|溶氧|DO|氨氮|亚硝酸|pH值?|碱度|水温|TSS|water quality|ammonia|nitrite/i,
  /疾病|弧菌|IPN|IHN|ISA|海虱|水霉|细菌|病毒|疫苗|免疫|disease|pathogen|vaccine/i,
  /养殖|密度|放养|RAS|循环水|网箱|鱼池|aquaculture|farming|cage|recirculating|stocking/i,
  /生长|体重|体长|SGR|TGC|growth|weight|biomass/i,
  /市场|价格|成本|经济|盈亏|market|price|economic|cost/i,
  /标准|法规|认证|ASC|BAP|GlobalGAP|绿色食品|standard|regulation/i,
  /收获|捕捞|加工|屠宰|HACCP|harvest|slaughter|processing|quality/i,
  /繁殖|育苗|鱼苗|鱼卵|降海|smolt|银化|breeding|hatchery/i,
  /环境|可持续|排放|氮磷|environment|sustainable|effluent/i,
  /鱼体重|投饲率|饲料系数|日增重|特定生长率|肥满度|肝体比/i,
  // 口语化 — 含有"鱼"的日常问题
  /鱼.{0,5}(不吃|不食|死了|病|浮头|游|长|烂|出血|掉鳞|没精神)/,
  /鱼.{0,3}(怎么|为啥|为什么|好像|突然|最近|一直)/,
  /(不吃|不食|喂|吃).{0,3}(东西|食|饲料|什么|了吗|了呀)/,
  /我的鱼|这鱼|养的鱼|塘里的鱼|池里的鱼|箱里的鱼/,
  // 口语化水质
  /水.{0,3}(浑|臭|变|脏|绿|黄|有问题|不行|不好)/,
  /(缺氧|浮头|翻肚|大口喘气|呼吸急促|游到水面)/,
  // 口语化异常 (要求同时含"鱼")
  /(生病|得病|发病|有病|不对劲|不正常|出问题|异常).{0,5}(了|啦|吗)/,
  // 养鱼场景默认词 — 这些词出现且同时提到鱼/水/养殖 → 在领域内
  /(怎么办|咋办|怎么处理|怎么治|用什么药|要注意什么).{0,5}(鱼|水|塘|池|箱)/,
  /(鱼|水|塘|池|箱).{0,5}(怎么办|咋办|怎么处理|怎么治|要注意什么)/,
];

// 低置信度兜底：只要提到了"鱼"且不是在明显的非养殖语境中
const HAS_FISH = /[鱼漁]|fish/i;
const NON_FISH_CONTEXT = /(钓鱼|捕鱼|吃鱼|烧鱼|蒸鱼|煎鱼|炸鱼|水煮鱼|酸菜鱼|烤鱼|生鱼片|鱼香|咸鱼|金鱼|热带鱼|观赏鱼|鲨鱼|鲸鱼)/i;

function isInDomain(query) {
  // 高置信度模式直接通过
  if (DOMAIN_PATTERNS.some(p => p.test(query))) return true;
  // 兜底：提到了"鱼"且不在明显的非养殖语境中
  if (HAS_FISH.test(query) && !NON_FISH_CONTEXT.test(query)) return true;
  return false;
}

// ============ 高频口语映射 (直接匹配 FAQ) ============

const COLLOQUIAL_FAQS = [
  {
    pattern: /(不吃|不食|拒食|厌食|不吃东西|不吃食|没胃口)/,
    answer: '三文鱼不吃食的常见原因（按概率排序）：\n1. 溶氧偏低（<6mg/L，占40%）— 先测DO\n2. 水温骤变（>2℃变化）— 检查温度记录\n3. 氨氮超标（>0.2mg/L）— 测NH₃-N\n4. 疾病（弧菌/IPN/寄生虫）— 检查体表和鳃\n5. 应激（刚分级/运输/转池后）— 停食24-48h观察\n6. 饲料更换 — 新旧料逐步过渡7-10天\n\n建议步骤：停食1天 → 检测水质（DO/NH₃/T）→ 观察鱼群行为 → 逐一排查上述原因。',
  },
  {
    pattern: /(生病|得病|有病|不对劲|不正常|好像病)/,
    answer: '鱼行为异常时的排查步骤：\n1. 观察鱼群行为（浮头/离群/擦底/厌食/游姿异常）\n2. 检查水质（DO、NH₃、NO₂⁻、pH、水温）\n3. 捞3-5尾鱼检查体表（出血/白点/溃疡/寄生虫/鳃色）\n4. 如有死鱼，解剖检查内脏（肝色/肠道/腹水）\n5. 必要时送实验室做细菌培养或病毒检测\n\n常见病参考：弧菌病（体表出血）、IPN（发黑螺旋游动）、水霉（白色棉絮状）、小瓜虫（体表白点）。',
  },
  {
    pattern: /水.{0,3}(浑|臭|脏|绿|黄|有问题|不好|不行)/,
    answer: '水质异常排查：\n1. 水浑（浑浊）→ 悬浮物过多，检查微筛机/加强过滤\n2. 水臭（异味）→ 有机物腐败/厌氧区，检查死鱼/加强曝气\n3. 水绿（藻类）→ 光照过强+营养盐高，遮光+增加换水\n4. 泡沫多 → 蛋白质积累，加强蛋白分离器/增加换水\n5. 水面有油膜 → 饲料脂肪析出/水泵漏油，检查设备\n\n先测DO、NH₃、NO₂⁻、pH确认水质安全。',
  },
  {
    pattern: /(鱼死|死了|死亡|死鱼)/,
    answer: '发现死鱼的紧急处理：\n1. 立即捞出所有死鱼，计数并记录症状\n2. 停食24-48小时\n3. 检测水质（DO/NH₃/NO₂⁻/T/pH）\n4. 检查死鱼外观（体表出血？鳃色？眼球？腹部？）\n5. 正常死亡率<0.05%/天，超过0.1%需排查\n6. 如连续死亡3天以上，取样送实验室检测\n\n常见致死原因：缺氧、氨氮中毒、弧菌病、IPN（稚鱼）。',
  },
  {
    pattern: /(鱼浮头|浮头|缺氧|喘气|大口呼吸)/,
    answer: '鱼浮头/缺氧的应急处理：\n1. 立即全负荷增氧+启动纯氧补充\n2. 停止投喂（消化耗氧）\n3. 加大换水量（水源DO需达标）\n4. 排查缺氧原因：停电/设备故障/密度过高/高温/生物滤池堵塞\n5. DO恢复至>7mg/L后逐步恢复正常\n\nDO分级：轻度5-7mg/L(摄食减少)，中度3-5mg/L(浮头)，重度<3mg/L(大口呼吸/失衡)，危急<2mg/L(大批死亡)。',
  },
];

function _checkColloquialFAQs(query) {
  for (const faq of COLLOQUIAL_FAQS) {
    if (faq.pattern.test(query)) return faq.answer;
  }
  return null;
}

// ============ 回答构建 ============

function _buildKBAnswer(query, results, sources) {
  if (!results || results.length === 0) return '';

  // 优先匹配口语化 FAQ
  const faqAnswer = _checkColloquialFAQs(query);
  if (faqAnswer) {
    if (sources.length > 0) return faqAnswer + '\n\n📖 参考知识库文档 [来源:1]';
    return faqAnswer;
  }

  const qParams = _parseQueryParams(query);
  const intent = _classifyIntent(query, qParams);
  let answer = '';

  // 投喂量计算 → 查表
  if (intent === 'feeding_rate' && qParams.temp && qParams.weight) {
    answer = _buildFeedingRateAnswer(qParams, sources);
  } else {
    // 其他问题 → 关键词匹配
    answer = _buildTargetedAnswer(query, results);
  }

  // 质检
  if (!_validateAnswer(query, answer, intent)) {
    return '📭 抱歉，知识库中暂时没有找到与您问题直接相关的信息。\n\n💡 建议尝试换个方式提问，或查看知识库文档。';
  }

  return answer;
}

function _classifyIntent(query, qParams) {
  if (qParams.temp && (qParams.weight || /投喂|投饲|日投喂|投喂量|feeding/.test(query)))
    return 'feeding_rate';
  if (/溶氧|DO|缺氧|氨氮|亚硝酸|pH|水质|超标|紧急|应急|怎么办/.test(query))
    return 'water_quality';
  return 'general';
}

function _buildFeedingRateAnswer(qParams, sources) {
  const { temp, weight } = qParams;
  const r = _lookupFeedingRate(temp, weight);
  if (!r) return '';

  const dailyFeed = ((weight * r.rate) / 100).toFixed(1);
  let answer = `水温 **${r.temp}℃**、体重 **${weight}g**（${r.label}）→ 投饲率 **${r.rate}%**，日投喂量约 **${dailyFeed}g/尾**`;
  if (r.diff > 0) answer += `（最接近水温 ${r.temp}℃）`;

  if (weight > 10) {
    const adj = (r.rate * 0.84).toFixed(1);
    answer += `\n- ⚠️ 鱼体重 >10g，修正系数 0.84：校正投饲率 **${adj}%**，日投喂量 **${((weight * parseFloat(adj)) / 100).toFixed(1)}g/尾**`;
  }

  if (sources.length > 0) answer += `\n\n📖 数据来源：《水产动物营养与饲料学》虹鳟投饲率标准表 [来源:1]`;
  return answer;
}

function _buildTargetedAnswer(query, results) {
  const keywords = _extractKeywords(query);
  if (keywords.length === 0) return '';

  // 先尝试从表格中提取（应急措施常见于表格）
  const tableLines = _extractFromTable(results, keywords);
  const scored = [];
  const seen = new Set();

  // 表格内容优先
  for (const tl of tableLines) {
    const key = tl.text.substring(0, 50);
    if (!seen.has(key)) {
      seen.add(key);
      scored.push({ text: tl.text, srcIdx: tl._src, hits: 10 });
    }
  }

  // 再搜普通句子
  for (let i = 0; i < Math.min(results.length, 8); i++) {
    const text = results[i].text || '';
    const hits = keywords.filter(kw => text.includes(kw)).length;
    if (hits === 0) continue;

    const sentence = _bestMatchingSentence(text, keywords);
    if (!sentence) continue;

    const key = sentence.substring(0, 50);
    if (!seen.has(key)) {
      seen.add(key);
      scored.push({ text: sentence, srcIdx: i + 1, hits });
    }
  }

  scored.sort((a, b) => b.hits - a.hits);
  if (scored.length === 0) return '';

  return scored.slice(0, 5)
    .map((l, idx) => `${idx + 1}. ${l.text} [来源:${l.srcIdx}]`)
    .join('\n');
}

/**
 * 从表格行提取相关信息（应急手册中大量关键数据在表格里）
 * 表格被 smartChunk 压缩成: | 级别 | DO范围 | 症状 | 应急措施 | | 轻度 | 5-7 mg/L | 摄食减少 | ... |
 */
function _extractFromTable(results, keywords) {
  const lines = [];
  for (let i = 0; i < Math.min(results.length, 5); i++) {
    const text = results[i].text || '';
    if (!text.includes('|')) continue;
    const hits = keywords.filter(kw => text.includes(kw)).length;
    if (hits === 0) continue;

    // 按双竖线 || 或 | | 拆分行
    const rows = text.split(/\|\s*\|/);
    for (const row of rows) {
      const cells = row.split('|').map(c => c.trim()).filter(c => c && c.length > 1 && !/^[-:=]+$/.test(c));
      if (cells.length < 2) continue;

      // 跳过表头行（级别、项目、参数等）
      const headerWords = /^(级别|指标|项目|参数|标准|范围|水温|体重|阶段|时间|指标|名称|饲料)$/;
      if (cells.every(c => headerWords.test(c) || c.length < 3)) continue;

      const rowHits = keywords.filter(kw => row.includes(kw)).length;
      if (rowHits === 0) continue;

      // 整理：取前2项做标签，后面的做内容
      const label = cells.slice(0, 2).filter(c => !/^-+$/.test(c)).join('：');
      const content = cells.slice(2).filter(c => c.length > 2).join(' → ');
      const formatted = content ? `**${label}**：${content}` : cells.join(' | ');
      if (formatted.length > 10 && formatted.length < 300) {
        lines.push({ text: formatted, _src: i + 1 });
      }
    }
  }
  return lines.filter(l => keywords.some(kw => l.text.includes(kw))).slice(0, 5);
}

function _extractKeywords(query) {
  const cleaned = query
    .replace(/我的|最近|可能|什么|怎么|怎样|如何|多少|哪|请|问|一下|帮我|告诉|应该|需要|可以|还是|吗|呢|啊|吧|这是|那个|现在|已经|发现|出现|开始|这个|如果|因为|所以|但是/g, ' ')
    .replace(/[？?！!，,。.：:]/g, ' ');
  const words = cleaned.match(/[一-鿿]{2,3}|[a-zA-Z]{2,}|\d+\.?\d*/g) || [];
  const junkWords = /^(我的|最近|可能|什么|怎么|这是|那个|现在|已经|发现|出现|开始|还是|应该|需要|可以|一下|这个|如果|因为|所以|但是|或者|而且|关于|对于|以及|不过|一般|那种|各种|不同|一样|一些|一点|比较|非常|特别|基本|主要|重要)$/;
  const result = [...new Set(words)].filter(w => w.length >= 2 && !junkWords.test(w));

  // 补充拆分
  const extra = [];
  for (const w of result) {
    if (/^[一-鿿]{3,}$/.test(w)) {
      for (let i = 0; i < w.length - 1; i++) extra.push(w.substring(i, i + 2));
    }
    // 数字+单位 → 单独提取数字（"5mg" → +"5"）
    const numMatch = w.match(/^(\d+\.?\d*)/);
    if (numMatch && numMatch[1] !== w) extra.push(numMatch[1]);
  }
  // 中英同义词
  const synonymMap = {
    '溶氧': ['DO', '溶解氧', 'dissolved oxygen'],
    '氨氮': ['NH3', 'NH₃', 'TAN', 'ammonia'],
    '亚硝酸': ['NO2', 'NO₂', 'nitrite'],
    '浮头': ['gasping', 'surface'],
    '投喂': ['feeding', 'feed'],
    '饲料': ['feed', 'diet'],
    '疾病': ['disease', 'pathogen'],
    '密度': ['density', 'stocking'],
    '生长': ['growth', 'SGR'],
    '应激': ['stress', 'cortisol'],
    '缺氧': ['hypoxia', 'low oxygen', 'low DO'],
    '不吃食': ['拒食', '厌食', '摄食差', '摄食减少', '食欲不振', '食欲减退'],
    '不吃': ['拒食', '厌食', '食欲不振'],
    '不吃东西': ['拒食', '厌食', '不吃食'],
    '鱼不吃': ['不吃食', '拒食', '厌食'],
  };
  for (const [cn, ens] of Object.entries(synonymMap)) {
    if (result.some(w => w.includes(cn) || cn.includes(w)) || query.includes(cn)) {
      extra.push(...ens);
    }
  }

  return [...new Set([...result, ...extra])];
}

function _bestMatchingSentence(text, keywords) {
  const sentences = text.split(/[。.；;！!\n]/).map(s => s.trim()).filter(s => {
    if (s.length < 10 || s.length > 200) return false;
    if (/^\d+[a-z]?\s*[|]/.test(s)) return false;       // "2g | — | 5000" 表格碎片
    if (/^[-\s—]*$/.test(s)) return false;               // 纯分隔线
    if (/^[a-z]{1,3}\s*\|/i.test(s)) return false;       // "mg | L |" 单位碎片
    return true;
  });
  if (sentences.length === 0) return null;

  let best = null, bestHits = 0;
  for (const s of sentences) {
    if (/^\s*[#|\-*>]/.test(s)) continue;
    if (/\|/.test(s)) continue;                         // 含管道符=表格碎片
    if (/第[一二三四五六七八九十]章/.test(s)) continue;
    if (/^[①②③④⑤⑥⑦⑧⑨⑩]/.test(s)) continue;

    const hits = keywords.filter(kw => s.includes(kw)).length;
    if (hits > bestHits) {
      bestHits = hits;
      best = s.replace(/\*\*/g, '').replace(/^Q?\d+[\.\、\)）：:]\s*/, '').trim();
    }
  }

  return bestHits >= 1 ? best : null;
}

function _validateAnswer(query, answer, intent) {
  if (!answer || answer.trim().length < 10) return false;
  if (answer.includes('📭')) return true;

  const keywords = _extractKeywords(query);
  if (keywords.length === 0) return true;

  // 只计算基础关键词的命中率（不含同义词扩展的英文词）
  const baseKeywords = keywords.filter(kw => /[一-鿿]/.test(kw) || /^\d+/.test(kw));
  const hits = baseKeywords.filter(kw => answer.includes(kw)).length;
  const ratio = baseKeywords.length > 0 ? hits / baseKeywords.length : 1;

  // 表格答案放宽：有关键词匹配+数字相近即通过
  const hasTableData = answer.includes('**') && answer.includes('：');
  const nums = query.match(/\d+\.?\d*/g);
  const queryNums = nums ? nums.map(parseFloat) : [];
  const answerNums = (answer.match(/\d+\.?\d*/g) || []).map(parseFloat);
  const anyNumMatch = queryNums.length === 0 || queryNums.some(qn =>
    answerNums.some(an => Math.abs(an - qn) <= 2)
  );

  if (hasTableData && hits >= 1 && anyNumMatch) return true;
  if (!anyNumMatch) return false;

  return ratio >= 0.2;
}

function _parseQueryParams(query) {
  const params = {};
  const tMatch = query.match(/(\d+\.?\d*)\s*[℃C°度]/);
  if (tMatch) params.temp = parseFloat(tMatch[1]);
  const wMatch = query.match(/(\d+\.?\d*)\s*(?:g|克|kg|公斤|千克)/i);
  if (wMatch) {
    const w = parseFloat(wMatch[1]);
    params.weight = /kg|公斤|千克/i.test(wMatch[0]) ? w * 1000 : w;
  }
  const doMatch = query.match(/(\d+\.?\d*)\s*(?:mg\/L|毫克)/i);
  if (doMatch) params.do = parseFloat(doMatch[1]);
  return params;
}

// ============ 搜索接口 ============

async function search(query, topK = 10) {
  return await vstore.search(query, topK);
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
    return '📭 **未找到相关知识**\n\n知识库中暂无与您问题匹配的内容。\n\n💡 建议尝试更具体的关键词，或查看知识库文档。';
  }
  return '🚫 **抱歉，这超出了我的知识范围**\n\n我是三文鱼（大西洋鲑/虹鳟）养殖领域的专业助手，只能回答以下方面的问题：\n\n- 🧮 **投喂管理**: 投饲率、饲料配方、FCR、投喂策略\n- 💧 **水质管理**: 溶氧、氨氮、pH、温度、RAS 循环水系统\n- 🩺 **疾病防控**: 常见病害诊断、治疗、疫苗、生物安全\n- 📊 **生长分析**: 生长模型、SGR、体重预测\n- 🐟 **养殖技术**: 密度、育苗、降海驯化、收获加工\n- 📈 **经济与标准**: 市场行情、成本分析、行业标准\n\n💡 请提出与三文鱼/虹鳟养殖相关的问题，我很乐意帮助！';
}

// ============ RAG 回答 ============

async function generateAnswer(query) {
  if (!isInDomain(query)) {
    return { answer: _outOfScopeAnswer('out_of_domain'), sources: [], outOfDomain: true };
  }

  const results = await search(query, 8);
  const sources = _buildSources(results);

  if (!results || results.length === 0 || results[0].score < 0.01) {
    return { answer: _outOfScopeAnswer('no_match'), sources: [], noMatch: true };
  }

  const answer = _buildKBAnswer(query, results, sources);
  if (!answer || answer.length < 10) {
    return { answer: _outOfScopeAnswer('no_match'), sources: [], noMatch: true };
  }

  return { answer, sources };
}

async function chat(query, history = [], options = {}) {
  if (!isInDomain(query)) {
    return { answer: _outOfScopeAnswer('out_of_domain'), sources: [], outOfDomain: true };
  }

  let localResults = [];
  try {
    localResults = await vstore.search(query, 8);
  } catch (e) {
    console.warn('向量检索失败:', e.message);
  }

  const sources = _buildSources(localResults);

  if (!localResults || localResults.length === 0 || localResults[0].score < 0.01) {
    return { answer: _outOfScopeAnswer('no_match'), sources: [], noMatch: true };
  }

  const answer = _buildKBAnswer(query, localResults, sources);
  if (!answer || answer.length < 10) {
    return { answer: _outOfScopeAnswer('no_match'), sources: [], noMatch: true };
  }

  return { answer, sources };
}

module.exports = { search, generateAnswer, chat, isInDomain };
