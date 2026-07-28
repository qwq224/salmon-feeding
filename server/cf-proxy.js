// ================================================================
// cf-proxy.js — Cloudflare Worker: Anthropic API 代理
// 部署: npx wrangler deploy (免费, 全球 CDN, 国内 ECS 可访问)
// ================================================================

export default {
  async fetch(request, env, ctx) {
    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'x-api-key, anthropic-version, content-type, authorization',
        },
      });
    }

    const url = new URL(request.url);

    // 健康检查
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'Anthropic API Proxy' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // 代理 /v1/* 到 Anthropic
    const targetUrl = 'https://api.anthropic.com' + url.pathname + url.search;

    // 转发请求头
    const proxyHeaders = new Headers();
    const forwardHeaders = ['x-api-key', 'anthropic-version', 'content-type', 'anthropic-beta'];
    for (const h of forwardHeaders) {
      const val = request.headers.get(h);
      if (val) proxyHeaders.set(h, val);
    }
    // 确保必要头部
    if (!proxyHeaders.get('anthropic-version')) {
      proxyHeaders.set('anthropic-version', '2023-06-01');
    }

    try {
      const body = request.method !== 'GET' && request.method !== 'HEAD'
        ? await request.text()
        : undefined;

      const response = await fetch(targetUrl, {
        method: request.method,
        headers: proxyHeaders,
        body,
      });

      // 流式转发响应
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      // 暴露必要的响应头
      responseHeaders.set('Access-Control-Expose-Headers', 'x-request-id, anthropic-ratelimit-requests-limit, anthropic-ratelimit-requests-remaining, anthropic-ratelimit-tokens-limit, anthropic-ratelimit-tokens-remaining');

      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders,
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Proxy error: ' + e.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  },
};
