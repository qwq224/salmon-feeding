// ================================================================
// doc-pipeline.js — 文档摄入管道
//
// 支持:
// - URL 抓取 (cheerio HTML 解析)
// - PDF 导入 (pdf-parse)
// - 纯文本导入
// - 智能分块 (按段落/章节边界)
// ================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PDF_DIR = path.join(DATA_DIR, 'pdfs');

[PDF_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 50;

// ============ 智能分块 ============

/**
 * 按段落/句子边界智能分块
 * - 优先在段落边界切分
 * - 不在句子中间切断
 * - 保留标题层级作为 sectionTitle
 */
function smartChunk(text, sectionTitle = '') {
  const chunks = [];
  // 先按双换行(段落)分割
  const paragraphs = text.split(/\n{2,}/).filter(p => p.trim());

  let currentText = '';
  let currentLen = 0;

  for (const para of paragraphs) {
    const clean = para.replace(/\s+/g, ' ').trim();
    if (!clean) continue;

    // 如果当前块加上这个段落会超过限制
    if (currentLen + clean.length > CHUNK_SIZE && currentLen > 150) {
      chunks.push({
        text: currentText.trim(),
        charCount: currentLen,
        sectionTitle,
      });
      currentText = clean;
      currentLen = clean.length;
    } else {
      currentText += (currentText ? '\n\n' : '') + clean;
      currentLen += clean.length + (currentText ? 2 : 0);
    }
  }

  // 最后一个块
  if (currentText.trim()) {
    chunks.push({
      text: currentText.trim(),
      charCount: currentLen,
      sectionTitle,
    });
  }

  return chunks;
}

/**
 * Markdown 分块: 按 ## 标题分割，每个 section 内再用 smartChunk
 */
function chunkMarkdown(text) {
  const allChunks = [];
  // 移除 YAML frontmatter (如果有)
  const clean = text.replace(/^---[\s\S]*?---\n*/, '');

  // 按 H2 分割
  const sections = clean.split(/\n(?=## )/);

  for (const section of sections) {
    const lines = section.split('\n');
    const heading = lines[0].replace(/^#+\s*/, '').trim();
    const body = lines.slice(1).join('\n').trim();

    if (!body || body.length < 30) continue;

    const chunks = smartChunk(body, heading);
    allChunks.push(...chunks);
  }

  return allChunks;
}

/**
 * PDF 文本分块: 先按页，页内再按段落
 */
function chunkPDF(text) {
  // PDF 文本可能包含换页符
  const pages = text.split(/\f/);
  const allChunks = [];

  for (let i = 0; i < pages.length; i++) {
    const pageText = pages[i].trim();
    if (!pageText || pageText.length < 50) continue;

    const chunks = smartChunk(pageText, `第${i + 1}页`);
    for (const c of chunks) {
      c.pageNum = i + 1;
    }
    allChunks.push(...chunks);
  }

  return allChunks;
}

/**
 * HTML 文本分块: 提取正文后用 smartChunk
 */
function chunkHTML(text) {
  // 移除多余空白
  const clean = text.replace(/\s{3,}/g, '\n').trim();
  return smartChunk(clean);
}

// ============ HTML 正文提取 ============

/**
 * 从 HTML 中提取正文内容
 */
function extractHTMLContent(html, url) {
  let cheerio;
  try { cheerio = require('cheerio'); } catch { return null; }

  const $ = cheerio.load(html);

  // 移除无关元素
  $('script, style, nav, footer, header, aside, .sidebar, .nav, .menu, .ad, .advertisement, .cookie, .popup, iframe, noscript').remove();

  // 尝试找正文区域
  const contentSelectors = [
    'article', 'main', '[role="main"]', '.content', '.post-content',
    '.article-content', '.entry-content', '#content', '.main-content',
    '.post-body', '.article-body',
  ];

  let bodyText = '';
  for (const sel of contentSelectors) {
    const el = $(sel);
    if (el.length && el.text().trim().length > 100) {
      bodyText = el.text();
      break;
    }
  }

  // 如果没找到，用 body
  if (!bodyText) {
    bodyText = $('body').text();
  }

  // 清理文本
  bodyText = bodyText
    .replace(/[\t\r]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ {2,}/g, ' ')
    .trim();

  // 提取标题
  let title = $('title').text().trim() ||
              $('h1').first().text().trim() ||
              '';

  // 提取元数据
  const metaDesc = $('meta[name="description"]').attr('content') || '';
  const metaAuthor = $('meta[name="author"]').attr('content') || '';
  const metaDate = $('meta[property="article:published_time"]').attr('content') || '';

  return {
    title: title.substring(0, 200),
    text: bodyText.substring(0, 50000), // 最多 50000 字符
    description: metaDesc.substring(0, 500),
    author: metaAuthor,
    publishDate: metaDate ? metaDate.substring(0, 10) : '',
    url,
  };
}

// ============ 摄入管道 ============

/**
 * 从 URL 摄入
 */
async function ingestURL(url, options = {}) {
  console.log(`🌐 抓取 URL: ${url}`);

  let html;
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'SalmonFeedingAI/2.0 (Knowledge Pipeline)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    html = await resp.text();
  } catch (e) {
    throw new Error(`抓取失败: ${e.message}`);
  }

  const extracted = extractHTMLContent(html, url);
  if (!extracted || extracted.text.length < 100) {
    throw new Error('无法提取足够的内容');
  }

  const chunks = chunkHTML(extracted.text);

  return {
    title: options.title || extracted.title || new URL(url).hostname,
    text: extracted.text,
    chunks,
    metadata: {
      sourceType: 'web_article',
      sourceName: new URL(url).hostname,
      sourceUrl: url,
      author: extracted.author || options.author || '',
      publishDate: extracted.publishDate || options.publishDate || new Date().toISOString().split('T')[0],
      language: options.language || 'mixed',
      tags: options.tags || [],
    },
  };
}

/**
 * 从 PDF 摄入
 */
async function ingestPDF(filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`PDF 文件不存在: ${filePath}`);
  }

  console.log(`📄 解析 PDF: ${filePath}`);
  const pdfParse = require('pdf-parse');
  const buf = fs.readFileSync(filePath);
  const data = await pdfParse(buf);

  if (!data.text || data.text.trim().length < 50) {
    throw new Error('PDF 内容为空或无法提取文本');
  }

  const chunks = chunkPDF(data.text);
  const fname = path.basename(filePath, '.pdf');

  // 尝试从 PDF 元数据提取
  const pdfInfo = data.info || {};

  return {
    title: options.title || data.info?.Title || fname,
    text: data.text,
    chunks,
    metadata: {
      sourceType: 'paper',
      sourceName: pdfInfo.Author ? `${pdfInfo.Author} - ${fname}` : fname,
      sourceUrl: options.sourceUrl || '',
      author: pdfInfo.Author || options.author || '',
      publishDate: pdfInfo.CreationDate
        ? new Date(pdfInfo.CreationDate).toISOString().split('T')[0]
        : (options.publishDate || ''),
      language: options.language || 'mixed',
      tags: options.tags || [],
    },
  };
}

/**
 * 从纯文本摄入
 */
async function ingestText(text, options = {}) {
  if (!text || text.trim().length < 50) {
    throw new Error('文本内容过短');
  }

  const chunks = smartChunk(text, options.sectionTitle || '');

  return {
    title: options.title || '手动导入文本',
    text,
    chunks,
    metadata: {
      sourceType: options.sourceType || 'manual',
      sourceName: options.sourceName || '手动导入',
      sourceUrl: options.sourceUrl || '',
      author: options.author || '',
      publishDate: options.publishDate || new Date().toISOString().split('T')[0],
      language: options.language || 'zh',
      tags: options.tags || [],
    },
  };
}

// ============ 预配置水产数据源 ============

const AQUACULTURE_SOURCES = [
  {
    name: 'FAO Fisheries & Aquaculture',
    url: 'https://www.fao.org/fishery/en/aquaculture',
    type: 'web',
    language: 'en',
    tags: ['FAO', '国际组织', '水产养殖'],
  },
  {
    name: 'NOAA Fisheries Aquaculture',
    url: 'https://www.fisheries.noaa.gov/topic/aquaculture',
    type: 'web',
    language: 'en',
    tags: ['NOAA', '美国', '渔业'],
  },
  {
    name: 'Global Seafood Alliance',
    url: 'https://www.globalseafood.org/',
    type: 'rss',
    language: 'en',
    tags: ['行业资讯', '标准', '认证'],
  },
  {
    name: 'The Fish Site',
    url: 'https://thefishsite.com/',
    type: 'rss',
    language: 'en',
    tags: ['行业新闻', '养殖技术'],
  },
  {
    name: '中国水产频道',
    url: 'https://www.fishfirst.cn/',
    type: 'rss',
    language: 'zh',
    tags: ['国内资讯', '行业新闻'],
  },
];

/**
 * 获取预配置数据源列表
 */
function getSources() {
  return AQUACULTURE_SOURCES;
}

module.exports = {
  ingestURL,
  ingestPDF,
  ingestText,
  chunkMarkdown,
  chunkPDF,
  chunkHTML,
  smartChunk,
  extractHTMLContent,
  getSources,
  AQUACULTURE_SOURCES,
};
