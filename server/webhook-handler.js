// ================================================================
// webhook-handler.js — 企业微信 + 飞书 智能问答机器人
// 支持: URL验证、消息加解密、多轮对话、富文本回复
// ================================================================

const crypto = require('crypto');
const { chat } = require('./rag');

// ============ 对话记忆 (按用户ID存储，最多保留20轮) ============
const sessionStore = new Map(); // userId -> { history: [], lastActive: timestamp }

const SESSION_TTL = 30 * 60 * 1000; // 30分钟过期

function getSession(userId) {
  const now = Date.now();
  // 清理过期会话
  for (const [key, val] of sessionStore) {
    if (now - val.lastActive > SESSION_TTL) sessionStore.delete(key);
  }
  if (!sessionStore.has(userId)) {
    sessionStore.set(userId, { history: [], lastActive: now });
  }
  const s = sessionStore.get(userId);
  s.lastActive = now;
  return s;
}

// ================================================================
// 企业微信 (WeCom) 机器人
// ================================================================

// 解密企业微信消息 (AES-256-CBC)
function wecomDecrypt(encryptText, encodingAESKey) {
  try {
    const key = Buffer.from(encodingAESKey + '=', 'base64');
    const iv = key.subarray(0, 16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    decipher.setAutoPadding(false);
    let decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptText, 'base64')),
      decipher.final(),
    ]);
    // 去除 PKCS7 padding
    const pad = decrypted[decrypted.length - 1];
    decrypted = decrypted.subarray(0, decrypted.length - pad);
    // 去除16字节随机字符串
    const content = decrypted.subarray(16).toString('utf-8');
    // 去除尾部 (corpId)
    const len = content.lastIndexOf('</xml>');
    return content.substring(0, len + 6);
  } catch (e) {
    console.error('WeCom 解密失败:', e.message);
    return null;
  }
}

// 加密回复消息
function wecomEncrypt(text, encodingAESKey, corpId) {
  try {
    const key = Buffer.from(encodingAESKey + '=', 'base64');
    const iv = key.subarray(0, 16);
    // 组装: 16字节随机 + 4字节msg_len + msg + corpId
    const random = crypto.randomBytes(16);
    const msgBuf = Buffer.from(text, 'utf-8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(msgBuf.length, 0);
    const corpBuf = Buffer.from(corpId, 'utf-8');
    const raw = Buffer.concat([random, lenBuf, msgBuf, corpBuf]);
    // PKCS7 padding
    const blockSize = 32;
    const padLen = blockSize - (raw.length % blockSize);
    const padded = Buffer.concat([raw, Buffer.alloc(padLen, padLen)]);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
    return encrypted.toString('base64');
  } catch (e) {
    console.error('WeCom 加密失败:', e.message);
    return null;
  }
}

// 生成签名
function wecomSign(token, timestamp, nonce, encrypt) {
  const arr = [token, timestamp, nonce, encrypt].sort();
  return crypto.createHash('sha1').update(arr.join('')).digest('hex');
}

// 解析企业微信 XML 消息
function parseWecomXML(xml) {
  const getVal = (tag) => {
    const m = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]></${tag}>`));
    if (m) return m[1];
    const m2 = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`));
    return m2 ? m2[1] : '';
  };
  return {
    toUserName: getVal('ToUserName'),
    fromUserName: getVal('FromUserName'),
    createTime: getVal('CreateTime'),
    msgType: getVal('MsgType'),
    content: getVal('Content'),
    msgId: getVal('MsgId'),
    agentID: getVal('AgentID'),
  };
}

// 构建企业微信 XML 回复
function buildWecomReply(toUser, fromUser, content) {
  return `<xml>
<ToUserName><![CDATA[${toUser}]]></ToUserName>
<FromUserName><![CDATA[${fromUser}]]></FromUserName>
<CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[${content}]]></Content>
</xml>`;
}

// 裁剪 AI 回答为适合聊天工具的长度
function truncateForIM(text, maxLen = 2000) {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 30) + '\n\n...（回答较长，已截断）';
}

/**
 * 处理企业微信回调 (GET 用于验证URL, POST 用于接收消息)
 * @param {object} query - URL query params
 * @param {object} body - 请求体 (XML string for encrypted, or parsed JSON)
 * @param {object} config - { token, encodingAESKey, corpId } (可选，加密模式需要)
 */
