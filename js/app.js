// ================================================================
// app.js — 三文鱼养殖投喂管理系统 主应用
// ================================================================

// ============ 全局状态 ============
let records = [];
let charts = {};

// ============ Tab 切换 ============
function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  const btns = document.querySelectorAll('nav button');
  const tabNames = ['calculator', 'records', 'dashboard', 'knowledge', 'chatbot'];
  const idx = tabNames.indexOf(name);
  if (idx >= 0 && btns[idx]) btns[idx].classList.add('active');
  if (name === 'dashboard') renderDashboard();
  if (name === 'knowledge') renderKnowledgeTab();
  if (name === 'records') renderRecords();
}

// ============ 投喂计算 (三法对比) ============
function calcFeeding() {
  const params = {
    avgWeight: parseFloat(document.getElementById('avgWeight').value),
    count: parseInt(document.getElementById('count').value),
    waterTemp: parseFloat(document.getElementById('waterTemp').value),
    doLevel: parseFloat(document.getElementById('doLevel').value),
    fishType: document.getElementById('fishType').value,
  };
  const ph = parseFloat(document.getElementById('ph').value);
  const ammonia = parseFloat(document.getElementById('ammonia').value);
  const result = FeedingEngine.calculate(params);
  const wq = FeedingEngine.assessWaterQuality(params.waterTemp, params.doLevel, ph, ammonia);

  let html = '<div class="card"><h3>🎯 综合推荐结果</h3>';
  html += `<div class="result-box">`;
  html += `<span class="val">${result.dailyFeed.toFixed(2)}</span> <span class="unit">kg/天</span>`;
  html += `&nbsp;|&nbsp; 推荐投饲率: <b>${result.feedingRate.toFixed(3)}%</b>`;
  html += `&nbsp;|&nbsp; 分 <b>${result.mealsPerDay}</b> 次 (${result.mealTimes.join(', ')})`;
  html += `<br><small style="color:#888">推荐策略: ${result.recommendedMethod}</small></div>`;

  // 三法对比卡片
  html += '<div class="grid-3" style="margin-top:16px">';
  const methods = result.methods;
  ['table','science','growth'].forEach(key => {
    const m = methods[key];
    const r = m.rate || 0;
    const d = m.daily || 0;
    html += `<div class="card" style="padding:14px;text-align:center">
      <div style="font-size:13px;font-weight:700;margin-bottom:6px">${m.label}</div>
      <div style="font-size:26px;font-weight:800;color:var(--accent)">${r.toFixed(3)}%</div>
      <div style="font-size:11px;color:var(--text-dim)">${d.toFixed(2)} kg/天</div>
      <div style="font-size:10px;color:var(--text-dim);margin-top:4px">${m.source}</div>
    </div>`;
  });
  html += '</div>';

  // 详细推导步骤
  html += '<details open style="margin-top:16px"><summary style="cursor:pointer;font-weight:700;color:var(--accent)">📐 点击展开完整推导过程</summary><div style="margin-top:8px">';
  ['table','science','growth'].forEach(key => {
    const m = methods[key];
    html += `<div class="card" style="padding:12px;margin-bottom:8px"><b>${m.label}</b> — ${m.source}`;
    m.steps.forEach(s => {
      html += `<div class="step-list"><div>
        <b>步骤${s.step}: ${s.title}</b><br>
        📐 公式: <code>${s.formula || ''}</code><br>
        📥 输入: ${s.input}<br>
        📤 结果: ${s.result}<br>
        <span class="src">📖 ${s.source}</span>
        ${s.detail ? `<br><small>💡 ${s.detail}</small>` : ''}
      </div></div>`;
    });
    if (m.extras) {
      m.extras.forEach(s => {
        html += `<div class="step-list"><div>
          <b>步骤${s.step}: ${s.title}</b><br>
          📐 公式: <code>${s.formula || ''}</code><br>
          📤 ${s.result}<br>
          <span class="src">📖 ${s.source}</span>
        </div></div>`;
      });
    }
    html += '</div>';
  });
  html += '</div></details>';

  // 预警
  result.warnings.forEach(w => {
    const cls = w.startsWith('🚨') ? 'warning critical' : 'warning';
    html += `<div class="${cls}">${w}</div>`;
  });
  if (wq.issues.length > 0) {
    html += `<div class="warning ${wq.status==='critical'?'critical':''}">🌊 水质评估: ${wq.issues.join(', ')}</div>`;
  }

  html += '</div>';
  document.getElementById('feedingResult').innerHTML = html;
}

