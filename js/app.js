// ================================================================
// app.js — 三文鱼养殖投喂管理系统 v2.1
// 新增: 实时验证 + pH/氨氮修正 + Toast通知
// ================================================================

let records = [], charts = {};

// ============ Tab 切换 ============
function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  const el = document.getElementById('tab-' + name);
  if (el) el.classList.add('active');
  const idx = ['calculator','records','dashboard','knowledge','chatbot'].indexOf(name);
  if (idx >= 0) document.querySelectorAll('nav button')[idx].classList.add('active');
  if (name === 'dashboard') renderDashboard();
  if (name === 'knowledge') renderKnowledgeTab();
  if (name === 'records') renderRecords();
  if (name === 'calculator') validateParams();
}

// ============ 参数阈值 ============
const LIMITS = {
  avgWeight: { min: 1, max: 5000, label: '体重', unit: 'g' },
  count: { min: 1, max: 999999, label: '数量', unit: '尾' },
  waterTemp: { min: 2, max: 22, label: '水温', unit: '℃', optimal: [12, 18] },
  doLevel: { min: 0, max: 20, label: '溶氧', unit: 'mg/L', warn: 7, crit: 4, ok: 9 },
  ph: { min: 6, max: 8, label: 'pH', unit: '', optimal: [7, 7.5] },
  ammonia: { min: 0, max: 2, label: '氨氮', unit: 'mg/L', warn: 0.2, crit: 0.6 },
};

function validateParams() {
  const statusEl = document.getElementById('paramStatus');
  const alertEl = document.getElementById('alertBox');
  const liveWarn = document.getElementById('liveWarnings');
  const issues = [];
  let hasCritical = false, hasWarning = false;

  Object.keys(LIMITS).forEach(key => {
    const el = document.getElementById(key);
    if (!el) return;
    const val = parseFloat(el.value);
    const lim = LIMITS[key];
    el.classList.remove('invalid', 'warning-input', 'valid');
    if (isNaN(val)) return;

    if (val < lim.min || val > lim.max) {
      el.classList.add('invalid');
      issues.push({ type: 'crit', msg: `🚫 ${lim.label}: ${val}${lim.unit} 超出允许范围 [${lim.min}~${lim.max}${lim.unit}]` });
      hasCritical = true;
    } else if (lim.crit !== undefined && val <= lim.crit) {
      el.classList.add('invalid');
      issues.push({ type: 'crit', msg: `🚨 ${lim.label}: ${val}${lim.unit} 已达危险水平 (临界: ${lim.crit}${lim.unit})` });
      hasCritical = true;
    } else if (lim.warn !== undefined && val < lim.warn) {
      el.classList.add('warning-input');
      issues.push({ type: 'warn', msg: `⚡ ${lim.label}: ${val}${lim.unit} 低于推荐 (≥${lim.warn}${lim.unit})` });
      hasWarning = true;
    } else if (lim.optimal && (val < lim.optimal[0] || val > lim.optimal[1])) {
      el.classList.add('warning-input');
      issues.push({ type: 'info', msg: `💡 ${lim.label}: ${val}${lim.unit} 偏离最佳 [${lim.optimal[0]}~${lim.optimal[1]}${lim.unit}]` });
    } else {
      el.classList.add('valid');
    }
  });

  if (hasCritical) {
    statusEl.textContent = '🔴 存在严重参数异常'; statusEl.style.color = '#e74c3c';
    alertEl.style.display = 'block'; alertEl.innerHTML = issues.filter(i => i.type === 'crit').map(i => i.msg).join('<br>');
    document.getElementById('calcBtn').disabled = true;
  } else if (hasWarning) {
    statusEl.textContent = '🟡 部分参数需关注'; statusEl.style.color = '#e67e22';
    alertEl.style.display = 'block'; alertEl.innerHTML = issues.filter(i => i.type === 'warn' || i.type === 'info').map(i => i.msg).join('<br>');
    document.getElementById('calcBtn').disabled = false;
  } else {
    statusEl.textContent = '✅ 所有参数正常'; statusEl.style.color = '#27ae60';
    alertEl.style.display = 'none';
    document.getElementById('calcBtn').disabled = false;
  }

  if (issues.length > 0) {
    liveWarn.innerHTML = issues.map(i => `<div class="live-warn ${i.type}">${i.msg}</div>`).join('');
  } else {
    liveWarn.innerHTML = '';
  }
  return { hasCritical, hasWarning, issues };
}

