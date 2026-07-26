// ================================================================
// rag.js — RAG 检索增强生成模块 v4
// 知识检索 + Claude API 智能回答 + 本地回退
// ================================================================

const fs = require('fs');
const path = require('path');

// 加载知识文档
const kbPath = path.join(__dirname, '..', 'docs', 'KNOWLEDGE_BASE.md');
const kbText = fs.readFileSync(kbPath, 'utf-8');

// 按 ## 分段
const sections = kbText.split(/\n## /).filter(s => s.trim().length > 0);

// ---- 全量关键词-章节映射 ----
const KEYWORD_MAP = {
  // 第一章：投饲率速查
  '投饲率':[1],'投喂率':[1,3],'投喂量':[1],'查表':[1],'双线性':[1],'插值':[1],
  '基准投饲率':[1],'温度修正':[1],'低温修正':[1],'高温修正':[1],
  '8步计算':[1],'总生物量':[1],'抽样称重':[1],'变异系数':[1],'CV':[1],
  '虹鳟':[1,2,9],'rainbow trout':[1],'mykiss':[1],

  // 第二章：大规格商品鱼
  '大规格':[2],'商品鱼':[2],'出塘':[2],'DB63':[2,7,15],'1042':[2,15],
  '网箱养殖':[2,7,14],'分箱':[2],'出塘标准':[2],'冰鲜':[2],'出口':[2],

  // 第三章：大西洋鲑投喂策略
  '孙国祥':[3],'正交实验':[3],'中科院':[3],'大西洋鲑':[3,13],
  '生长模型':[3,5,13],'氮磷排放':[3],'氮排放':[3],'磷排放':[3],
  '偏离度':[3],'消化最优':[3],'饲料效率最优':[3],'降海鲑':[3],'smolt':[3],

  // 第四章：DOmaxFI模型
  'Remen':[4],'DOmaxFI':[4,5,9,12],'溶氧阈值':[4],'安全余量':[4,10],
  'Sigmoid':[4,5],'半饱和':[4],'LOS':[4],'摄食停止':[4],
  'Nofima':[4],'氧转移':[12],'OTE':[12],

  // 第五章：FI预测模型
  'Azevedo':[5],'FI模型':[5],'异速生长':[5],'α':[5],'β':[5],'γ':[5],
  '基础代谢':[5],'BW^β':[5],'e^γT':[5],'三因素':[5],
  '敏感性分析':[5],'局限性':[5],

  // 第六章：FCR
  'FCR':[6,14,17],'饲料系数':[6],'饲料转化':[6],'转化率':[6],
  'eFCR':[6],'经济FCR':[6],'诊断流程图':[6],'饲料效率':[6],
  '过量投喂':[6,17],'残饵':[6],

  // 第七章：密度
  '密度':[7],'放养':[7],'kg/m³':[7],'kg/m3':[7],'kg/m2':[7],
  '平列槽':[7],'发眼卵':[7],'密度应激':[7],'皮质醇':[7],
  '分箱原则':[7],'社会facilitation':[7],

  // 第八章：投喂频率
  '投喂频率':[8],'投喂时间':[8],'次数':[8],'频率':[8],
  '饱食':[8],'抢食':[8],'声学监测':[8],'残饵收集':[8],
  '光周期':[8],'光照':[8],'季节性调整':[8],'冬季':[8],

  // 第九章：水质
  '水质':[9],'水环境':[9],'监测':[9],'水温':[1,4,9,13,17],
  '溶解氧':[9],'DO':[4,9,12],'溶氧':[4,9,12,17],
  'pH':[9],'酸碱':[9],'碱度':[9],'Alkalinity':[9],
  '氨氮':[9,17],'NH3':[9],'TAN':[9],'NH4':[9],'游离氨':[9],
  '亚硝酸盐':[9],'NO2':[9],'亚硝酸':[9],'硝酸盐':[9],'NO3':[9],
  '二氧化碳':[9,17],'CO2':[9],'TSS':[9],'悬浮物':[9],
  '硫化氢':[9],'H2S':[9],'ORP':[9],'氧化还原':[9],
  '日变化':[9],'凌晨':[9],'水质异常诊断':[9],'浮头':[9],

  // 第十章：疾病
  '疾病':[10,17],'生病':[10],'病':[10,17],'细菌':[10],
  '弧菌':[10],'疖疮':[10],'BKD':[10],'IPN':[10],'IHN':[10],
  'ISA':[10],'PD':[10],'胰腺':[10],'水霉':[10],'Saprolegnia':[10],
  '三代虫':[10],'海虱':[10,17],'AGD':[10],'阿米巴':[10],
  '病毒':[10],'疫苗':[10],'接种':[10],'免疫':[10],
  '治疗':[10],'用药':[10],'禁用药':[10],'孔雀石绿':[10],
  '氟苯尼考':[10],'土霉素':[10],'过氧化氢':[10],
  '休药期':[10],'生物安保':[10],'Biosecurity':[10],
  '隔离':[10],'检疫':[10],'消毒':[10],'无害化':[10],

  // 第十一章：饲料营养
  '饲料':[11],'营养':[11],'蛋白':[11],'脂肪':[11],'粗纤维':[11],
  '灰分':[11],'磷':[3,11],'赖氨酸':[11],'蛋氨酸':[11],
  'EPA':[11],'DHA':[11],'虾青素':[11],'维生素':[11],
  '粒径':[11],'颗粒':[11],'碎粒':[11],'粉尘':[11],
  '替代蛋白':[11],'黑水虻':[11],'微藻':[11],'单细胞蛋白':[11],
  '豆粕':[11],'发酵':[11],'磷虾':[11],'黄粉虫':[11],
  '饲料质量':[11],'储存':[11],'黄曲霉毒素':[11],

  // 第十二章：溶氧工程
  '增氧':[12],'曝气':[12],'纳米':[12],'纯氧锥':[12],'Speece':[12],
  '液氧':[12],'射流':[12],'叶轮':[12],'微孔':[12],
  '氧转移效率':[12],'能耗':[12],'供氧设计':[12],
  '耗氧量':[12],'AUR':[12],'LOX':[12],
  '溶氧监测':[12],'预警':[12],'DO探头':[12],

  // 第十三章：生长曲线
  '生长':[3,5,13],'SGR':[3,13],'日增重':[13],'生长曲线':[13],
  '入海':[13],'收获':[13],'出塘预测':[13],'收获预测':[13],
  '特定生长率':[13],'分批收获':[13],

  // 第十四章：经济
  '经济':[14],'成本':[14],'利润':[14],'盈亏':[14],
  '饲料成本':[14],'苗种成本':[14],'电力成本':[14],
  '折旧':[14],'敏感度':[14],'投资':[14],

  // 第十五章：标准法规
  '标准':[15],'GB':[9,15],'国标':[15],'NY':[10,15],'SC':[15],
  'AS':[15],'BAP':[15],'GlobalGAP':[15],'NS':[15],
  'OIE':[15],'ASC':[15],'专利':[15],'CN103766250':[9,15],

  // 第十六章：文献
  '文献':[16],'论文':[16],'SCI':[4,5,16],'博士论文':[3,16],
  'Frontiers':[16],'Aquaculture':[4,16],'Nofima':[4,16],
  'Timmons':[16],'Wedemeyer':[16],'Forsberg':[16],

  // 第十七章：FAQ
  'FAQ':[17],'常见问题':[17],'怎么办':[17],'应急':[12,17],
  '不吃食':[17],'拒食':[17],'停电':[17],'备用发电机':[17],

  // 第十八章：场设计
  '选址':[18],'场地':[18],'设计':[12,18],'布局':[18],
  'RAS系统':[12,18],'循环水':[18],'功能区':[18],
  '水处理':[18],'养殖池':[18],'生物滤池':[9,18],
  '实验室':[18],'饲料仓库':[18],'污泥':[18],
  '水源':[18],'供电':[18],'交通':[18],'排水':[18],
};

// ---- TF-IDF 检索 ----
function search(query, topK = 10) {
  const qLower = query.toLowerCase();
  const terms = qLower.split(/[\s,，。？?！!、；;：:（）()]+/).filter(t => t.length > 0);

  // 1. 关键词快速匹配
  let fastHits = new Map(); // chapterId -> accumulated bonus
  for (const [keyword, chapterIds] of Object.entries(KEYWORD_MAP)) {
    if (qLower.includes(keyword.toLowerCase())) {
      chapterIds.forEach(id => {
        fastHits.set(id, (fastHits.get(id) || 0) + 1);
      });
    }
  }

  // 2. TF-IDF 逐词匹配
  const scored = sections.map((section, idx) => {
    const chapterId = idx + 1;
    const lower = section.toLowerCase();
    let score = (fastHits.get(chapterId) || 0) * 30; // 关键词命中超大幅加分(优先于内容匹配)

    const title = section.split('\n')[0].toLowerCase();

    terms.forEach(term => {
      if (term.length <= 1) return;
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        const regex = new RegExp(escaped, 'gi');
        const matches = lower.match(regex);
        if (matches) score += matches.length * 2;
      } catch(e) { /* skip invalid regex */ }

      // 标题匹配加权
      if (title.includes(term)) score += 5;
      // 首个term在标题中 → 高权重
      if (terms[0] && title.includes(terms[0])) score += 8;
    });

    // 数值匹配
    if (/\d/.test(query) && /\d/.test(lower)) score += 2;
    // 含表格加权
    if (lower.includes('|')) score += 1;
    // FAQ加权(直接问答更实用)
    if (title.includes('FAQ') || title.includes('常见问题')) score += 1;

    return { idx, section, chapterId, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(s => ({
      title: s.section.split('\n')[0].replace(/^#+\s*/, '').replace(/^\d+\.\s*/, '').trim(),
      content: s.section.trim(),
      relevance: Math.min(Math.round(s.score / 2), 10),
      chapter: s.chapterId,
    }));
}

// ---- 检索结果转上下文文本 ----
function _buildContext(results) {
  return results.map((r, i) =>
    `[文档${i+1}] ${r.title || r.source || ''}\n${r.content.substring(0, 1500)}`
  ).join('\n\n---\n\n');
}

// ---- 混合检索 (向量+关键词) + Claude API 生成回答 ----
async function generateAnswer(query) {
  // 关键词检索
  const kwResults = search(query, 5);
  // 向量检索 (PDF)
  let vecResults = [];
  try {
    const vdb = require('./vector-db');
    const h = await vdb.hybridSearch(query, 5);
    vecResults = h.results.map(r => ({
      title: '📄 ' + r.source,
      content: r.content,
      relevance: Math.round(r.relevance * 5),
      chapter: 0,
    }));
  } catch(e) { /* 向量检索不可用 */ }

  // 合并去重
  const seen = new Set();
  const all = [];
  for (const r of [...vecResults, ...kwResults]) {
    const k = r.content.substring(0, 80);
    if (!seen.has(k)) { seen.add(k); all.push(r); }
  }
  const results = all.slice(0, 8);

  const sources = results.map(r => ({
    title: r.title,
    relevance: r.relevance,
    chapter: r.chapter,
  }));

  if (results.length === 0) {
    return {
      answer: '未找到相关知识。试试搜索: 投饲率 / FCR / 溶氧 / 水温 / 密度 / 疾病',
      sources: [],
    };
  }

  const context = _buildContext(results);

  // 尝试 Claude API
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    try {
      const answer = await _callClaude(query, context, apiKey);
      return { answer, sources };
    } catch (e) {
      console.error('Claude API 调用失败, 回退到本地回答:', e.message);
    }
  }

  // 回退到本地规则回答
  return { answer: _fallbackAnswer(query, results, sources), sources };
}

// ---- 调用 Claude API (RAG 检索模式 - 保留原有行为) ----
async function _callClaude(query, context, apiKey) {
  const Anthropic = require('@anthropic-ai/sdk');
  const anthropic = new Anthropic({ apiKey });

  const systemPrompt = `你是三文鱼(Salmon)养殖投喂管理专家。基于提供的知识库内容回答用户问题。

规则:
1. 只使用提供的知识库内容回答, 不要编造
2. 如果知识库中有具体数值(水温/溶氧/投饲率等), 务必引用
3. 如有标准/论文来源, 注明出处
4. 回答简洁专业, 分点列出关键信息
5. 如果知识库中信息不足, 诚实说明并给出建议方向
6. 用中文回答, 专业术语保留英文缩写`;

  const msg = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `知识库检索结果:\n\n${context}\n\n---\n用户问题: ${query}\n\n请基于以上知识库内容回答用户问题。`,
    }],
  });

  // 从 content 数组中取最后一个 text 类型的块
  const textBlock = [...msg.content].reverse().find(b => b.type === 'text');
  if (!textBlock || !textBlock.text) throw new Error('API返回格式异常');
  return textBlock.text;
}