async function handleWecom(query, body, config = {}) {
  const { token, encodingAESKey, corpId } = config;

  // ---- GET: URL 验证 ----
  if (query.echostr) {
    if (encodingAESKey) {
      // 加密模式: 解密 echostr
      const sig = wecomSign(token, query.timestamp, query.nonce, query.echostr);
      if (sig !== query.msg_signature) {
        return { status: 403, body: '签名验证失败' };
      }
      const decrypted = wecomDecrypt(query.echostr, encodingAESKey);
      return { status: 200, body: decrypted, contentType: 'text/plain' };
    } else {
      // 明文模式: 直接返回 echostr
      return { status: 200, body: query.echostr, contentType: 'text/plain' };
    }
  }

  // ---- POST: 接收消息 ----
  let msgContent = '';
  let fromUser = '';
  let toUser = '';

  // 判断是加密 XML 还是明文 JSON
  if (typeof body === 'string' && body.includes('<xml>')) {
    // XML 格式
    if (body.includes('<Encrypt>') && encodingAESKey) {
      // 加密模式
      const encMatch = body.match(/<Encrypt><!\[CDATA\[(.*?)\]\]><\/Encrypt>/);
      if (!encMatch) return { status: 400, body: '无法解析加密消息' };

      // 验证签名
      const sig = wecomSign(token, query.timestamp, query.nonce, encMatch[1]);
      if (query.msg_signature && sig !== query.msg_signature) {
        return { status: 403, body: '签名验证失败' };
      }

      const decrypted = wecomDecrypt(encMatch[1], encodingAESKey);
      if (!decrypted) return { status: 400, body: '解密失败' };
      const msg = parseWecomXML(decrypted);
      msgContent = msg.content;
      fromUser = msg.fromUserName;
      toUser = msg.toUserName;
    } else {
      // 明文 XML
      const msg = parseWecomXML(body);
      msgContent = msg.content;
      fromUser = msg.fromUserName;
      toUser = msg.toUserName;
    }
  } else if (typeof body === 'object') {
    // JSON 格式 (简化模式，用于本地测试)
    msgContent = body.msg || body.content || body.text || '';
    fromUser = body.fromUser || body.userId || 'test_user';
    toUser = body.toUser || 'bot';
  }

  if (!msgContent) {
    const reply = buildWecomReply(toUser, fromUser, '请发送查询内容，如: 水温15度体重200g的投喂量？');
    return { status: 200, body: reply, contentType: 'application/xml' };
  }

  console.log(`💬 企微消息: ${fromUser} — "${msgContent.substring(0, 50)}"`);

  // 获取用户会话 → 调用智能对话
  const session = getSession('wecom:' + fromUser);
  let result;
  try {
    result = await chat(msgContent, session.history);
    session.history.push(
      { role: 'user', content: msgContent },
      { role: 'assistant', content: result.answer }
    );
    if (session.history.length > 20) session.history = session.history.slice(-20);
  } catch (e) {
    result = { answer: '抱歉，处理出错了，请稍后重试。', sources: [] };
  }

  // 构造回复文本
  let replyText = truncateForIM(result.answer.replace(/\*\*/g, '').replace(/#{1,4}\s/g, '■ '));
  // 添加来源
  if (result.sources && result.sources.length > 0) {
    const srcNames = result.sources.slice(0, 3).map(s => s.title).join('、');
    replyText += '\n\n📚 参考: ' + srcNames;
  }

  // 加密回复 (如果需要)
  if (encodingAESKey && fromUser) {
    const xmlReply = buildWecomReply(toUser, fromUser, replyText);
    const encrypted = wecomEncrypt(xmlReply, encodingAESKey, corpId);
    if (encrypted) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const nonce = crypto.randomBytes(8).toString('hex');
      const sig = wecomSign(token, timestamp, nonce, encrypted);
      const encReply = `<xml>
<Encrypt><![CDATA[${encrypted}]]></Encrypt>
<MsgSignature><![CDATA[${sig}]]></MsgSignature>
<TimeStamp>${timestamp}</TimeStamp>
<Nonce><![CDATA[${nonce}]]></Nonce>
</xml>`;
      return { status: 200, body: encReply, contentType: 'application/xml' };
    }
  }

  // 明文回复 (纯文本方便测试)
  if (typeof body === 'object') {
    return { status: 200, body: { reply: replyText, sources: result.sources } };
  }
  const xmlReply = buildWecomReply(toUser, fromUser, replyText);
  return { status: 200, body: xmlReply, contentType: 'application/xml' };
}

// ================================================================
// 飞书 (Feishu/Lark) 机器人
// ================================================================

/**
 * 处理飞书事件回调
 * @param {object} body - 飞书事件 JSON
 * @param {object} headers - 请求头 (用于验证签名)
 * @param {object} config - { appId, appSecret, verificationToken, encryptKey }
 */
async function handleFeishu(body, headers = {}, config = {}) {
  // ---- 调试日志 ----
  console.log('🐦 飞书回调:', JSON.stringify(body).substring(0, 300));
  console.log('🐦 Headers:', JSON.stringify(headers).substring(0, 200));
  // ---- URL 验证 (Challenge) ----
  if (body.type === 'url_verification') {
    console.log('✅ 飞书 URL 验证成功');
    return { status: 200, body: { challenge: body.challenge } };
  }

  // ---- 事件处理 ----
  // 飞书事件可能被加密，检查 encrypt 字段
  let eventData = body;
  if (body.encrypt && config.encryptKey) {
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-cbc',
        crypto.createHash('sha256').update(config.encryptKey).digest(),
        Buffer.alloc(16, 0)
      );
      let decrypted = decipher.update(body.encrypt, 'base64', 'utf-8');
      decrypted += decipher.final('utf-8');
      eventData = JSON.parse(decrypted);
    } catch (e) {
      console.error('飞书解密失败:', e.message);
      return { status: 400, body: { msg: '解密失败' } };
    }
  }

  // Token 验证
  if (body.token && config.verificationToken && body.token !== config.verificationToken) {
    return { status: 403, body: { msg: 'Token 验证失败' } };
  }

  // 处理消息事件
  const event = eventData.event || {};
  if (event.type === 'im.message.receive_v1') {
    // 解析消息内容
    let text = '';
    let msgId = '';
    try {
      const msgContent = JSON.parse(event.message?.content || '{}');
      text = msgContent.text || '';
    } catch {
      text = event.message?.content || '';
    }
    msgId = event.message?.message_id || '';
    const userId = event.sender?.sender_id?.open_id || 'unknown';
    const chatId = event.message?.chat_id || '';

    if (!text) {
      // 空消息回复提示
      return {
        status: 200,
        body: { msg_type: 'text', content: JSON.stringify({ text: '请发送文字消息，如: 水温15度体重200g投喂量' }) },
      };
    }

    console.log(`💬 飞书消息: ${userId} — "${text.substring(0, 50)}"`);

    // 获取用户会话 → 调用智能对话
    const session = getSession('feishu:' + userId);
    let result;
    try {
      result = await chat(text, session.history);
      session.history.push(
        { role: 'user', content: text },
        { role: 'assistant', content: result.answer }
      );
      if (session.history.length > 20) session.history = session.history.slice(-20);
    } catch (e) {
      result = { answer: '抱歉，处理出错了，请稍后重试。', sources: [] };
    }

    // 构建飞书被动回复 (文本格式)
    let replyText = result.answer
      .replace(/\*\*/g, '**')   // 保留加粗（飞书支持）
      .replace(/\n{3,}/g, '\n\n');

    if (replyText.length > 4000) {
      replyText = replyText.substring(0, 4000) + '\n\n...(内容较长，已截断)';
    }

    // 添加来源
    if (result.sources && result.sources.length > 0) {
      const srcNames = result.sources.slice(0, 4).map(s => '📖 ' + s.title).join('\n');
      replyText += '\n\n——— 📚 参考来源 ———\n' + srcNames;
    }

    console.log(`✅ 飞书回复: ${userId} — "${replyText.substring(0, 80)}..."`);

    // 飞书被动回复格式: msg_type + content(JSON字符串)
    return {
      status: 200,
      body: {
        msg_type: 'text',
        content: JSON.stringify({ text: replyText }),
      },
    };
  }

  // 其他事件类型直接返回 OK
  return { status: 200, body: {} };
}

