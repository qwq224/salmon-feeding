// ================================================================
// rag.js v5 — RAG 检索增强生成模块
// 使用新的 vector-store 混合检索 (BM25 + 向量 + RRF)
// Claude API 智能回答 + 本地回退
// ================================================================

const fs = require('fs');
const path = require('path');
const vstore = require('./vector-store');

// 代理配置: ECS 国内访问不了 Anthropic API，通过 Render 中转
const ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';

// DeepSeek 配置 (国内直连，OpenAI 兼容格式)
const LLM_PROVIDER = process.env.LLM_PROVIDER || 'deepseek'; // 'anthropic' | 'deepseek'
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';

// ============ 搜索接口 (统一) ============

/**
 * 混合检索: BM25 + 向量
 * @param {string} query
 * @param {number} topK
 */
async function search(query, topK = 10) {
  return await vstore.search(query, topK);
}

// ============ 上下文构建 ============

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

// ============ Claude API 调用 ============

async function _callClaude(query, context, apiKey) {
  const Anthropic = require('@anthropic-ai/sdk');
  const anthropic = new Anthropic({ apiKey, baseURL: ANTHROPIC_BASE_URL });

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

  const textBlock = [...msg.content].reverse().find(b => b.type === 'text');
  if (!textBlock || !textBlock.text) throw new Error('API返回格式异常');
  return textBlock.text;
}

// ============ DeepSeek API 调用 (OpenAI 兼容格式) ============

