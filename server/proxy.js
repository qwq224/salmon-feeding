// ================================================================
// proxy.js — 独立 Anthropic API 代理 (云端部署，国内 ECS 通过此代理访问)
// 部署到: Cloudflare Workers / Vercel / Deno Deploy 等
// ================================================================

// 用法: node server/proxy.js (本地测试)
// 生产: 部署到 Cloudflare Workers (全球 CDN，国内可访问)

const http = require('http');

const PORT = process.env.PORT || 8765;
const ANTHROPIC_BASE = 'https://api.anthropic.com';

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'x-api-key, anthropic-version, content-type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Only proxy /v1/* paths
  if (!req.url.startsWith('/v1/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'Anthropic API Proxy' }));
    return;
  }

  const targetUrl = ANTHROPIC_BASE + req.url;
  const body = await readBody(req);

  console.log(`🔄 ${req.method} ${req.url} → ${targetUrl}`);

  try {
    const resp = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'x-api-key': req.headers['x-api-key'] || '',
        'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: body || undefined,
    });

    res.writeHead(resp.status, { 'Content-Type': 'application/json' });
    const text = await resp.text();
    res.end(text);
  } catch (e) {
    console.error('代理失败:', e.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
});

function readBody(req) {
  return new Promise((resolve) => {
    if (req.method === 'GET') { resolve(null); return; }
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => resolve(data || null));
  });
}

server.listen(PORT, () => {
  console.log(`🔁 Anthropic API 代理已启动: http://localhost:${PORT}`);
});