// 构建飞书富文本消息卡片
function buildFeishuCard(result, originalQuery) {
  // 清理 Markdown 为纯文本
  let cleanAnswer = result.answer
    .replace(/\*\*(.+?)\*\*/g, '**$1**')  // 保留加粗
    .replace(/#{1,4}\s/g, '')
    .replace(/\n{3,}/g, '\n\n');

  if (cleanAnswer.length > 2500) {
    cleanAnswer = cleanAnswer.substring(0, 2500) + '\n\n...(内容较长，已截断)';
  }

  // 来源链接
  const sourceElements = (result.sources || []).slice(0, 4).map((s, i) => ({
    tag: 'div',
    text: { tag: 'lark_md', content: `📖 **${s.title}** (相关度: ${'⭐'.repeat(Math.min(5, s.relevance || 1))})` },
  }));

  // 飞书消息卡片 (V2 格式)
  const card = {
    msg_type: 'interactive',
    card: {
      header: {
        title: { tag: 'plain_text', content: '🐟 鲑鱼博士 · 智能问答' },
        template: 'blue',
      },
      elements: [
        {
          tag: 'div',
          fields: [
            { is_short: false, text: { tag: 'lark_md', content: `**问题:** ${originalQuery.substring(0, 100)}` } },
          ],
        },
        { tag: 'hr' },
        {
          tag: 'div',
          text: { tag: 'lark_md', content: cleanAnswer },
        },
      ],
    },
  };

  // 添加来源
  if (sourceElements.length > 0) {
    card.card.elements.push({ tag: 'hr' });
    card.card.elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: '**📚 引用来源:**' },
    });
    card.card.elements.push(...sourceElements);
  }

  card.card.elements.push({ tag: 'hr' });
  card.card.elements.push({
    tag: 'note',
    elements: [{ tag: 'plain_text', content: '💡 可以继续追问，我会记住对话上下文 · Powered by Claude' }],
  });

  return card;
}

// ================================================================
// 导出
// ================================================================
module.exports = {
  handleWecom,
  handleFeishu,
  getSession,
  SESSION_TTL,
};
