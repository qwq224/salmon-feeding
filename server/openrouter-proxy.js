// ================================================================
// openrouter-proxy.js — Anthropic SDK → OpenRouter 格式转换代理
// 部署在 ECS 本地 (ECS 可访问 openrouter.ai)
// 启动: node server/openrouter-proxy.js
// ================================================================

const http = require('http');

const PORT = 8787;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';

// Anthropic 模型名 → OpenRouter 模型名
function mapModel(anthropicModel) {
  const modelMap = {
    'claude-sonnet-5': 'anthropic/claude-sonnet-5',
    'claude-sonnet-5-20251001': 'anthropic/claude-sonnet-5',
    'claude-opus-5': 'anthropic/claude-opus-5',
    'claude-fable-5': 'anthropic/claude-fable-5',
    'claude-haiku-4-5-20251001': 'anthropic/claude-haiku-4.5',
    'claude-sonnet-4': 'anthropic/claude-sonnet-4',
    'claude-sonnet-4-20250514': 'anthropic/claude-sonnet-4',
  };
  return modelMap[anthropicModel] || `anthropic/${anthropicModel}`;
}

// Anthropic 请求 → OpenRouter 请求
function convertRequest(anthropicBody) {
  const messages = [];

  // Anthropic 的 system prompt → messages[0] as system role
  if (anthropicBody.system) {
    messages.push({ role: 'system', content: anthropicBody.system });
  }

  // 转换消息
  for (const msg of (anthropicBody.messages || [])) {
    messages.push({ role: msg.role, content: msg.content });
  }

  return {
    model: mapModel(anthropicBody.model || 'claude-sonnet-5'),
    messages,
    max_tokens: anthropicBody.max_tokens || 1500,
    temperature: anthropicBody.temperature,
    // OpenRouter 会透传大部分参数
  };
}

// OpenRouter 响应 → Anthropic 响应
function convertResponse(orBody) {
  if (orBody.error) {
    return { error: orBody.error };
  }

  const choice = (orBody.choices || [])[0] || {};
  const msg = choice.message || {};

  return {
    id: orBody.id || 'msg_' + Date.now(),
    type: 'message',
    role: 'assistant',
    content: [
      { type: 'text', text: msg.content || '' }
    ],
    model: orBody.model || '',
    stop_reason: choice.finish_reason || 'end_turn',
    usage: {
      input_tokens: orBody.usage?.prompt_tokens || 0,
      output_tokens: orBody.usage?.completion_tokens || 0,
    },
  };
}

// ============ 服务器 ============
const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'x-api-key, anthropic-version, content-type, authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 健康检查
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', proxy: 'Anthropic→OpenRouter', target: OPENROUTER_URL }));
    return;
  }

  if (!req.url.startsWith('/v1/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  // 读取请求体
  const body = await new Promise((resolve) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => resolve(data || '{}'));
  });

  let anthropicBody;
  try {
    anthropicBody = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  // 只处理 /v1/messages
  if (req.url === '/v1/messages') {
    if (!OPENROUTER_KEY) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'OPENROUTER_API_KEY not configured' }));
      return;
    }

    const openRouterBody = convertRequest(anthropicBody);

    console.log(`🔄 [${new Date().toLocaleTimeString()}] ${anthropicBody.model} → ${openRouterBody.model} (${openRouterBody.messages.length} msgs)`);

    try {
      const orResp = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENROUTER_KEY}`,
          'HTTP-Referer': 'https://qwq231023.xyz',
          'X-Title': 'SalmonFeeding AI',
        },
        body: JSON.stringify(openRouterBody),
        signal: AbortSignal.timeout(60000),
      });

      const orData = await orResp.json();

      if (!orResp.ok) {
        console.error(`❌ OpenRouter 错误 (${orResp.status}):`, JSON.stringify(orData).substring(0, 300));
        res.writeHead(orResp.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { type: 'api_error', message: orData.error?.message || `OpenRouter ${orResp.status}` } }));
        return;
      }

      const anthropicResponse = convertResponse(orData);
      const textOut = anthropicResponse.content?.[0]?.text?.length || 0;
      console.log(`✅ 响应: ${textOut} 字符, ${anthropicResponse.usage?.input_tokens}/${anthropicResponse.usage?.output_tokens} tokens`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(anthropicResponse));
    } catch (e) {
      console.error('❌ 代理错误:', e.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { type: 'proxy_error', message: e.message } }));
    }
  } else {
    // 其他 /v1/* 端点暂不支持
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Only /v1/messages is supported' }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🔁 OpenRouter 转换代理已启动: http://127.0.0.1:${PORT}`);
  console.log(`🎯 目标: ${OPENROUTER_URL}`);
  console.log(`🔑 OpenRouter Key: ${OPENROUTER_KEY ? '✅ 已配置 (' + OPENROUTER_KEY.substring(0, 8) + '...)' : '❌ 未配置!'}`);
});