function showToast(msg, type) {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 3000);
  setTimeout(() => t.remove(), 3500);
}

function autoFillDemo() {
  document.getElementById('avgWeight').value = 200;
  document.getElementById('count').value = 8000;
  document.getElementById('waterTemp').value = 15;
  document.getElementById('doLevel').value = 9.5;
  document.getElementById('ph').value = 7.3;
  document.getElementById('ammonia').value = 0.1;
  validateParams();
  showToast('✅ 已填充三文鱼标准参数', 'ok');
}

// ============ 各参数修正函数 ============
function correctionFactors() {
  const avgWeight = parseFloat(document.getElementById('avgWeight').value) || 150;
  const count = parseInt(document.getElementById('count').value) || 5000;
  const waterTemp = parseFloat(document.getElementById('waterTemp').value) || 14;
  const doLevel = parseFloat(document.getElementById('doLevel').value) || 8.5;
  const ph = parseFloat(document.getElementById('ph').value) || 7.2;
  const ammonia = parseFloat(document.getElementById('ammonia').value) || 0.15;

  const factors = [];

  // 水温偏离最佳
  if (waterTemp < 12) {
    const f = Math.max(0.4, 0.6 + (waterTemp - 2) * 0.04);
    factors.push({ label: '水温偏低', value: waterTemp+'℃', impact: `×${f.toFixed(2)}`, detail: `最佳12-18℃, 当前${waterTemp}℃→代谢减缓`, type: 'warn' });
  } else if (waterTemp > 18 && waterTemp <= 20) {
    const f = 1 - (waterTemp - 18) * 0.03;
    factors.push({ label: '水温偏高', value: waterTemp+'℃', impact: `×${f.toFixed(2)}`, detail: `最佳12-18℃→小幅降量`, type: 'warn' });
  } else if (waterTemp > 20) {
    const f = (1 - 0.035 * (waterTemp - 20));
    factors.push({ label: '高温修正', value: waterTemp+'℃', impact: `×${f.toFixed(2)}`, detail: `>20℃每升1℃减3.5%`, type: 'crit' });
  }

  // 溶氧
  const satMgL = 14.6 - 0.4 * waterTemp;
  const doMaxMgL = 66 / 100 * satMgL;
  if (doLevel < 9) {
    const doF = 1/(1+Math.exp(-0.8*(doLevel - doMaxMgL*0.6)));
    const f = Math.round(doF*100)/100;
    if (f < 0.95) {
      factors.push({ label: '溶氧不足', value: doLevel+'mg/L', impact: `×${f.toFixed(2)}`, detail: `DOmaxFI≈${doMaxMgL.toFixed(1)}mg/L(66%)→摄食抑制`, type: f<0.5?'crit':'warn' });
    }
  }

  // pH
  let phF = 1.0;
  if (ph < 6.5 && ph >= 6.0) phF = 0.85;
  else if (ph < 6.0 && ph >= 5.5) phF = 0.6;
  else if (ph < 5.5) phF = 0.3;
  else if (ph > 8.0 && ph <= 8.5) phF = 0.85;
  else if (ph > 8.5 && ph <= 9.0) phF = 0.5;
  else if (ph > 9.0) phF = 0.3;
  if (phF < 1.0) {
    factors.push({ label: 'pH偏离', value: ph+'', impact: `×${phF.toFixed(2)}`, detail: `中性7.0→偏离${Math.abs(7-ph).toFixed(1)}`, type: phF<0.5?'crit':'warn' });
  }

  // 氨氮
  if (ammonia > 0.2) {
    const nh3F = Math.max(0.5, 1 - (ammonia - 0.2) * 0.8);
    factors.push({ label: '氨氮超标', value: ammonia+'mg/L', impact: `×${nh3F.toFixed(2)}`, detail: `安全限0.2mg/L→超出${(ammonia-0.2).toFixed(2)}`, type: ammonia>0.6?'crit':'warn' });
  }

  // 体重 (大鱼修正已在引擎里)
  if (avgWeight > 500) {
    factors.push({ label: '大鱼代谢', value: avgWeight+'g', impact: '引擎内修正', detail: '大鱼代谢率低,投饲率自动下调', type: 'info' });
  }

  return { factors, phF, ammoniaF: ammonia>0.2?Math.max(0.5,1-(ammonia-0.2)*0.8):1.0 };
}