// ================================================================
// 🌟 智能对话模式 — 多轮对话 + 专家顾问角色 + 联网搜索
// ================================================================

const CHAT_SYSTEM_PROMPT = `你是「鲑鱼博士」— 一位资深的三文鱼养殖技术顾问，拥有20年一线养殖和水产科研经验。

## 你的角色
- 你帮助养殖户解决三文鱼(大西洋鲑)和虹鳟养殖中的实际问题
- 你的知识涵盖: 投喂策略、水质管理、疾病防控、饲料营养、生长模型、养殖密度、溶氧管理、经济分析
- 你熟悉中国(DB63/NY/GB标准)和国际(FAO/Nofima/ASC)养殖标准

## 回答原则
1. **先理解再回答**: 仔细分析养殖户的问题，如果不确定具体品种或场景，先追问关键参数(水温/体重/养殖模式等)
2. **知识库优先**: 有确切数据时必须引用(水温/投饲率/FCR等)，在文中用 [来源:N] 标注引用
3. **可以推理**: 知识库不足时，可基于养殖学原理给出方向性建议，但必须标注"建议咨询本地技术员确认"
4. **实用导向**: 给出可操作的具体建议，而不是泛泛而谈。如"投喂量减少15%"而非"适当减少"
5. **风险意识**: 如果养殖户描述的情况存在严重风险(高温/缺氧/氨氮超标)，优先给出紧急处理方案
6. **对话自然**: 像一位经验丰富的老技术员在跟养殖户聊天，专业但不生硬

## 联网搜索模式
当用户问题涉及以下内容时，联网搜索的结果会附在参考资料中:
- 最新三文鱼市场价格、行情走势
- 近期水产行业新闻、政策变化
- 最新科研成果、新发布的标准
- 天气/气候对养殖的影响

## 格式要求
- 使用 Markdown 格式回复
- 关键数据用 **加粗** 突出
- 操作步骤用编号列表
- 如有多个方案，用表格对比
- **重要: 引用了知识库或搜索结果中的数据时，必须在文中标注 [来源:N]，让养殖户知道这个数据从哪来的**
- 结尾可以追问一句，引导养殖户提供更多信息

## 禁止
- 不要编造论文数据和专利号
- 不要推荐禁用渔药(孔雀石绿/硝基呋喃/氯霉素)
- 不要在不确定时给出绝对化的结论`;