async function _callDeepSeekChat(messages, systemPrompt, maxTokens, apiKey) {
  const apiMessages = [];
  if (systemPrompt) {
    apiMessages.push({ role: 'system', content: systemPrompt });
  }
  for (const m of messages) {
    apiMessages.push({ role: m.role, content: m.content });
  }

  const resp = await fetch(`${DEEPSEEK_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey || DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: apiMessages,
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(`${resp.status} ${errBody.substring(0, 300)}`);
  }
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '';
  if (!content) throw new Error('DeepSeek 返回空内容');
  return content;
}

// ============ RAG 回答 ============

/**
 * 单轮 RAG 问答 (传统模式，保留向后兼容)
 */
async function generateAnswer(query) {
  const results = await search(query, 8);

  const sources = _buildSources(results);

  if (results.length === 0) {
    return {
      answer: '未找到相关知识。试试搜索: 投饲率 / FCR / 溶氧 / 水温 / 密度 / 疾病',
      sources: [],
    };
  }

  const context = _buildContext(results);

  // DeepSeek 优先 (国内可直连)
  if (LLM_PROVIDER === 'deepseek' && DEEPSEEK_API_KEY) {
    try {
      const answer = await _callDeepSeekChat(
        [{ role: 'user', content: `知识库检索结果:\n\n${context}\n\n---\n用户问题: ${query}\n\n请基于以上知识库内容回答用户问题。` }],
        '你是三文鱼(Salmon)养殖投喂管理专家。基于提供的知识库内容回答用户问题。规则: 1. 只使用提供的知识库内容回答, 不要编造 2. 如果知识库中有具体数值(水温/溶氧/投饲率等), 务必引用 3. 如有标准/论文来源, 注明出处 4. 回答简洁专业, 分点列出关键信息 5. 如果知识库中信息不足, 诚实说明并给出建议方向 6. 用中文回答, 专业术语保留英文缩写',
        1500,
        DEEPSEEK_API_KEY
      );
      return { answer, sources };
    } catch (e) {
      console.error('DeepSeek API 调用失败, 回退到本地回答:', e.message);
    }
  }

  // Anthropic (备用)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (LLM_PROVIDER === 'anthropic' && apiKey) {
    try {
      const answer = await _callClaude(query, context, apiKey);
      return { answer, sources };
    } catch (e) {
      console.error('Claude API 调用失败, 回退到本地回答:', e.message);
    }
  }

  return { answer: _fallbackAnswer(query, results, sources), sources };
}

// ============ 智能对话 ============

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

// ---- 联网搜索 ----
async function searchWeb(query) {
  const results = [];

  try {
    const q = encodeURIComponent(query + ' 三文鱼养殖 salmon');
    const resp = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
      headers: { 'User-Agent': 'SalmonFeedingAI/1.0' },
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
            text: snippets[i].substring(0, 500),
            score: (5 - i) / 5,
            docTitle: titles[i] || '网络结果',
            docType: 'web',
            docUrl: links[i] || '',
            sourceName: '🌐 网络搜索',
            sectionTitle: '',
            tags: ['网络搜索'],
          });
        }
      }
    }
  } catch(e) {
    console.log('联网搜索: DuckDuckGo 不可用 (' + e.message + ')');
  }

  // 备用 Bing
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
              text: text.substring(0, 400),
              score: (3 - i) / 5,
              docTitle: '网络结果 ' + (i + 1),
              docType: 'web',
              docUrl: '',
              sourceName: '🌐 网络搜索',
              sectionTitle: '',
              tags: ['网络搜索'],
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

  // 1. 混合检索知识库
  let localResults = [];
  try {
    localResults = await vstore.search(query, 8);
  } catch(e) {
    console.warn('向量检索失败:', e.message);
  }

  // 2. 联网搜索
  let webResults = [];
  if (enableWebSearch) {
    try {
      webResults = await searchWeb(query);
    } catch(e) { console.log('联网搜索失败:', e.message); }
  }

  // 3. 合并结果
  const allResults = [...localResults, ...webResults];

  // 4. 构建来源
  const sources = _buildSources(allResults);

  // 5. 构建上下文
  const context = allResults.length > 0
    ? allResults.map((r, i) =>
        `[来源:${i + 1} | ${r.docTitle || r.title || ''} | ${r.sectionTitle || ''} | 类型:${r.docType || 'unknown'}${r.sourceName ? ' | ' + r.sourceName : ''}]\n${(r.text || '').substring(0, 1000)}`
      ).join('\n\n---\n\n')
    : '';

  const searchModeNote = enableWebSearch
    ? '\n（联网搜索已启用，以上参考资料包含实时网络搜索结果）'
    : '';

  // 6. 无 API Key 时回退
  if (LLM_PROVIDER === 'deepseek' && !DEEPSEEK_API_KEY) {
    const result = await generateAnswer(query);
    return result;
  }

  // 7. 构建 messages
  const messages = [];
  for (const turn of history.slice(-10)) {
    if (turn.role === 'user') {
      messages.push({ role: 'user', content: turn.content });
    } else if (turn.role === 'assistant') {
      messages.push({ role: 'assistant', content: turn.content });
    }
  }

  messages.push({
    role: 'user',
    content: `【参考资料 — 请在回答中用 [来源:N] 标注引用】\n${context || '（暂无匹配的知识库内容，请基于养殖学常识回答）'}\n${searchModeNote}\n---\n【养殖户的问题】\n${query}`,
  });

  // DeepSeek (国内直连)
  if (LLM_PROVIDER === 'deepseek' && DEEPSEEK_API_KEY) {
    try {
      const answer = await _callDeepSeekChat(messages, CHAT_SYSTEM_PROMPT, 2500, DEEPSEEK_API_KEY);
      return { answer, sources, webSearchUsed: enableWebSearch };
    } catch (e) {
      console.error('DeepSeek Chat API 调用失败:', e.message);
      return await generateAnswer(query);
    }
  }

  // Anthropic (备用)
  if (LLM_PROVIDER === 'anthropic') {
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const anthropic = new Anthropic({ apiKey, baseURL: ANTHROPIC_BASE_URL });

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

  // Fallback
  return await generateAnswer(query);
}

// ============ 本地回退回答 ============

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

module.exports = { search, generateAnswer, chat };