// ============ 自动计算(防抖) ============
let autoTimer = null;
function autoCalc() {
  validateParams();
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    const v = validateParams();
    if (!v.hasCritical) calcFeeding();
  }, 400);
}

// ============ 投喂计算 ============
function calcFeeding() {
  const v = validateParams();
  if (v.hasCritical) { showToast('❌ 参数异常，请修正后重试', 'error'); document.getElementById('feedingResult').innerHTML=''; return; }

  const avgWeight = parseFloat(document.getElementById('avgWeight').value);
  const count = parseInt(document.getElementById('count').value);
  const waterTemp = parseFloat(document.getElementById('waterTemp').value);
  const doLevel = parseFloat(document.getElementById('doLevel').value);
  const ph = parseFloat(document.getElementById('ph').value);
  const ammonia = parseFloat(document.getElementById('ammonia').value);
  const fishType = document.getElementById('fishType').value;

  const result = FeedingEngine.calculate({ avgWeight, count, waterTemp, doLevel, fishType });
  const corr = correctionFactors();
  const wq = FeedingEngine.assessWaterQuality(waterTemp, doLevel, ph, ammonia);

  // 应用全部修正
  let totalCorrection = 1.0;
  corr.factors.forEach(f => {
    const m = f.impact.match(/×([\d.]+)/);
    if (m) totalCorrection *= parseFloat(m[1]);
  });
  result.dailyFeed = Math.round(result.dailyFeed * totalCorrection * 1000) / 1000;
  result.feedPerMeal = Math.round(result.dailyFeed / result.mealsPerDay * 1000) / 1000;
  result.feedingRate = Math.round(result.feedingRate * totalCorrection * 1000) / 1000;
  Object.keys(result.methods).forEach(k => {
    result.methods[k].rate = Math.round(result.methods[k].rate * totalCorrection * 1000) / 1000;
    result.methods[k].daily = Math.round(result.methods[k].daily * totalCorrection * 1000) / 1000;
  });

  // === 渲染 ===
  let html = '<div class="card"><h3>🎯 综合推荐结果</h3>';
  html += `<div class="result-box"><span class="val">${result.dailyFeed.toFixed(2)}</span> <span class="unit">kg/天</span> &nbsp;|&nbsp; 投饲率: <b>${result.feedingRate.toFixed(3)}%</b> &nbsp;|&nbsp; 分 <b>${result.mealsPerDay}</b> 次<br><small style="color:#888">策略: ${result.recommendedMethod} | 总修正系数: ×${totalCorrection.toFixed(3)}</small></div>`;

  // 环境修正面板 (显示每一项的影响)
  if (corr.factors.length > 0) {
    html += '<div style="margin-top:12px;padding:12px 16px;background:rgba(15,40,71,.5);border:1px solid var(--border);border-radius:10px;font-size:12px">';
    html += '<b>🌍 环境修正链 (每项独立影响):</b><br>';
    corr.factors.forEach(f => {
      const icon = f.type==='crit'?'🔴':f.type==='warn'?'🟡':'🔵';
      html += `<div style="margin:4px 0;display:flex;align-items:center;gap:8px">${icon} <b>${f.label}</b>: ${f.value} → <code>${f.impact}</code> <small style="color:var(--text-dim)">${f.detail}</small></div>`;
    });
    html += `<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border)">📊 综合修正: <b>×${totalCorrection.toFixed(3)}</b></div>`;
    html += '</div>';
  }

  // 三法对比
  html += '<div class="grid-3" style="margin-top:16px">';
  ['table','science','growth'].forEach(key => {
    const m = result.methods[key];
    html += `<div class="card" style="padding:14px;text-align:center"><div style="font-size:13px;font-weight:700;margin-bottom:6px">${m.label}</div><div style="font-size:26px;font-weight:800;color:var(--accent)">${(m.rate||0).toFixed(3)}%</div><div style="font-size:11px;color:var(--text-dim)">${(m.daily||0).toFixed(2)} kg/天</div><div style="font-size:10px;color:var(--text-dim);margin-top:4px">${m.source}</div></div>`;
  });
  html += '</div>';

  // 推导
  html += '<details style="margin-top:16px"><summary style="cursor:pointer;font-weight:700;color:var(--accent)">📐 展开推导过程</summary><div style="margin-top:8px">';
  ['table','science','growth'].forEach(key => {
    const m = result.methods[key];
    html += `<div class="card" style="padding:12px;margin-bottom:8px"><b>${m.label}</b> — ${m.source}`;
    m.steps.forEach(s => html += `<div class="step-list"><div><b>步骤${s.step}: ${s.title}</b><br>📐 <code>${s.formula||''}</code><br>📥 ${s.input}<br>📤 ${s.result}<br><span class="src">📖 ${s.source}</span>${s.detail?`<br><small>💡 ${s.detail}</small>`:''}</div></div>`);
    html += '</div>';
  });
  html += '</div></details>';

  result.warnings.forEach(w => html += `<div class="warning ${w.startsWith('🚨')?'critical':''}">${w}</div>`);
  if (wq.issues.length > 0) html += `<div class="warning ${wq.status==='critical'?'critical':''}">🌊 水质评估: ${wq.issues.join(', ')}</div>`;
  if (ammonia > 0.6) html += '<div class="warning critical">🚨 氨氮严重超标(>0.6mg/L)!</div>';
  if (ph < 5.5 || ph > 9) html += '<div class="warning critical">🚨 pH严重异常!</div>';

  html += '</div>';
  document.getElementById('feedingResult').innerHTML = html;
  if (corr.factors.length === 0) showToast('✅ 计算完成，参数正常', 'ok');
  else showToast(`⚙️ 已应用${corr.factors.length}项环境修正`, 'warn');
}