// ---- 联网搜索 (轻量级，超时快，不阻塞对话) ----
async function searchWeb(query) {
  const results = [];

  // 单源搜索，短超时 (国内网络对 DuckDuckGo/Bing 较慢)
  try {
    const q = encodeURIComponent(query + ' 三文鱼养殖 salmon');
    const resp = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
      headers: { 'User-Agent': 'SalmonFeedingAI/1.0 (salmon-feeding@local)' },
      signal: AbortSignal.timeout(4000),
    });
    if (resp.ok) {
      const html = await resp.text();
      const snippetRe = /class="result__snippet"[^>]*>(.*?)<\/a>/gs;
      const titleRe = /class="result__title"[^>]*>.*?<a[^>]*>(.*?)<\/a>/gs;
      const linkRe = /class="result__url"[^>]*>(.*?)<\/a>/gs;
      const snippets = [...html.matchAll(snippetRe)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
      const titles = [...html.matchAll(titleRe)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
      const links = [...html.matchAll(linkRe)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
      for (let i = 0; i < Math.min(5, snippets.length); i++) {
        if (snippets[i] && snippets[i].length > 30) {
          results.push({
            title: titles[i] || '网络结果',
            content: snippets[i].substring(0, 500),
            relevance: 4 - i,
            chapter: 0,
            source: '🌐 网络搜索',
            link: links[i] || '',
          });
        }
      }
    }
  } catch(e) {
    console.log('联网搜索: DuckDuckGo 不可用 (' + e.message + ')');
  }

  // 备用：Bing (同样短超时)
  if (results.length === 0) {
    try {
      const q = encodeURIComponent(query + ' salmon aquaculture');
      const resp = await fetch(`https://www.bing.com/search?q=${q}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(4000),
      });
      if (resp.ok) {
        const html = await resp.text();
        const capRe = /<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>(.*?)<\/p>/gs;
        const capMatches = [...html.matchAll(capRe)];
        for (let i = 0; i < Math.min(3, capMatches.length); i++) {
          const text = capMatches[i][1].replace(/<[^>]+>/g, '').trim();
          if (text.length > 30 && results.length < 6) {
            results.push({
              title: '网络结果 ' + (i + 1),
              content: text.substring(0, 400),
              relevance: 3 - i,
              chapter: 0,
              source: '🌐 网络搜索',
              link: '',
            });
          }
        }
      }
    } catch(e) {
      console.log('联网搜索: Bing 也不可用 (' + e.message + ')');
    }
  }

  return results.slice(0, 8);
}

// ---- 智能对话 (多轮记忆 + 可选联网搜索) ----
async function chat(query, history = [], options = {}) {
  const { searchWeb: enableWebSearch = false } = options;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const result = await generateAnswer(query);
    return result;
  }

  // 1. 检索知识库
  const kwResults = search(query, 5);
  let vecResults = [];
  try {
    const vdb = require('./vector-db');
    const h = await vdb.hybridSearch(query, 5);
    vecResults = h.results.map(r => ({
      title: '📄 ' + r.source,
      content: r.content,
      relevance: Math.round(r.relevance * 5),
      chapter: 0,
      source: r.source,
    }));
  } catch(e) { /* 向量检索不可用 */ }

  // 2. 联网搜索 (如果启用)
  let webResults = [];
  if (enableWebSearch) {
    try {
      webResults = await searchWeb(query);
    } catch(e) { console.log('联网搜索失败:', e.message); }
  }

  // 3. 合并去重
  const seen = new Set();
  const all = [];
  for (const r of [...vecResults, ...kwResults, ...webResults]) {
    const k = r.content.substring(0, 80);
    if (!seen.has(k)) { seen.add(k); all.push(r); }
  }
  const results = all.slice(0, 10);

  // 4. 构建来源列表 (含原文片段，前端可展开查看)
  const sources = results.map((r, i) => ({
    id: i + 1,
    title: r.title,
    source: r.source || '知识库',
    relevance: r.relevance,
    chapter: r.chapter,
    snippet: r.content ? r.content.substring(0, 300) : '',
    link: r.link || '',
  }));

  // 5. 构建上下文
  const contextParts = [];
  if (results.length > 0) {
    contextParts.push(results.map((r, i) =>
      `[来源:${i + 1}] ${r.title}\n内容: ${r.content ? r.content.substring(0, 1000) : ''}`
    ).join('\n\n---\n\n'));
  }
  if (enableWebSearch && webResults.length === 0) {
    contextParts.push('（联网搜索未获取到结果，请基于养殖学常识回答）');
  }
  const context = contextParts.join('\n\n') || '（暂无匹配的知识库内容，请基于养殖学常识回答）';

  // 6. 构建 messages
  const messages = [];
  for (const turn of history.slice(-10)) {
    if (turn.role === 'user') {
      messages.push({ role: 'user', content: turn.content });
    } else if (turn.role === 'assistant') {
      messages.push({ role: 'assistant', content: turn.content });
    }
  }

  const searchModeNote = enableWebSearch
    ? '\n（联网搜索已启用，以上参考资料包含实时网络搜索结果，请在回答中引用时标注来源编号）'
    : '';

  messages.push({
    role: 'user',
    content: `【参考资料 — 请在回答中用 [来源:N] 标注引用】\n${context}\n${searchModeNote}\n---\n【养殖户的问题】\n${query}`,
  });

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey });

    const msg = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
      max_tokens: 2500,
      system: CHAT_SYSTEM_PROMPT,
      messages,
    });

    const textBlock = [...msg.content].reverse().find(b => b.type === 'text');
    if (!textBlock || !textBlock.text) throw new Error('API返回格式异常');

    return { answer: textBlock.text, sources, webSearchUsed: enableWebSearch };
  } catch (e) {
    console.error('Claude Chat API 调用失败:', e.message);
    return await generateAnswer(query);
  }
}

// ---- 本地回退回答 (Claude不可用时) ----
function _fallbackAnswer(query, results, sources) {
  const qLower = query.toLowerCase();
  let answer = '';
  const allContent = results.map(r => r.content).join('\n');

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

module.exports = { search, generateAnswer, chat };