// ============ 投喂记录 ============
function addRecord() {
  const rec = {
    date: document.getElementById('recDate').value || new Date().toISOString().split('T')[0],
    feed: parseFloat(document.getElementById('recFeed').value) || 0,
    rate: parseInt(document.getElementById('recRate').value) || 0,
    weight: parseInt(document.getElementById('recWeight').value) || 0,
    temp: parseFloat(document.getElementById('recTemp').value) || 0,
    doLevel: parseFloat(document.getElementById('recDO').value) || 0,
    note: document.getElementById('recNote').value || '',
  };
  records.unshift(rec);
  saveRecords();
  renderRecords();
  // 清空
  document.getElementById('recFeed').value = '';
  document.getElementById('recNote').value = '';
}

function renderRecords() {
  const tbody = document.getElementById('recordTable');
  tbody.innerHTML = records.map((r, i) => `<tr>
    <td>${r.date}</td><td>${r.feed}</td><td>${r.rate}%</td><td>${r.weight}</td>
    <td>${r.temp}</td><td>${r.doLevel}</td><td>${r.note}</td>
    <td><button class="btn btn-danger btn-sm" onclick="delRecord(${i})">删除</button></td>
  </tr>`).join('');
}

function delRecord(i) { records.splice(i, 1); saveRecords(); renderRecords(); }

function saveRecords() {
  try { localStorage.setItem('salmon_records', JSON.stringify(records)); } catch(e) {}
}
function loadRecords() {
  try { records = JSON.parse(localStorage.getItem('salmon_records') || '[]'); } catch(e) { records = []; }
  if (records.length === 0) {
    // 预置示例数据
    const today = new Date();
    for (let i = 14; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      records.push({
        date: d.toISOString().split('T')[0],
        feed: 40 + Math.random() * 20,
        rate: 80 + Math.floor(Math.random() * 20),
        weight: 120 + Math.floor(i * 2.2 + Math.random() * 5),
        temp: 13 + Math.random() * 4,
        doLevel: 7.5 + Math.random() * 3,
        note: i === 0 ? '今日记录' : '',
      });
    }
    saveRecords();
  }
}

// ============ 数据分析面板 ============
function renderDashboard() {
  if (records.length === 0) loadRecords();

  // 统计数据
  const totalFeed = records.reduce((s, r) => s + r.feed, 0);
  const avgRate = records.length > 0 ? Math.round(records.reduce((s, r) => s + r.rate, 0) / records.length) : 0;
  const firstW = records.length > 0 ? records[records.length - 1].weight : 0;
  const lastW = records.length > 0 ? records[0].weight : 0;
  const weightGain = lastW - firstW;
  const fcr = FeedingEngine.calcFCR(totalFeed, weightGain / 1000);
  const avgDO = records.length > 0 ? (records.reduce((s,r)=>s+r.doLevel,0)/records.length).toFixed(1) : 0;

  document.getElementById('statCards').innerHTML = `
    <div class="stat-card"><div class="num">${totalFeed.toFixed(1)}</div><div class="label">总投喂量 (kg)</div></div>
    <div class="stat-card"><div class="num">${avgRate}%</div><div class="label">平均摄食率</div></div>
    <div class="stat-card"><div class="num">${fcr}</div><div class="label">FCR (饲料转化率)</div></div>
    <div class="stat-card"><div class="num">${weightGain}g</div><div class="label">总增重</div></div>
    <div class="stat-card"><div class="num">${avgDO}</div><div class="label">平均溶氧 (mg/L)</div></div>
    <div class="stat-card"><div class="num">${records.length}</div><div class="label">记录天数</div></div>
  `;

  // 预警
  const warnings = [];
  if (fcr > 2.0) warnings.push('⚠️ FCR 偏高 (>2.0)，建议检查饲料质量或鱼体健康');
  if (parseFloat(avgDO) < 7) warnings.push('⚡ 近期平均溶氧偏低，建议加强增氧');
  if (avgRate < 70) warnings.push('📉 近期摄食率偏低，检查水质和鱼体状况');
  document.getElementById('warnings').innerHTML = warnings.length > 0
    ? warnings.map(w => `<div class="warning">${w}</div>`).join('')
    : '<div style="color:#27ae60">✅ 所有指标正常，无需预警</div>';

  // 图表
  setTimeout(() => {
    const dates = records.map(r => r.date).reverse();
    const feeds = records.map(r => r.feed).reverse();
    const weights = records.map(r => r.weight).reverse();

    if (!charts.feed) charts.feed = echarts.init(document.getElementById('chartFeed'));
    charts.feed.setOption({
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: dates },
      yAxis: { type: 'value', name: 'kg' },
      series: [{ name: '投喂量', type: 'bar', data: feeds, itemStyle: { color: '#2980b9' } }],
    });

    if (!charts.growth) charts.growth = echarts.init(document.getElementById('chartGrowth'));
    charts.growth.setOption({
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: dates },
      yAxis: { type: 'value', name: 'g' },
      series: [{ name: '体重', type: 'line', data: weights, smooth: true, itemStyle: { color: '#27ae60' } }],
    });
  }, 200);
}