// ============ 投喂记录 ============
function addRecord() {
  const r = {
    date: document.getElementById('recDate').value || new Date().toISOString().split('T')[0],
    feed: parseFloat(document.getElementById('recFeed').value) || 0,
    rate: parseInt(document.getElementById('recRate').value) || 0,
    weight: parseInt(document.getElementById('recWeight').value) || 0,
    temp: parseFloat(document.getElementById('recTemp').value) || 0,
    doLevel: parseFloat(document.getElementById('recDO').value) || 0,
    note: document.getElementById('recNote').value || '',
  };
  records.unshift(r); saveRecords(); renderRecords();
  document.getElementById('recFeed').value = ''; document.getElementById('recNote').value = '';
  showToast('✅ 记录已保存', 'ok');
}

function renderRecords() {
  document.getElementById('recordTable').innerHTML = records.map((r, i) =>
    `<tr><td>${r.date}</td><td>${r.feed}</td><td>${r.rate}%</td><td>${r.weight}</td><td>${r.temp}</td><td>${r.doLevel}</td><td>${r.note}</td><td><button class="btn btn-danger btn-sm" onclick="delRecord(${i})">删除</button></td></tr>`
  ).join('');
}

function delRecord(i) { records.splice(i, 1); saveRecords(); renderRecords(); }
function saveRecords() { try { localStorage.setItem('salmon_records', JSON.stringify(records)); } catch(e) {} }
function loadRecords() {
  try { records = JSON.parse(localStorage.getItem('salmon_records') || '[]'); } catch(e) { records = []; }
  if (records.length === 0) {
    const today = new Date();
    for (let i = 14; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      records.push({ date: d.toISOString().split('T')[0], feed: Math.round((40+Math.random()*20)*10)/10, rate: 80+Math.floor(Math.random()*20), weight: Math.round(120+i*2.2+Math.random()*5), temp: Math.round((13+Math.random()*4)*10)/10, doLevel: Math.round((7.5+Math.random()*3)*10)/10, note: i===0?'今日记录':'' });
    }
    saveRecords();
  }
}

// ============ 仪表盘 ============
function renderDashboard() {
  if (records.length === 0) loadRecords();
  const tf = records.reduce((s,r)=>s+r.feed,0);
  const ar = records.length>0?Math.round(records.reduce((s,r)=>s+r.rate,0)/records.length):0;
  const fw = records.length>0?records[records.length-1].weight:0;
  const lw = records.length>0?records[0].weight:0;
  const wg = lw-fw;
  const fcr = FeedingEngine.calcFCR(tf,wg/1000);
  const ado = records.length>0?(records.reduce((s,r)=>s+r.doLevel,0)/records.length).toFixed(1):0;

  document.getElementById('statCards').innerHTML = `
    <div class="stat-card"><div class="num">${tf.toFixed(1)}</div><div class="label">总投喂量 (kg)</div></div>
    <div class="stat-card"><div class="num">${ar}%</div><div class="label">平均摄食率</div></div>
    <div class="stat-card"><div class="num">${fcr}</div><div class="label">FCR</div></div>
    <div class="stat-card"><div class="num">${wg}g</div><div class="label">总增重</div></div>
    <div class="stat-card"><div class="num">${ado}</div><div class="label">平均溶氧</div></div>
    <div class="stat-card"><div class="num">${records.length}</div><div class="label">记录天数</div></div>`;

  const warns = [];
  if (fcr>2.0) warns.push('⚠️ FCR偏高(>2.0), 检查饲料或鱼体健康');
  if (parseFloat(ado)<7) warns.push('⚡ 平均溶氧偏低, 建议加强增氧');
  if (ar<70) warns.push('📉 摄食率偏低, 检查水质和鱼体');
  document.getElementById('warnings').innerHTML = warns.length>0 ? warns.map(w=>`<div class="warning">${w}</div>`).join('') : '<div style="color:#27ae60">✅ 所有指标正常</div>';

  setTimeout(() => {
    const dates = records.map(r=>r.date).reverse();
    if (!charts.feed) charts.feed = echarts.init(document.getElementById('chartFeed'));
    charts.feed.setOption({ tooltip:{trigger:'axis'}, xAxis:{type:'category',data:dates}, yAxis:{type:'value',name:'kg'}, series:[{name:'投喂量',type:'bar',data:records.map(r=>r.feed).reverse(),itemStyle:{color:'#2980b9'}}] });
    if (!charts.growth) charts.growth = echarts.init(document.getElementById('chartGrowth'));
    charts.growth.setOption({ tooltip:{trigger:'axis'}, xAxis:{type:'category',data:dates}, yAxis:{type:'value',name:'g'}, series:[{name:'体重',type:'line',data:records.map(r=>r.weight).reverse(),smooth:true,itemStyle:{color:'#27ae60'}}] });
  }, 200);
}

// ============ 知识库 ============
function renderKnowledgeTab() {
  document.getElementById('kbTable').innerHTML = KnowledgeBase.getKnowledgeSources().map(k => `<tr><td>${k.id}</td><td>${k.title}</td><td>${k.source}</td><td><span class="kb-tag">${k.type}</span></td></tr>`).join('');
  const tbl = KnowledgeBase.feedingTable;
  let th = '<table><thead><tr><th>水温</th>' + tbl.weightLevels.map(w => `<th>${w}g</th>`).join('') + '</tr></thead><tbody>';
  tbl.rates.forEach((row, i) => { th += '<tr><td><b>' + tbl.temps[i] + '℃</b></td>' + row.map(r => `<td>${r}%</td>`).join('') + '</tr>'; });
  th += '</tbody></table>';
  document.getElementById('feedingTableDiv').innerHTML = th;
}

// ============ AI 问答 ============
function askAI() {
  const input = document.getElementById('chatInput');
  const q = input.value.trim();
  if (!q) return;
  const box = document.getElementById('chatBox');
  box.innerHTML += `<div class="chat-msg user">${q}</div>`;
  input.value = ''; box.scrollTop = box.scrollHeight;
  setTimeout(() => { box.innerHTML += `<div class="chat-msg ai">${localQA(q)}</div>`; box.scrollTop = box.scrollHeight; }, 500);
}