// ============ 知识库 ============
function renderKnowledgeTab() {
  const kb = KnowledgeBase.getKnowledgeSources();
  document.getElementById('kbTable').innerHTML = kb.map(k =>
    `<tr><td>${k.id}</td><td>${k.title}</td><td>${k.source}</td><td><span class="kb-tag">${k.type}</span></td></tr>`
  ).join('');

  // 渲染投饲率速查表
  const tbl = KnowledgeBase.feedingTable;
  let tableHtml = '<table><thead><tr><th>水温</th>' +
    tbl.weightLevels.map(w => `<th>${w}g</th>`).join('') + '</tr></thead><tbody>';
  tbl.rates.forEach((row, i) => {
    tableHtml += `<tr><td><b>${tbl.temps[i]}℃</b></td>` + row.map(r => `<td>${r}%</td>`).join('') + '</tr>';
  });
  tableHtml += '</tbody></table>';
  document.getElementById('feedingTableDiv').innerHTML = tableHtml;
}

// ============ AI 问答 ============
function askAI() {
  const input = document.getElementById('chatInput');
  const q = input.value.trim();
  if (!q) return;

  const box = document.getElementById('chatBox');
  box.innerHTML += `<div class="chat-msg user">${q}</div>`;
  input.value = '';
  box.scrollTop = box.scrollHeight;

  // 本地知识库匹配
  const answer = localQA(q);
  setTimeout(() => {
    box.innerHTML += `<div class="chat-msg ai">${answer}</div>`;
    box.scrollTop = box.scrollHeight;
  }, 500);
}