function localQA(question) {
  const q = question.toLowerCase();
  const tm = q.match(/水温\s*(\d+)/) || q.match(/(\d+)\s*度/);
  const wm = q.match(/体重\s*(\d+)\s*g/i) || q.match(/(\d+)\s*g[^/]/);
  if (tm && wm) {
    const t = parseFloat(tm[1]), w = parseFloat(wm[1]);
    const r = FeedingEngine.calculate({ avgWeight: w, count: 1000, waterTemp: t, doLevel: 9, fishType: '三文鱼' });
    return `📐 水温<b>${t}℃</b>、体重<b>${w}g</b>:<br><br>• 推荐投饲率: <b>${r.feedingRate.toFixed(3)}%</b><br>• 每千尾日投喂: <b>${r.dailyFeed.toFixed(2)} kg</b><br>• 分<b>${r.mealsPerDay}</b>次 (${r.mealTimes.join(', ')})<br>• 三法对比: 查表${r.methods.table.rate.toFixed(2)}% | 科研${r.methods.science.rate.toFixed(2)}% | 生长${r.methods.growth.rate.toFixed(2)}%<br><br>📖 <small>来源: 投饲率表+科研模型+SGR</small>`;
  }
  if (q.includes('fcr')) return '📊 <b>FCR</b> = 投喂总量÷增重。理想1.0-1.2, >2.0需检查。<br>RAS:1.15 | 网箱:1.00 | 流水:1.05<br>📖 <small>FAO标准</small>';
  if (q.includes('溶氧')||q.includes('do')) return '🌊 三文鱼溶氧≥9mg/L, 虹鳟≥6-7mg/L。<br>DOmaxFI(15℃)=66%≈9.2mg/L, 低于此值摄食率sigmoid递减。<br>📖 <small>Remen2016</small>';
  if (q.includes('水温')&&!wm) return '🌡️ 三文鱼2-22℃(最佳12-18)。<10℃日喂2次,≥10℃日喂3次。>20℃每升1℃减3.5%。<br>📖 <small>CN103766250A</small>';
  if (q.includes('密度')) { let a='🐟 <b>虹鳟密度标准:</b><br>'; KnowledgeBase.fcrStandards.forEach(s=>a+=`• ${s.mode}:${s.density}→FCR${s.fcr}<br>`); return a+'📖 <small>DB63/T1042-2011</small>'; }
  if (q.includes('疾病')) { let a='🩺 <b>常见病:</b><br>'; KnowledgeBase.diseases.forEach(d=>a+=`• <b>${d.name}</b>: ${d.treatment}<br>`); return a+'📖 <small>NY/T755-2003</small>'; }
  if (q.includes('模型')||q.includes('公式')) return `📐 <b>三模型:</b><br>①查表: 二维双线性插值<br>②科研: FI=α×BW^β×e^(γT)×h(DO)<br>③SGR: F=1.2%×(SGR/1.5)×(W/100)^(-0.15)<br>📖 <small>教材+Azevedo2026+FAO</small>`;
  if (q.includes('ph')||q.includes('酸碱')) return '🧪 pH 6-8适宜, 6.5-8.0最优。pH<5.5或>9.0严重危害。偏离中性时投喂量自动修正: pH5.5-6→×0.6, pH8-8.5→×0.85。<br>📖 <small>水产养殖通用标准</small>';
  if (q.includes('你好')||q.includes('帮助')) return '👋 我能回答: 投喂计算/FCR/溶氧/水温/密度/疾病/pH/模型公式。试试 "水温15度体重200g"!';
  return '🤔 试试: "水温15度体重200g" | "FCR标准" | "密度" | "疾病" | "pH范围" | "模型公式"';
}

// ============ 主题 ============
let darkMode = true;
function toggleDark() {
  darkMode = !darkMode;
  const r = document.documentElement;
  if (darkMode) { r.style.setProperty('--ocean-deep','#0a1628'); r.style.setProperty('--card-bg','#12243a'); r.style.setProperty('--text','#d0dce8'); }
  else { r.style.setProperty('--ocean-deep','#e8f0f4'); r.style.setProperty('--card-bg','#ffffff'); r.style.setProperty('--text','#333333'); }
}

// ============ 初始化 ============
function init() {
  loadRecords();
  document.getElementById('recDate').value = new Date().toISOString().split('T')[0];
  validateParams();
  setInterval(() => { document.getElementById('clock').textContent = new Date().toLocaleString('zh-CN'); }, 1000);
  document.getElementById('clock').textContent = new Date().toLocaleString('zh-CN');
}

window.addEventListener('load', init);
window.addEventListener('resize', () => { Object.values(charts).forEach(c => c.resize()); });