function localQA(question) {
  const q = question.toLowerCase();
  // 匹配水温+体重组合
  const tempMatch = q.match(/水温\s*(\d+)/) || q.match(/(\d+)\s*度/);
  const weightMatch = q.match(/体重\s*(\d+)\s*g/i) || q.match(/(\d+)\s*g[^/]/);
  const doMatch = q.match(/溶氧\s*([\d.]+)/);

  if (tempMatch && weightMatch) {
    const temp = parseFloat(tempMatch[1]);
    const weight = parseFloat(weightMatch[1]);
    const result = FeedingEngine.calculate({ avgWeight: weight, count: 1000, waterTemp: temp, doLevel: 9, fishType: '三文鱼' });
    let ans = `📐 水温 <b>${temp}℃</b>、体重 <b>${weight}g</b> 时：<br><br>`;
    ans += `• 基准投饲率: <b>${result.feedingRate}%</b><br>`;
    ans += `• 每1000尾日投喂量: <b>${(result.dailyFeed).toFixed(2)} kg</b><br>`;
    ans += `• 建议分 <b>${result.mealsPerDay}</b> 次投喂<br>`;
    ans += `• 每餐: <b>${result.feedPerMeal.toFixed(2)} kg</b><br><br>`;
    ans += `📖 <small>来源: 《水产动物营养与饲料学》虹鳟投饲率表</small>`;
    return ans;
  }

  if (q.includes('fcr') || q.includes('饲料转化')) {
    return '📊 <b>FCR (饲料转化率)</b> = 投喂饲料总量 ÷ 鱼体增重<br><br>理想值 1.0~1.5，FCR > 2.0 提示饲料浪费或鱼体健康问题。<br><br>📖 <small>来源: FAO 水产养殖手册</small>';
  }

  if (q.includes('溶氧') || q.includes('do')) {
    return '🌊 三文鱼溶氧要求 <b>≥ 9 mg/L</b><br><br>溶氧越低摄食越少：<br>• 9 mg/L → 正常 (系数1.0)<br>• 5 mg/L → 摄食率87%<br>• 3 mg/L → 摄食率64%<br>• 1 mg/L → 停食<br><br>📖 <small>来源: 鲤科鱼类实验数据</small>';
  }

  if (q.includes('水温') && !weightMatch) {
    return '🌡️ 三文鱼适宜水温 <b>2~22℃</b>，最佳 <b>12~18℃</b><br><br>• < 10℃: 日投喂2次<br>• 10~22℃: 日投喂3次<br>• > 20℃: 每升1℃投喂量减3.5%<br>• > 22℃ 或 < 2℃: 暂停投喂<br><br>📖 <small>来源: CN103766250A 专利 + 虹鳟投饲率表</small>';
  }

  if (q.includes('密度') || q.includes('养殖密度')) {
    return '🐟 <b>虹鳟养殖密度标准 (DB63/T 1042—2011):</b><br><br>• 稚鱼(1-2g): <b>400尾/m³</b><br>• 鱼种(51-100g): <b>40尾/m³</b><br>• 商品鱼(100-150g): <b>28尾/m³</b><br>• 商品鱼(250-500g): <b>14尾/m³</b><br>• 大规格(>500g): <b><3尾/m³</b><br><br>RAS系统: 30-80 kg/m³, 网箱: 10-40 kg/m³<br>📖 <small>来源: DB63/T 1042—2011, DB63/T 2430—2025</small>';
  }

  if (q.includes('疾病') || q.includes('生病') || q.includes('发病')) {
    let ans = '🩺 <b>三文鱼常见疾病 (NY/T 755—2003):</b><br><br>';
    KnowledgeBase.diseases.forEach(d => {
      ans += `• <b>${d.name}</b>: ${d.symptom}<br>  💊 ${d.treatment}<br><br>`;
    });
    ans += '原则: 预防为主、防重于治。苗种入箱前用1-3%氯化钠浸洗。<br>📖 <small>来源: NY/T 755—2003</small>';
    return ans;
  }

  if (q.includes('模型') || q.includes('公式') || q.includes('生长')) {
    const m = KnowledgeBase.atlanticSalmon;
    return `📐 <b>大西洋鲑生长与排放模型 (孙国祥 2014):</b><br><br>
      <b>生长模型:</b> ${m.growthModel}<br>
      <b>氮排放:</b> ${m.nitrogenModel}<br>
      <b>磷排放:</b> ${m.phosphorusModel}<br><br>
      模型偏离度: 生长12.68%, 氮17.93%, 磷23.65%<br><br>
      最优参数: 投喂率<b>${m.optimal.rate}%</b>, <b>${m.optimal.frequency}次/天</b>, <b>${m.optimal.density}kg/m³</b><br>
      📖 <small>来源: 中科院海洋研究所博士论文</small>`;
  }

  if (q.includes('mode') && (q.includes('fcr') || q.includes('模式'))) {
    let ans = '📊 <b>FCR标准 (按养殖模式):</b><br><br>';
    KnowledgeBase.fcrStandards.forEach(s => {
      ans += `• ${s.mode}: 密度${s.density} → FCR <b>${s.fcr}</b><br>`;
    });
    ans += '<br>理想FCR: 1.0-1.2。密度越高FCR越差。<br>📖 <small>来源: FAO + 行业数据</small>';
    return ans;
  }

  if (q.includes('你好') || q.includes('帮助') || q.includes('功能')) {
    return '👋 我是三文鱼养殖AI助手！知识库已收录 <b>12条知识源</b> (教材+论文+标准+专利)，能回答：<br><br>• 投喂量计算 (水温+体重+溶氧)<br>• FCR饲料转化率 + 养殖模式<br>• 水质标准 + 养殖密度<br>• 疾病防控 (5种常见病)<br>• 生长模型 (孙国祥2014)<br>• DOmaxFI温度模型 (Remen2016)<br><br>试试输入 "水温18度体重200g" 或 "密度标准" 或 "疾病防治"';
  }

  return '🤔 请提供具体参数或关键词：<br><br>📐 投喂计算: "水温15度体重150g"<br>📊 FCR: "不同模式FCR"<br>🐟 密度: "密度标准"<br>🩺 疾病: "疾病防治"<br>📈 模型: "生长模型公式"';
}

// ============ 主题切换 ============
let darkMode = true;
function toggleDark() {
  darkMode = !darkMode;
  const root = document.documentElement;
  if (darkMode) {
    root.style.setProperty('--ocean-deep', '#0a1628');
    root.style.setProperty('--card-bg', '#12243a');
    root.style.setProperty('--text', '#d0dce8');
  } else {
    root.style.setProperty('--ocean-deep', '#e8f0f4');
    root.style.setProperty('--card-bg', '#ffffff');
    root.style.setProperty('--text', '#333333');
  }
}

// ============ 初始化 ============
function init() {
  loadRecords();
  document.getElementById('recDate').value = new Date().toISOString().split('T')[0];
  setInterval(() => {
    document.getElementById('clock').textContent = new Date().toLocaleString('zh-CN');
  }, 1000);
  document.getElementById('clock').textContent = new Date().toLocaleString('zh-CN');
}

window.addEventListener('load', init);
window.addEventListener('resize', () => {
  Object.values(charts).forEach(c => c.resize());
});
