// ================================================================
// app.js v3 — App式界面 + 全局搜索 + 自动计算
// ================================================================
let records=[], charts={}, currentPage='home';
let chatHistory = []; // 🌟 对话历史记忆

// 🔧 统一排序: 始终返回 旧→新 的副本
function sorted(){ return [...records].sort((a,b)=>a.date.localeCompare(b.date)); }
function sortedNewFirst(){ return [...records].sort((a,b)=>b.date.localeCompare(a.date)); }

// ============ 页面切换 ============
function switchPage(name) {
  currentPage = name;
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  // Update both sidebar nav-items and mobile nav-btns
  document.querySelectorAll('.nav-item, .nav-btn').forEach(b=>b.classList.remove('active'));
  const pg = document.getElementById('page-'+name);
  if(pg) pg.classList.add('active');
  document.querySelectorAll(`[data-page="${name}"]`).forEach(b=>b.classList.add('active'));
  // 搜索栏仅首页显示
  const topBar = document.querySelector('.top-bar');
  if(topBar) topBar.style.display = (name==='home') ? 'flex' : 'none';
  if(name==='dashboard'){ renderDashboard(); setTimeout(()=>{ Object.values(charts).forEach(c=>{ try { c.resize(); } catch(e){} }); }, 350); }
  if(name==='records') renderRecords();
  if(name==='home') renderHome();
  if(name==='knowledge') refreshKnowledge();
  if(name==='calc'){ validateParams(); setTimeout(()=>calcFeeding(), 100); }
  if(name==='settings') loadSettings();
  hideSearchResults();
}

function renderHome() {
  if(records.length===0) loadRecords();
  const list=sorted(); // 旧→新，保证计算一致
  const tf=list.reduce((s,r)=>s+(r.feed||0),0);
  const ar=list.length>0?Math.round(list.reduce((s,r)=>s+(r.rate||0),0)/list.length):0;
  const initialW=list.length>0?list[0].weight:0;
  const finalW=list.length>0?list[list.length-1].weight:0;
  const wg=finalW-initialW;
  const s=JSON.parse(localStorage.getItem('salmon_settings')||'{}');
  const totalGainKg=wg*(s.count||5000)/1000;
  const fcr=FeedingEngine.calcFCR(tf,totalGainKg);
  document.getElementById('hsTotalFeed').textContent=tf.toFixed(1);
  document.getElementById('hsFCR').textContent=fcr;
  document.getElementById('hsRate').textContent=ar+'%';
  document.getElementById('hsGrowth').textContent=wg+'g';
  document.getElementById('homeRecCount').textContent=records.length+'条记录';
  document.getElementById('recordsBadge').textContent=records.length;
  // Recent records teaser (最新4条)
  const teaser=document.getElementById('recentTeaser');
  const recent=sortedNewFirst().slice(0,4);
  if(recent.length===0) {
    teaser.innerHTML='<div style="text-align:center;color:var(--text-dim);padding:20px;grid-column:1/-1">暂无记录，去「投喂计算」页创建第一条吧</div>';
  } else {
    teaser.innerHTML=recent.map(r=>`<div class="rt-item" onclick="highlightAndGo('${r.date}')" title="点击查看详情"><div class="rt-date">${r.date}</div><div class="rt-val">${r.feed}kg</div><div style="font-size:10px;color:var(--text-dim)">食${r.rate||0}% · ${r.weight||0}g · ${r.temp||0}℃</div></div>`).join('');
  }
}

// ============ 搜索索引 ============
const SEARCH_INDEX = [
  // 投喂计算相关
  { keys: ['投喂','计算','喂食','饲料','投饲','投饲率','喂料','日投喂','投喂量'], icon:'📐', label:'投喂计算', desc:'输入参数自动计算日投喂量', target:'calc' },
  // 水温
  { keys: ['水温','温度','℃','水温多少','最佳温度','高温','低温'], icon:'🌡️', label:'水温参数', desc:'三文鱼最佳12-18℃, 有效2-22℃', target:'calc', focus:'waterTemp' },
  // 体重
  { keys: ['体重','重量','鱼重','规格','大小','克','g','平均体重'], icon:'⚖️', label:'体重参数', desc:'输入鱼的平均体重 (1-5000g)', target:'calc', focus:'avgWeight' },
  // 溶氧
  { keys: ['溶氧','氧气','DO','溶解氧','溶氧量','缺氧'], icon:'🌊', label:'溶氧参数', desc:'≥9正常, <7警告, <4危急 (mg/L)', target:'calc', focus:'doLevel' },
  // pH
  { keys: ['ph','酸碱','酸碱度','ph值','酸','碱'], icon:'🧪', label:'pH 参数', desc:'最佳7.0-7.5, 有效6-8', target:'calc', focus:'ph' },
  // 氨氮
  { keys: ['氨氮','氨','氮','NH3','氨氮多少','氨氮超标'], icon:'🧫', label:'氨氮参数', desc:'<0.2安全, >0.6危急 (mg/L)', target:'calc', focus:'ammonia' },
  // FCR
  { keys: ['fcr','饲料系数','饵料系数','饲料转化','FCR多少','FCR标准'], icon:'📊', label:'FCR 饲料转化率', desc:'RAS 1.15 | 网箱 1.00 | 流水池 1.05', target:'chat', query:'FCR标准' },
  // 密度
  { keys: ['密度','养殖密度','放养密度','多少条','每立方','kg/m³'], icon:'🐟', label:'养殖密度标准', desc:'RAS 50kg/m³ | 网箱 25kg/m³', target:'chat', query:'密度' },
  // 疾病
  { keys: ['疾病','生病','病','弧菌','IPN','IHN','水霉','鳃病','坏死','细菌','感染','治疗','用药','症状','预防'], icon:'🩺', label:'疾病诊断与治疗', desc:'弧菌病/IPN/IHN/水霉/细菌性鳃病', target:'chat', query:'疾病' },
  // 知识/模型
  { keys: ['模型','科研','SGR','公式','算法','Azevedo','Remen','孙国祥','论文','专利','标准','DB','NY/T','GB'], icon:'📚', label:'知识库', desc:'12条领域知识源 (教材/论文/专利/标准)', target:'knowledge' },
  // 记录
  { keys: ['记录','历史','数据','日志','查看记录','投了多少','喂了多少'], icon:'📋', label:`投喂记录 (${records.length}条)`, desc:'查看、添加、删除投喂记录', target:'records' },
  // 图表/面板
  { keys: ['图表','趋势','面板','数据','统计','分析','报表','生长','曲线','走势'], icon:'📈', label:'数据分析面板', desc:'投喂趋势图 + 生长曲线 + 智能预警', target:'dashboard' },
  // 水质综合
  { keys: ['水质','水环境','环境','水体','监测','检测'], icon:'🔬', label:'水质参数说明', desc:'水温/溶氧/pH/氨氮标准与修正', target:'calc' },
  // 设置
  { keys: ['设置','配置','导入','导出','备份','恢复','默认','参数设置','数据管理'], icon:'⚙️', label:'系统设置', desc:'默认参数配置 + 数据导入导出', target:'settings' },
];

// ============ 搜索功能 ============
function showSearchResults() { document.getElementById('searchResults').style.display='block'; document.getElementById('searchOverlay').style.display='block'; }
function hideSearchResults() { document.getElementById('searchResults').style.display='none'; document.getElementById('searchOverlay').style.display='none'; }

function onSearch(q) {
  if (!q || q.length<1) { hideSearchResults(); return; }
  showSearchResults();
  const lowerQ = q.toLowerCase().replace(/\s+/g,'');

  // 按匹配分数排序
  const scored = SEARCH_INDEX.map(item => {
    let score = 0;
    for (const key of item.keys) {
      const kl = key.toLowerCase().replace(/\s+/g,'');
      if (kl === lowerQ) { score += 100; }           // 完全匹配
      else if (kl.startsWith(lowerQ)) { score += 60; } // 前缀匹配
      else if (kl.includes(lowerQ) || lowerQ.includes(kl)) { score += 35; } // 包含
      else {
        // 逐字匹配
        let chars = 0;
        for (const ch of lowerQ) {
          if (kl.includes(ch)) chars++;
        }
        if (chars >= 2 && chars >= lowerQ.length * 0.5) score += chars * 8;
      }
    }
    return { ...item, score };
  }).filter(r => r.score > 0)
    .sort((a,b) => b.score - a.score)
    .slice(0, 6);

  // 去重(按label)
  const seen = new Set();
  const results = scored.filter(r => { const k = r.label; if(seen.has(k)) return false; seen.add(k); return true; });

  // 始终保留 AI 问答入口
  if (q.length >= 2) {
    results.push({ icon:'🤖', label:`AI 问答: "${q}"`, desc:'让 AI 助手回答此问题', target:'chat', query:q, score: 1 });
  }

  if (results.length === 0) {
    results.push({ icon:'🤖', label:`AI 问答: "${q}"`, desc:'试试让 AI 助手回答', target:'chat', query:q, score: 0 });
  }

  document.getElementById('searchResults').innerHTML = results.map((r,i) => {
    const onClick = `hideSearchResults();_doSearchAction('${r.target}','${(r.focus||'').replace(/'/g,"\\'")}','${(r.query||'').replace(/'/g,"\\'")}')`;
    return `<div class="sr-item" onclick="${onClick}">
      <span class="sr-icon">${r.icon}</span>
      <div><div>${r.label}</div><small style="color:var(--text-dim)">${r.desc}</small></div>
    </div>`;
  }).join('');
}

// 辅助: 执行搜索动作
function _doSearchAction(target, focus, query) {
  switchPage(target);
  if (focus) { setTimeout(() => { const el = document.getElementById(focus); if(el) { el.focus(); el.select(); } }, 300); }
  if (query) { document.getElementById('chatInput').value = query; askAI(); }
}

function runSearch() {
  const q = document.getElementById('globalSearch').value.trim();
  if (!q) return;
  hideSearchResults();
  // 智能识别参数格式: "水温15度体重200g" → 直接跳计算并填入
  const tm = q.match(/(\d+)\s*度/) || q.match(/水温\s*(\d+)/);
  const wm = q.match(/(\d+)\s*g/);
  if (tm && wm) { switchPage('calc'); document.getElementById('avgWeight').value=wm[1]; document.getElementById('waterTemp').value=tm[1]; autoCalc(); return; }
  // 默认: AI 问答
  switchPage('chat'); document.getElementById('chatInput').value=q; askAI();
}

// ============ 参数 ============
const LIMITS={
  avgWeight:{min:1,max:5000,label:'体重',unit:'g'},
  count:{min:1,max:999999,label:'数量',unit:'尾'},
  waterTemp:{min:2,max:22,label:'水温',unit:'℃',optimal:[12,18]},
  doLevel:{min:0,max:20,label:'溶氧',unit:'mg/L',warn:7,crit:4,dir:'low'},
  ph:{min:6,max:8,label:'pH',unit:'',optimal:[7,7.5]},
  ammonia:{min:0,max:2,label:'氨氮',unit:'mg/L',warn:0.2,crit:0.6,dir:'high'},
};

function validateParams() {
  let hasC=false,hasW=false;
  Object.keys(LIMITS).forEach(key=>{
    const el=document.getElementById(key); if(!el)return;
    const v=parseFloat(el.value); const l=LIMITS[key];
    const pc=document.getElementById('pc-'+({avgWeight:'weight',count:'count',waterTemp:'temp',doLevel:'do',ph:'ph',ammonia:'nh3'}[key]));
    if(pc){pc.style.borderColor='var(--border)';pc.style.boxShadow='none'}
    if(isNaN(v))return;
    // 超出绝对范围 → 危急
    if(v<l.min||v>l.max){hasC=true;if(pc){pc.style.borderColor='#e74c3c';pc.style.boxShadow='0 0 8px rgba(231,76,60,.3)';return;}}
    // 阈值检查 (dir='high'=高于阈值危险, dir='low'=低于阈值危险)
    if(l.crit!==undefined){
      const isCrit = l.dir==='high' ? v>=l.crit : v<=l.crit;
      if(isCrit){hasC=true;if(pc){pc.style.borderColor='#e74c3c';pc.style.boxShadow='0 0 8px rgba(231,76,60,.3)'}}
    }
    if(l.warn!==undefined && !hasC){
      const isWarn = l.dir==='high' ? v>=l.warn : v<=l.warn;
      if(isWarn){hasW=true;if(pc){pc.style.borderColor='#e67e22';pc.style.boxShadow='0 0 6px rgba(230,126,34,.2)'}}
    }
    // 正常
    if(!hasC&&!hasW&&pc){pc.style.borderColor='rgba(39,174,96,.5)';pc.style.boxShadow='0 0 4px rgba(39,174,96,.15)'}
  });
  document.getElementById('calcBtn').disabled = hasC;
  if(hasC)document.getElementById('liveWarnings').innerHTML='<div class="live-warn crit">🔴 参数异常, 请修正</div>';
  else if(hasW)document.getElementById('liveWarnings').innerHTML='<div class="live-warn warn">🟡 部分参数需关注</div>';
  else document.getElementById('liveWarnings').innerHTML='';
  return {hasCritical:hasC,hasWarning:hasW};
}

function showToast(msg,type){
  const t=document.createElement('div');t.className='toast '+type;t.textContent=msg;document.body.appendChild(t);
  setTimeout(()=>{t.style.opacity='0';t.style.transition='opacity .3s'},2500);setTimeout(()=>t.remove(),3000);
}

function autoFillDemo(){
  document.getElementById('avgWeight').value=200;document.getElementById('count').value=8000;
  document.getElementById('waterTemp').value=15;document.getElementById('doLevel').value=9.5;
  document.getElementById('ph').value=7.3;document.getElementById('ammonia').value=0.1;
  validateParams();calcFeeding();showToast('✅ 标准参数已填充','ok');
}

function focusInput(id){document.getElementById(id)?.focus()}
function cycleFishType(){
  const el=document.getElementById('fishType');const opts=['三文鱼(大西洋鲑)','虹鳟','其他鲑科'];
  const idx=opts.indexOf(el.value);el.value=opts[(idx+1)%opts.length];
  document.getElementById('fishLabel').textContent=el.value.includes('三文鱼')?'三文鱼':el.value.includes('虹鳟')?'虹鳟':'鲑科';
  autoCalc();
}

// ============ 修正因子 ============
function correctionFactors(){
  const T=parseFloat(document.getElementById('waterTemp').value)||14;
  const DO=parseFloat(document.getElementById('doLevel').value)||8.5;
  const pH=parseFloat(document.getElementById('ph').value)||7.2;
  const NH3=parseFloat(document.getElementById('ammonia').value)||0.15;
  const W=parseFloat(document.getElementById('avgWeight').value)||150;
  const factors=[];
  const sat=14.6-0.4*T,doMax=66/100*sat;
  if(T<12){const f=Math.max(0.4,0.6+(T-2)*0.04);factors.push({label:'水温偏低',value:T+'℃',impact:'×'+f.toFixed(2),detail:'最佳12-18℃',type:'warn'});}
  else if(T>18&&T<=20){const f=1-(T-18)*0.03;factors.push({label:'水温偏高',value:T+'℃',impact:'×'+f.toFixed(2),detail:'最佳12-18℃',type:'warn'});}
  else if(T>20){const f=1-0.035*(T-20);factors.push({label:'高温修正',value:T+'℃',impact:'×'+f.toFixed(2),detail:'>20℃每℃减3.5%',type:'crit'});}
  if(DO<9){const df=1/(1+Math.exp(-0.8*(DO-doMax*0.6)));if(df<0.95)factors.push({label:'溶氧不足',value:DO+'mg/L',impact:'×'+df.toFixed(2),detail:'DOmax≈'+doMax.toFixed(1)+'mg/L',type:df<0.5?'crit':'warn'});}
  let pf=1.0;if(pH<6.5&&pH>=6)pf=0.85;else if(pH<6&&pH>=5.5)pf=0.6;else if(pH<5.5)pf=0.3;else if(pH>8&&pH<=8.5)pf=0.85;else if(pH>8.5&&pH<=9)pf=0.5;else if(pH>9)pf=0.3;
  if(pf<1)factors.push({label:'pH偏离',value:pH+'',impact:'×'+pf.toFixed(2),detail:'中性7.0',type:pf<0.5?'crit':'warn'});
  let nf=1.0;if(NH3>0.2){nf=Math.max(0.5,1-(NH3-0.2)*0.8);factors.push({label:'氨氮超标',value:NH3+'mg/L',impact:'×'+nf.toFixed(2),detail:'安全限0.2mg/L',type:NH3>0.6?'crit':'warn'});}
  if(W>500)factors.push({label:'大鱼代谢',value:W+'g',impact:'引擎修正',detail:'代谢率低,投饲率自动下调',type:'info'});
  let total=1.0;factors.forEach(f=>{const m=f.impact.match(/×([\d.]+)/);if(m)total*=parseFloat(m[1]);});
  return {factors,total,pf,nf};
}

// ============ Auto Calc ============
let autoTimer=null;
function autoCalc(){validateParams();clearTimeout(autoTimer);autoTimer=setTimeout(()=>{if(!validateParams().hasCritical)calcFeeding(true);},350);}

function calcFeeding(){
  const resultEl = document.getElementById('feedingResult');
  // 显示加载中
  resultEl.innerHTML = '<div class="card" style="text-align:center;padding:40px 20px"><div style="font-size:32px">⏳</div><div style="color:var(--text-dim);margin-top:8px">计算中...</div></div>';

  try {
    const v=validateParams();
    if(v.hasCritical){
      resultEl.innerHTML = '<div class="card" style="text-align:center;padding:40px 20px"><div style="font-size:48px;opacity:0.4">⚠️</div><div style="color:var(--coral);margin-top:8px;font-size:14px">参数异常，请修正红色标记的参数后再计算</div><div style="color:var(--text-dim);font-size:11px;margin-top:4px">水温需在 2-22℃、溶氧 0-20mg/L、pH 6-8、氨氮 0-2mg/L 范围内</div></div>';
      showToast('❌ 参数异常，请修正','error');
      return;
    }

    const avgWeight=parseFloat(document.getElementById('avgWeight').value);
    const count=parseInt(document.getElementById('count').value);
    const waterTemp=parseFloat(document.getElementById('waterTemp').value);
    const doLevel=parseFloat(document.getElementById('doLevel').value);
    const ph=parseFloat(document.getElementById('ph').value);
    const ammonia=parseFloat(document.getElementById('ammonia').value);
    const fishType=document.getElementById('fishType').value;

    const result=FeedingEngine.calculate({avgWeight,count,waterTemp,doLevel,fishType});
    const corr=correctionFactors();
    const wq=FeedingEngine.assessWaterQuality(waterTemp,doLevel,ph,ammonia);

    result.dailyFeed=Math.round(result.dailyFeed*corr.total*1000)/1000;
    result.feedPerMeal=Math.round(result.dailyFeed/result.mealsPerDay*1000)/1000;
    result.feedingRate=Math.round(result.feedingRate*corr.total*1000)/1000;
    // 修正周预测
    result.weekly.totalFeed=Math.round(result.weekly.totalFeed*corr.total*100)/100;
    result.weekly.projectedBiomass=Math.round((result.weekly.currentBiomass + result.weekly.avgGrowth*count/1000)*10)/10;
    Object.keys(result.methods).forEach(k=>{
      result.methods[k].rate=Math.round(result.methods[k].rate*corr.total*1000)/1000;
      result.methods[k].daily=Math.round(result.methods[k].daily*corr.total*1000)/1000;
    });

    // ===== 综合评分 =====
    const scores = { temp: 5, doxy: 5, ph: 5, ammonia: 5, weight: 5 };
    if (waterTemp >= 12 && waterTemp <= 18) scores.temp = 5;
    else if (waterTemp >= 8 && waterTemp <= 20) scores.temp = 3;
    else scores.temp = 1;
    if (doLevel >= 9) scores.doxy = 5;
    else if (doLevel >= 7) scores.doxy = 4;
    else if (doLevel >= 5) scores.doxy = 2;
    else scores.doxy = 1;
    if (ph >= 7.0 && ph <= 7.5) scores.ph = 5;
    else if (ph >= 6.5 && ph <= 8.0) scores.ph = 4;
    else if (ph >= 6.0 && ph <= 8.5) scores.ph = 2;
    else scores.ph = 1;
    if (ammonia <= 0.1) scores.ammonia = 5;
    else if (ammonia <= 0.2) scores.ammonia = 4;
    else if (ammonia <= 0.6) scores.ammonia = 2;
    else scores.ammonia = 1;
    if (avgWeight >= 50 && avgWeight <= 500) scores.weight = 5;
    else if (avgWeight < 50) scores.weight = 4;
    else scores.weight = 4;
    const overallScore = Math.round((scores.temp + scores.doxy + scores.ph + scores.ammonia + scores.weight) / 5);
    const scoreLabels = ['', '🔴 差', '🟠 较差', '🟡 一般', '🟢 良好', '⭐ 优秀'];
    const scoreColors = ['', '#e74c3c', '#e67e22', '#f0c040', '#27ae60', '#4a9eff'];

    // ===== 生长阶段分类 =====
    let growthStage, stageIcon, stageDesc;
    if (avgWeight < 10) { growthStage = '稚鱼期'; stageIcon = '🐟'; stageDesc = '开口摄食阶段，需高蛋白饲料(>50%)，每日投喂6-8次'; }
    else if (avgWeight < 50) { growthStage = '幼鱼期'; stageIcon = '🐟'; stageDesc = '快速生长期，饲料蛋白45-50%，粒径1.5-2.5mm'; }
    else if (avgWeight < 200) { growthStage = '生长期'; stageIcon = '🐡'; stageDesc = '主要增重阶段，饲料蛋白42-45%，粒径3-5mm'; }
    else if (avgWeight < 1000) { growthStage = '成鱼期'; stageIcon = '🐠'; stageDesc = '稳步增重，饲料蛋白38-42%，粒径5-8mm'; }
    else { growthStage = '上市期'; stageIcon = '🐋'; stageDesc = '接近上市规格，控制脂肪沉积，饲料蛋白35-38%'; }

    let h='<div class="card"><h3>🎯 推荐投喂方案</h3>';

    // ---- 综合评分条 ----
    h+=`<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:8px 14px;background:rgba(0,0,0,.2);border-radius:8px">`;
    h+=`<span style="font-size:12px;color:var(--text-dim)">综合评分</span>`;
    h+=`<span style="font-size:18px;font-weight:700;color:${scoreColors[overallScore]}">${scoreLabels[overallScore]}</span>`;
    h+=`<span style="font-size:12px;color:var(--text-dim)">${growthStage}</span>`;
    h+=`<div style="flex:1;height:6px;background:rgba(255,255,255,.1);border-radius:3px;overflow:hidden">`;
    h+=`<div style="width:${overallScore*20}%;height:100%;background:${scoreColors[overallScore]};border-radius:3px;transition:width .5s"></div></div>`;
    h+=`<span style="font-size:11px;color:var(--text-dim)">${overallScore}/5</span>`;
    h+=`</div>`;

    // 主结果
    h+=`<div class="result-box">`;
    h+=`<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">`;
    h+=`<span class="val">${result.dailyFeed.toFixed(2)}</span><span class="unit">kg/天</span>`;
    h+=`<span style="color:var(--text-dim)">│</span>`;
    h+=`<span style="font-size:20px;font-weight:700;color:var(--accent)">${result.feedingRate.toFixed(3)}%</span><span style="font-size:12px;color:var(--text-dim)">投饲率</span>`;
    h+=`<span style="color:var(--text-dim)">│</span>`;
    h+=`<b style="font-size:16px">${result.mealsPerDay}次/天</b><span style="font-size:11px;color:var(--text-dim)">分餐</span>`;
    h+=`</div>`;
    h+=`<div style="margin-top:8px;font-size:12px;color:var(--text-dim)">`;
    h+=`📍 四法综合推荐 (范围: ${result.feedingRateRange}%)`;
    h+=` &nbsp;|&nbsp; 📏 总修正系数: ×${corr.total.toFixed(3)}`;
    h+=` &nbsp;|&nbsp; 🐟 当前总生物量: ${result.weekly.currentBiomass}kg | ${stageIcon} ${growthStage}`;
    h+=`</div>`;

    // 餐次安排
    h+=`<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">`;
    const mealLabels = result.mealsPerDay===3 ? ['🌅 早','☀️ 午','🌇 晚'] : ['🌅 上午','🌇 下午'];
    result.mealTimes.forEach((t,i)=>{
      h+=`<div style="background:rgba(74,158,255,.12);border-radius:8px;padding:6px 12px;text-align:center;font-size:11px">`;
      h+=`<div style="color:var(--accent);font-weight:600">${mealLabels[i]}</div>`;
      h+=`<div style="color:var(--foam);font-size:13px;font-weight:700">${result.feedPerMeal.toFixed(2)}kg</div>`;
      h+=`<div style="color:var(--text-dim)">${t}</div></div>`;
    });
    h+=`</div></div>`; // result-box

    // 环境修正
    if(corr.factors.length>0){
      h+='<div style="margin-top:10px;padding:10px 14px;background:rgba(15,40,71,.5);border:1px solid var(--border);border-radius:10px;font-size:11px"><b>🌍 环境修正因子:</b>';
      corr.factors.forEach(f=>h+=`<div style="margin:2px 0">${f.type==='crit'?'🔴':f.type==='warn'?'🟡':'🔵'} ${f.label}: <code>${f.impact}</code> — ${f.detail}</div>`);
      h+='</div>';
    }

    // 周预测
    const w=result.weekly;
    h+=`<div style="margin-top:10px;padding:14px;background:linear-gradient(135deg,rgba(39,174,96,.1),rgba(74,158,255,.08));border:1px solid rgba(39,174,96,.2);border-radius:10px">`;
    h+=`<b style="font-size:13px">📅 7天预测</b>`;
    h+=`<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px;text-align:center">`;
    h+=`<div><div style="font-size:20px;font-weight:800;color:var(--accent)">${w.totalFeed.toFixed(1)}</div><div style="font-size:10px;color:var(--text-dim)">周投喂总量 kg</div></div>`;
    h+=`<div><div style="font-size:20px;font-weight:800;color:var(--kelp)">+${w.avgGrowth}g</div><div style="font-size:10px;color:var(--text-dim)">单尾预计增重</div></div>`;
    h+=`<div><div style="font-size:20px;font-weight:800;color:var(--gold)">${w.projectedBiomass}kg</div><div style="font-size:10px;color:var(--text-dim)">7天后预计生物量</div></div>`;
    h+=`</div></div>`;

    // 四法对比
    h+='<div style="margin-top:10px;display:grid;grid-template-columns:repeat(4,1fr);gap:6px">';
    ['table','science','growth','azevedo2025'].forEach(k=>{
      const m=result.methods[k];
      h+=`<div class="card" style="padding:10px;text-align:center"><div style="font-size:10px;font-weight:700;color:var(--text-dim)">${m.label}</div><div style="font-size:18px;font-weight:800;color:var(--accent)">${(m.rate||0).toFixed(3)}%</div><div style="font-size:10px;color:var(--text-dim)">${(m.daily||0).toFixed(2)}kg/天</div></div>`;
    });
    h+='</div>';

    // 推导过程
    h+=`<details style="margin-top:8px"><summary style="font-size:12px;color:var(--accent);cursor:pointer">📐 查看推导过程 (4法)</summary><div style="margin-top:6px;font-size:11px">`;
    ['table','science','growth','azevedo2025'].forEach(k=>{
      const m=result.methods[k];
      h+=`<div style="margin-bottom:8px;padding:8px;background:rgba(0,0,0,.15);border-radius:6px"><b>${m.label}</b> — ${m.source}`;
      m.steps.forEach(s=>h+=`<div class="step-list"><div><b>${s.step}. ${s.title}</b>: ${s.result}<br><span class="src">📖 ${s.source}</span></div></div>`);
      h+='</div>';
    });
    h+='</div></details>';

    // 警告
    if (result.warnings.length > 0) {
      h+=`<div style="margin-top:8px">`;
      result.warnings.forEach(w=>h+=`<div class="warning ${w.startsWith('🚨')?'critical':''}" style="font-size:11px">${w}</div>`);
      h+=`</div>`;
    }
    if(wq.issues.length>0)h+=`<div class="warning" style="font-size:11px">🌊 水质评估: ${wq.issues.join(',')}</div>`;

    // =================================================================
    // 🌟 综合养殖建议 (多维度综合分析)
    // =================================================================
    h+=`<div style="margin-top:12px"><h3 style="margin-bottom:10px">💡 综合养殖建议</h3></div>`;

    // --- 建议卡片1: 水温与投喂策略 ---
    let tempAdvice, tempDetail;
    if (waterTemp < 8) {
      tempAdvice = '🌡️ 低温停食风险';
      tempDetail = `当前水温 <b>${waterTemp}℃</b> 处于低温区间。代谢率大幅降低，消化酶活性不足。<br>
        📌 <b>操作建议:</b> 每日投喂<b>1-2次</b>，集中在中午12:00-14:00水温最高时段；减少单次投喂量20-30%；观察鱼群是否有抢食行为判断食欲。<br>
        📌 <b>饲料选择:</b> 使用高消化率饲料，可添加诱食剂(鱼溶浆/磷虾粉)。<br>
        📌 <b>预期:</b> SGR约0.3-0.5%/天，增重缓慢属正常现象。`;
    } else if (waterTemp <= 12) {
      tempAdvice = '🌡️ 水温偏低 — 逐步恢复';
      tempDetail = `当前水温 <b>${waterTemp}℃</b>，处于适温下限。摄食逐渐活跃但尚未达峰值。<br>
        📌 <b>操作建议:</b> 每日投喂<b>2-3次</b>，每3-5天逐步增加投喂量5-10%；密切监测残饵情况调整。<br>
        📌 <b>SGR预期:</b> 约0.8-1.2%/天。`;
    } else if (waterTemp <= 18) {
      tempAdvice = '✅ 水温处于最适区间';
      tempDetail = `当前水温 <b>${waterTemp}℃</b> 在最佳生长温度范围内。摄食旺盛、饲料转化效率最高。<br>
        📌 <b>操作建议:</b> 维持标准投喂策略，每日<b>3次</b>，按计算结果定量投喂。每周称重校准投饲率。<br>
        📌 <b>注意:</b> 这是增重黄金期，保证溶氧充足可最大化生长速度。`;
    } else if (waterTemp <= 20) {
      tempAdvice = '⚠️ 水温偏高 — 适度减量';
      tempDetail = `当前水温 <b>${waterTemp}℃</b> 已偏离最优区间。鱼体产生轻度热应激，食欲基因受抑制(Lai et al.,2025)。<br>
        📌 <b>操作建议:</b> 投喂量减少<b>10-20%</b>，保持3次/天但每次量减少；加强增氧(建议纳米曝气+纯氧补充)；避开午后高温时段投喂。<br>
        📌 <b>监测重点:</b> 每日测溶解氧(早晨最低点)，观察鱼群是否浮头。`;
    } else {
      tempAdvice = '🔴 高温应激 — 紧急减量';
      tempDetail = `当前水温 <b>${waterTemp}℃</b> 已进入高温危险区！超过20℃溶氧饱和度急剧下降，鱼体代谢紊乱。<br>
        📌 <b>紧急措施:</b> 投喂量减少<b>30-50%</b>，改为1-2次/天，仅在清晨水温最低时投喂；24小时全负荷增氧；增加换水量(>30%/天)。<br>
        📌 <b>风险预警:</b> 持续高温(>22℃)可导致停食、免疫力下降、继发细菌性疾病。`;
    }

    // --- 建议卡片2: 溶氧管理 ---
    let doAdvice, doDetail;
    const satMgL = (14.6 - 0.4 * waterTemp).toFixed(1);
    if (doLevel >= 9) {
      doAdvice = '✅ 溶氧充足 — 摄食不受限';
      doDetail = `当前溶氧 <b>${doLevel}mg/L</b>，饱和度约${Math.round(doLevel/(14.6-0.4*waterTemp)*100)}%，高于DOmaxFI阈值(66%≈${(14.6-0.4*waterTemp)*0.66.toFixed(1)}mg/L)。摄食效率最大化。<br>
        📌 维持现有增氧策略，定期检查曝气设备运行状态。`;
    } else if (doLevel >= 7) {
      doAdvice = '⚠️ 溶氧偏低 — 摄食轻度受限';
      doDetail = `当前溶氧 <b>${doLevel}mg/L</b>，低于最佳值(≥9mg/L)。根据Sigmoid模型，摄食效率约降至${Math.round(1/(1+Math.exp(-0.8*(doLevel-(14.6-0.4*waterTemp)*0.66*0.6)))*100)}%。<br>
        📌 <b>改善措施:</b> 增加曝气量、检查纳米曝气管是否堵塞、适当增加换水量。<br>
        📌 <b>监测:</b> 凌晨4-6点溶氧最低，建议安装在线监测探头自动报警。`;
    } else if (doLevel >= 5) {
      doAdvice = '🔶 溶氧不足 — 显著影响摄食';
      doDetail = `当前溶氧 <b>${doLevel}mg/L</b>，已显著低于正常值。计算模型已自动下调投喂量。<br>
        📌 <b>紧急措施:</b> ①立即全开增氧设备 ②增加纯氧补充(至≥9mg/L) ③减少投喂或暂停 ④检查生物滤池是否耗氧过高。<br>
        📌 <b>风险:</b> 持续低氧→饲料转化率大幅下降→氨氮积累→水质恶化恶性循环。`;
    } else {
      doAdvice = '🚨 溶氧危急 — 建议立即停食';
      doDetail = `当前溶氧 <b>${doLevel}mg/L</b> 已低于安全阈值(5mg/L)！鱼类面临严重缺氧风险。<br>
        📌 <b>立即执行:</b> ①停食！②全负荷增氧+纯氧 ③大换水50%+ ④检查死鱼及时捞出 ⑤降低养殖密度。<br>
        📌 <b>恢复:</b> 待溶氧恢复到>7mg/L后，从正常量的50%开始逐步恢复投喂。`;
    }

    // --- 建议卡片3: 水质综合 ---
    let waterAdvice = '', waterDetail = '';
    if (ammonia > 0.6 || ph < 5.5 || ph > 9) {
      waterAdvice = '🚨 水质危急 — 立即处理';
      waterDetail = '';
      if (ammonia > 0.6) waterDetail += `🔴 氨氮 <b>${ammonia}mg/L</b> 严重超标(安全限0.2mg/L)。NH₃对鳃组织有强烈毒性。<br>📌 <b>措施:</b> 停食2-3天 + 每日换水50% + 添加沸石粉(1kg/m³) + 检查生物滤池硝化功能。<br>`;
      if (ph < 5.5) waterDetail += `🔴 pH <b>${ph}</b> 过低，硝化菌受抑制，氨氮将加速积累。<br>📌 <b>措施:</b> 投加碳酸氢钠(NaHCO₃)50-100g/m³，逐步调节至7.0+。<br>`;
      if (ph > 9) waterDetail += `🔴 pH <b>${ph}</b> 过高，游离氨(NH₃)占比急剧上升(>50%)，毒性剧增。<br>📌 <b>措施:</b> 减少曝气(降低CO₂吹脱) + 添加氯化钙或稀盐酸缓慢中和。<br>`;
    } else if (ammonia > 0.2 || ph < 6 || ph > 8.5) {
      waterAdvice = '⚠️ 水质预警 — 密切关注';
      waterDetail = '';
      if (ammonia > 0.2) waterDetail += `🟡 氨氮 <b>${ammonia}mg/L</b> 偏高。减少投喂15%，增加换水频率，检查滤池。<br>`;
      if (ph < 6) waterDetail += `🟡 pH <b>${ph}</b> 偏低。补充碳酸氢钠，每日检测pH变化趋势。<br>`;
      if (ph > 8.5) waterDetail += `🟡 pH <b>${ph}</b> 偏高。减少曝气强度，监测游离氨占比。<br>`;
    } else {
      waterAdvice = '✅ 水质正常';
      waterDetail = `氨氮 <b>${ammonia}mg/L</b> (安全)，pH <b>${ph}</b> (正常范围)。维持现有换水频率和生物滤池管理。<br>
        📌 <b>日常管理:</b> 每日早晚各测一次溶氧和温度；每周测氨氮+亚硝酸盐+pH；每月清洗一次生物滤池(分批，避免硝化菌流失)。`;
    }

    // --- 建议卡片4: 生长阶段策略 ---
    const stageAdvice = {
      '稚鱼期': `📌 <b>稚鱼期管理要点:</b><br>• 开口饲料粒径0.3-0.8mm，逐步过渡到1.0mm<br>• 投喂频率6-8次/天，少量多次避免残饵<br>• 水温严格控制在12-16℃，波动<±1℃/天<br>• 光照强度500-1000lux，避免直射光<br>• 每周抽样30尾称重，计算均匀度(CV<15%为优)`,
      '幼鱼期': `📌 <b>幼鱼期管理要点:</b><br>• 饲料蛋白≥45%，脂肪≥15%，添加免疫增强剂(β-葡聚糖)<br>• 投喂4-6次/天，根据残饵情况动态调整<br>• 每月分筛1-2次，将大小鱼分池饲养<br>• 疫苗接种窗口(20-50g)，建议注射IPN+IHN疫苗`,
      '生长期': `📌 <b>生长期管理要点:</b><br>• 当前是饲料转化效率最高的阶段，应重点优化FCR<br>• 每2周抽样称重，依据实际增重校准投饲率<br>• 饲料中脂肪可提升至22-28%，蛋白质42-45%<br>• 密度管理: RAS系统≤50kg/m³，网箱≤25kg/m³`,
      '成鱼期': `📌 <b>成鱼期管理要点:</b><br>• 控制脂肪沉积，适当提高蛋白/能量比<br>• 收获前3-4周逐步减少投喂(清肠)，改善肉质<br>• 每月抽样测量体长/体重，计算肥满度(K=W/L³×100)<br>• 目标FCR: 网箱1.0-1.1，RAS 1.1-1.2`,
      '上市期': `📌 <b>上市期管理要点:</b><br>• 接近上市规格(通常4-6kg)，投喂策略转向维持+品质优化<br>• 添加虾青素(40-60mg/kg饲料)改善肉色<br>• 收获前禁食3-7天(视水温而定)，清空肠道内容物<br>• 安排出鱼计划，分批捕捞避免应激`
    };

    // --- 建议卡片5: 经济概算 ---
    const feedCostPerKg = 8.5; // 人民币/kg饲料(鲑鳟鱼商品料均价)
    const salmonPricePerKg = 60; // 人民币/kg活鱼(2024年行情)
    const dailyFeedCost = result.dailyFeed * feedCostPerKg;
    const weeklyFeedCost = w.totalFeed * feedCostPerKg;
    const weeklyGainKg = w.avgGrowth * count / 1000;
    const weeklyRevenue = weeklyGainKg * salmonPricePerKg;
    const feedEfficiency = weeklyGainKg > 0 ? (weeklyRevenue / weeklyFeedCost).toFixed(1) : '—';

    h+=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">`;

    // 水温建议卡片
    h+=`<div style="padding:12px;background:rgba(15,40,71,.5);border:1px solid var(--border);border-radius:10px;font-size:11px;line-height:1.7">`;
    h+=`<b style="font-size:13px;color:var(--accent)">${tempAdvice}</b><br>${tempDetail}</div>`;

    // 溶氧建议卡片
    h+=`<div style="padding:12px;background:rgba(15,40,71,.5);border:1px solid var(--border);border-radius:10px;font-size:11px;line-height:1.7">`;
    h+=`<b style="font-size:13px;color:var(--accent)">${doAdvice}</b><br>${doDetail}</div>`;

    // 水质建议卡片
    h+=`<div style="padding:12px;background:rgba(15,40,71,.5);border:1px solid var(--border);border-radius:10px;font-size:11px;line-height:1.7">`;
    h+=`<b style="font-size:13px;color:var(--accent)">🧪 ${waterAdvice}</b><br>${waterDetail}</div>`;

    // 生长阶段卡片
    h+=`<div style="padding:12px;background:rgba(15,40,71,.5);border:1px solid var(--border);border-radius:10px;font-size:11px;line-height:1.7">`;
    h+=`<b style="font-size:13px;color:var(--accent)">${stageIcon} ${growthStage} — 阶段管理策略</b><br>${stageAdvice[growthStage]||stageDesc}</div>`;

    h+=`</div>`; // grid

    // --- 经济概算卡片 ---
    h+=`<div style="margin-top:8px;padding:12px;background:linear-gradient(135deg,rgba(240,192,64,.1),rgba(240,192,64,.03));border:1px solid rgba(240,192,64,.2);border-radius:10px;font-size:11px">`;
    h+=`<b style="font-size:13px;color:var(--gold)">💰 经济概算</b>`;
    h+=`<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:6px;text-align:center">`;
    h+=`<div><div style="font-size:14px;font-weight:700;color:var(--foam)">¥${dailyFeedCost.toFixed(0)}</div><div style="font-size:9px;color:var(--text-dim)">日饲料成本</div></div>`;
    h+=`<div><div style="font-size:14px;font-weight:700;color:var(--foam)">¥${weeklyFeedCost.toFixed(0)}</div><div style="font-size:9px;color:var(--text-dim)">周饲料成本</div></div>`;
    h+=`<div><div style="font-size:14px;font-weight:700;color:var(--kelp)">¥${weeklyRevenue.toFixed(0)}</div><div style="font-size:9px;color:var(--text-dim)">周增重价值</div></div>`;
    h+=`<div><div style="font-size:14px;font-weight:700;color:var(--gold)">${feedEfficiency}</div><div style="font-size:9px;color:var(--text-dim)">投入产出比</div></div>`;
    h+=`</div>`;
    h+=`<div style="margin-top:6px;font-size:10px;color:var(--text-dim)">📌 按饲料 ¥${feedCostPerKg}/kg、活鱼 ¥${salmonPricePerKg}/kg 估算 · 不含人工/水电/折旧</div>`;
    h+=`</div>`;

    // --- FCR 分析与优化 ---
    const estFCR = result.weekly.totalFeed / (w.avgGrowth * count / 1000);
    const fcrRating = estFCR < 1.1 ? '优秀' : estFCR < 1.3 ? '良好' : estFCR < 1.5 ? '一般' : '偏高';
    const fcrColor = estFCR < 1.1 ? 'var(--kelp)' : estFCR < 1.3 ? 'var(--accent)' : estFCR < 1.5 ? 'var(--gold)' : 'var(--coral)';
    h+=`<div style="margin-top:8px;padding:12px;background:rgba(15,40,71,.5);border:1px solid var(--border);border-radius:10px;font-size:11px;line-height:1.7">`;
    h+=`<b style="font-size:13px;color:var(--accent)">📊 FCR 饲料转化率分析</b><br>`;
    h+=`预计FCR: <b style="color:${fcrColor}">${estFCR.toFixed(2)}</b> (${fcrRating}) `;
    if (estFCR > 1.5) {
      h+=`— FCR偏高，建议检查:<br>• 是否过度投喂(残饵多)→减少单次量5-10%观察<br>• 溶氧是否不足→低于7mg/L会显著降低转化效率<br>• 饲料品质是否合格→检查蛋白质/脂肪含量及新鲜度<br>• 鱼体是否健康→检查是否有亚临床疾病`;
    } else if (estFCR > 1.3) {
      h+=`— 有优化空间:<br>• 精确控制投喂量(避免过投)，使用自动投喂机可提升FCR 5-10%<br>• 保持溶氧≥9mg/L，FCR可进一步降低0.05-0.1`;
    } else {
      h+=`— 饲料转化效率理想，继续保持当前管理策略。<br>• 行业参考: RAS系统FCR 1.15 | 网箱FCR 1.00 | 流水池FCR 1.05`;
    }
    h+=`</div>`;

    // --- 风险提示 ---
    const risks = [];
    if (waterTemp > 20) risks.push('🔴 高温: 持续>22℃将导致停食和死亡率上升');
    if (doLevel < 5) risks.push('🔴 缺氧: <5mg/L可导致急性死亡');
    if (ammonia > 0.4) risks.push('🟡 氨氮: >0.4mg/L有慢性毒性风险');
    if (ph < 6 || ph > 8.5) risks.push('🟡 pH异常: 影响鳃功能和硝化系统');
    if (avgWeight > 3000 && waterTemp > 18) risks.push('🟡 大规格+高温: 双重应激，极易爆发疾病');
    if (risks.length > 0) {
      h+=`<div style="margin-top:8px;padding:10px 14px;background:rgba(231,76,60,.08);border:1px solid rgba(231,76,60,.2);border-radius:10px;font-size:11px">`;
      h+=`<b>⚠️ 风险提示</b><br>`;
      risks.forEach(r => h+=`<div style="margin:2px 0">${r}</div>`);
      h+=`</div>`;
    }

    // 保存按钮
    h+=`<div style="margin-top:10px;display:flex;gap:8px">`;
    h+=`<button class="btn-primary" onclick="saveFeedingPlan()" style="flex:1;padding:12px;font-size:13px">💾 保存此投喂计划</button>`;
    h+=`<button class="btn-outline" onclick="switchPage('records')" style="padding:12px 24px">📋 查看投喂记录</button>`;
    h+=`</div>`;

    h+='</div>'; // card
    resultEl.innerHTML = h;
    const msg = corr.factors.length === 0 ? '✅ 四法计算完成' : `⚙️ 已应用${corr.factors.length}项环境修正`;
    showToast(msg, corr.factors.length === 0 ? 'ok' : 'warn');

  } catch (err) {
    console.error('calcFeeding error:', err);
    resultEl.innerHTML = `<div class="card" style="text-align:center;padding:40px 20px">
      <div style="font-size:48px;opacity:0.4">😵</div>
      <div style="color:var(--coral);margin-top:8px;font-size:14px">计算出错，请刷新页面后重试</div>
      <div style="color:var(--text-dim);font-size:10px;margin-top:4px;max-width:300px;margin-left:auto;margin-right:auto;word-break:break-all">${err.message}</div>
      <button class="btn-outline" onclick="calcFeeding()" style="margin-top:12px;padding:8px 20px">🔄 重试</button>
    </div>`;
    showToast('❌ 计算出错','error');
  }
}

// ============ 保存投喂计划 ============
function saveFeedingPlan(){
  const avgWeight=parseFloat(document.getElementById('avgWeight').value)||150;
  const count=parseInt(document.getElementById('count').value)||5000;
  const waterTemp=parseFloat(document.getElementById('waterTemp').value)||14;
  const doLevel=parseFloat(document.getElementById('doLevel').value)||8.5;
  const result=FeedingEngine.calculate({avgWeight,count,waterTemp,doLevel,fishType:document.getElementById('fishType').value});
  const corr=correctionFactors();
  const plan={
    date:new Date().toISOString(),
    params:{avgWeight,count,waterTemp,doLevel,fishType:document.getElementById('fishType').value},
    result:{
      dailyFeed:Math.round(result.dailyFeed*corr.total*1000)/1000,
      feedingRate:result.feedingRate,
      mealsPerDay:result.mealsPerDay,
      feedPerMeal:result.feedPerMeal,
      weekly:result.weekly,
    },
  };
  const plans=JSON.parse(localStorage.getItem('salmon_plans')||'[]');
  plans.unshift(plan);
  localStorage.setItem('salmon_plans',JSON.stringify(plans.slice(0,20)));
  showToast('✅ 投喂计划已保存 ('+plans.length+'条)','ok');
}

// ============ 记录 ============
let recSortKey='date', recSortAsc=false, recFiltered=[], recHighlight='';

// 首页跳转 + 高亮
function highlightAndGo(date){
  recHighlight=date;
  switchPage('records');
  // 清除之前的搜索筛选
  document.getElementById('recSearch').value='';
  document.getElementById('recFilterDays').value='0';
  setTimeout(()=>{ renderRecords(); recHighlight=''; }, 100);
}

function openAddModal(){
  document.getElementById('recModalTitle').textContent='✚ 添加投喂记录';
  document.getElementById('recEditIdx').value='-1';
  document.getElementById('recDate').value=new Date().toISOString().split('T')[0];
  document.getElementById('recFeed').value='';
  document.getElementById('recRate').value='90';
  document.getElementById('recWeight').value='150';
  document.getElementById('recTemp').value='14';
  document.getElementById('recDO').value='8.5';
  document.getElementById('recModal').style.display='flex';
}
function openEditModal(i){
  const r=recFiltered[i]; if(!r)return;
  document.getElementById('recModalTitle').textContent='✏️ 编辑记录';
  document.getElementById('recEditIdx').value=records.indexOf(r);
  document.getElementById('recDate').value=r.date;
  document.getElementById('recFeed').value=r.feed;
  document.getElementById('recRate').value=r.rate||90;
  document.getElementById('recWeight').value=r.weight||150;
  document.getElementById('recTemp').value=r.temp||14;
  document.getElementById('recDO').value=r.doLevel||8.5;
  document.getElementById('recModal').style.display='flex';
}
function closeModal(){ document.getElementById('recModal').style.display='none'; }

async function saveRecord(){
  const feed=parseFloat(document.getElementById('recFeed').value);
  if(!feed||feed<=0){ showToast('请输入投喂量','error'); return; }
  const entry={
    date: document.getElementById('recDate').value||new Date().toISOString().split('T')[0],
    feed: Math.round(feed*10)/10,
    rate: parseInt(document.getElementById('recRate').value)||90,
    weight: Math.round(parseFloat(document.getElementById('recWeight').value)||150),
    temp: Math.round((parseFloat(document.getElementById('recTemp').value)||14)*10)/10,
    doLevel: Math.round((parseFloat(document.getElementById('recDO').value)||8.5)*10)/10,
  };
  const editIdx=parseInt(document.getElementById('recEditIdx').value);

  // 通过 API 保存
  try {
    const resp=await fetch('/api/records',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(toAPI(entry))
    });
    if(!resp.ok) throw new Error('API '+resp.status);
    const saved=fromAPI(await resp.json());
    if(editIdx>=0){ records[editIdx]=saved; }
    else { records.unshift(saved); }
  }catch(e){
    console.warn('API 保存失败，使用本地存储:',e.message);
    if(editIdx>=0){ records[editIdx]=entry; }
    else { records.unshift(entry); }
  }

  saveRecordsLocal(); renderRecords(); closeModal(); updateBadges();
  showToast(editIdx>=0?'✅ 已更新':'✅ 已保存','ok');
}

async function delRecord(i){
  const realIdx=records.indexOf(recFiltered[i]);
  if(realIdx<0) return;
  const rec=records[realIdx];

  // 通过 API 删除
  if(rec.id){
    try {
      const resp=await fetch('/api/records/'+rec.id,{method:'DELETE'});
      if(!resp.ok) throw new Error('API '+resp.status);
    }catch(e){ console.warn('API 删除失败:',e.message); }
  }

  records.splice(realIdx,1);
  saveRecordsLocal(); renderRecords(); updateBadges();
}

function sortRecords(key){
  if(recSortKey===key) recSortAsc=!recSortAsc; else { recSortKey=key; recSortAsc=false; }
  renderRecords();
}

function updateBadges(){
  document.getElementById('recordsBadge').textContent=records.length;
  document.getElementById('homeRecCount').textContent=records.length+'条记录';
}

function renderRecords(){
  // 筛选
  const days=parseInt(document.getElementById('recFilterDays').value)||0;
  const search=(document.getElementById('recSearch').value||'').toLowerCase();
  const cutoff=days>0?new Date(Date.now()-days*86400000).toISOString().split('T')[0]:null;

  recFiltered=sortedNewFirst().filter(r=>{
    if(cutoff && r.date<cutoff) return false;
    if(search){
      const str=`${r.date} ${r.feed} ${r.rate} ${r.weight} ${r.temp} ${r.doLevel}`.toLowerCase();
      if(!str.includes(search)) return false;
    }
    return true;
  });

  // 排序 (数值用数值比较，字符串用字典比较)
  recFiltered.sort((a,b)=>{
    let va=a[recSortKey], vb=b[recSortKey];
    if(typeof va==='number' && typeof vb==='number'){
      return recSortAsc ? va-vb : vb-va;
    }
    if(va==null) va=''; if(vb==null) vb='';
    va=String(va).toLowerCase(); vb=String(vb).toLowerCase();
    if(recSortAsc) return va>vb ? 1 : va<vb ? -1 : 0;
    return vb>va ? 1 : vb<va ? -1 : 0;
  });

  // 统计 — 始终基于时间序列 (不受排序影响)
  const chrono=sorted();
  const tf=recFiltered.reduce((s,r)=>s+(r.feed||0),0);
  const ar=recFiltered.length>0?Math.round(recFiltered.reduce((s,r)=>s+(r.rate||0),0)/recFiltered.length):0;
  const initialW=chrono.length>0?chrono[0].weight:0;
  const finalW=chrono.length>0?chrono[chrono.length-1].weight:0;
  const wg=finalW-initialW;
  const daysCount=chrono.length>1?Math.max(1,Math.ceil((new Date(chrono[chrono.length-1].date)-new Date(chrono[0].date))/86400000)+1):chrono.length;
  const s=JSON.parse(localStorage.getItem('salmon_settings')||'{}');
  const count=s.count||5000;
  const totalGainKg=wg*count/1000;
  const fcr=FeedingEngine.calcFCR(tf,totalGainKg);
  document.getElementById('rsFeed').textContent=tf.toFixed(1);
  document.getElementById('rsDaily').textContent=daysCount>0?(tf/daysCount).toFixed(1):'0';
  document.getElementById('rsRate').textContent=ar;
  document.getElementById('rsFCR').textContent=fcr;
  document.getElementById('rsGrowth').textContent=wg;
  document.getElementById('recCount').textContent=recFiltered.length+'条';
  // 表格
  const tbody=document.querySelector('#recordTable tbody');
  const emptyEl=document.getElementById('recEmpty');
  if(tbody){
    if(recFiltered.length===0){
      tbody.innerHTML='';
      if(emptyEl) emptyEl.style.display='block';
    } else {
      if(emptyEl) emptyEl.style.display='none';
      tbody.innerHTML=recFiltered.map((r,i)=>`<tr class="${recHighlight&&r.date===recHighlight?'row-highlight':''}">
        <td>${r.date}</td>
        <td><b>${r.feed} kg</b></td>
        <td>${r.rate||0}%</td>
        <td>${r.weight||0} g</td>
        <td>${(r.temp||0).toFixed(1)} ℃</td>
        <td>${(r.doLevel||0).toFixed(1)} mg/L</td>
        <td class="rec-actions">
          <button class="btn-outline btn-xs" onclick="openEditModal(${i})">✏️</button>
          <button class="btn-danger btn-xs" onclick="delRecord(${i})">🗑</button>
        </td>
      </tr>`).join('');
      // 滚动到高亮行
      if(recHighlight){
        setTimeout(()=>{
          const hl=document.querySelector('.row-highlight');
          if(hl) hl.scrollIntoView({behavior:'smooth',block:'center'});
        },200);
      }
    }
  }
}

// CSV 导出
function exportCSV(){
  const list=recFiltered.length>0?recFiltered:records;
  let csv='日期,投喂量(kg),摄食率(%),体重(g),水温(℃),溶氧(mg/L)\n';
  list.forEach(r=>csv+=`${r.date},${r.feed},${r.rate||0},${r.weight||0},${r.temp||0},${r.doLevel||0}\n`);
  const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='salmon-feeding-'+new Date().toISOString().split('T')[0]+'.csv';a.click();
  showToast('✅ CSV已导出','ok');
}

// ============ API 字段名转换 ============
// 前端 (短驼峰) ↔ 后端 (snake_case)
function toAPI(r){
  return {
    id: r.id,
    date: r.date,
    feed_kg: r.feed,
    feeding_rate: r.rate,
    fish_weight_g: r.weight,
    water_temp: r.temp,
    do_level: r.doLevel,
    note: r.note||'',
  };
}
function fromAPI(r){
  return {
    id: r.id,
    date: r.date,
    feed: r.feed_kg,
    rate: r.feeding_rate,
    weight: r.fish_weight_g,
    temp: r.water_temp,
    doLevel: r.do_level,
    note: r.note||'',
  };
}

// 本地 localStorage 缓存 (API 不可用时回退)
function saveRecordsLocal(){try{localStorage.setItem('salmon_records',JSON.stringify(records));}catch(e){}}

async function loadRecords(){
  const dv=localStorage.getItem('salmon_data_version');
  if(dv!=='2'){localStorage.removeItem('salmon_records');localStorage.setItem('salmon_data_version','2');}

  // 1. 先从 API 加载
  try {
    const resp=await fetch('/api/records');
    if(!resp.ok) throw new Error('API '+resp.status);
    const data=await resp.json();
    records=data.map(fromAPI);
    // 2. 迁移 localStorage 旧数据到 API (如果有的话)
    try {
      const old=JSON.parse(localStorage.getItem('salmon_records')||'[]');
      const existingDates=new Set(records.map(r=>r.date+r.feed+r.weight));
      for(const r of old){
        const key=r.date+r.feed+r.weight;
        if(!existingDates.has(key)){
          await fetch('/api/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(toAPI(r))});
        }
      }
      localStorage.removeItem('salmon_records'); // 迁移完成，清旧缓存
    }catch(e){}
    if(records.length===0){_generateDemoRecords();}
    saveRecordsLocal();
    return;
  }catch(e){
    console.warn('API 不可用，使用本地缓存:',e.message);
    showToast('⚠️ 离线模式 — 数据未同步','warn');
  }

  // 3. API 失败 → 回退 localStorage
  try{records=JSON.parse(localStorage.getItem('salmon_records')||'[]');}catch(e){records=[]};
  if(records.length===0){_generateDemoRecords();saveRecordsLocal();}
}
function _generateDemoRecords(){
  records=[];const d=new Date();
  const demoFeeds=[42,45,38,50,48,55,44,52,47,58,43,51,46,53,49];
  const demoRates=[85,88,82,90,87,92,84,89,86,93,83,91,85,90,88];
  const demoWeights=[120,122,125,128,131,134,137,141,145,149,153,157,161,166,170];
  const demoTemps=[13.5,14.0,13.8,14.2,14.5,15.0,14.8,15.2,15.5,15.8,16.0,15.5,15.0,14.5,14.0];
  const demoDOs=[8.0,8.2,8.1,8.5,8.3,8.8,8.4,9.0,8.6,9.2,8.7,9.1,8.5,8.3,8.0];
  for(let i=0;i<15;i++){
    const dd=new Date(d);dd.setDate(dd.getDate()-(14-i));
    records.unshift({
      date:dd.toISOString().split('T')[0],
      feed:demoFeeds[i],
      rate:demoRates[i],
      weight:demoWeights[i],
      temp:demoTemps[i],
      doLevel:demoDOs[i]
    });
  }
  saveRecordsLocal();
}

// ============ 数据分析面板 ============
function renderDashboard(){
  if(records.length===0)loadRecords();
  const s=JSON.parse(localStorage.getItem('salmon_settings')||'{}');
  const count=s.count||5000;
  const list=sorted(); // 旧→新
  const initialW=list.length>0?list[0].weight:0;
  const finalW=list.length>0?list[list.length-1].weight:0;
  const wg=finalW-initialW;
  const totalGainKg=wg*count/1000;
  const tf=list.reduce((s,r)=>s+r.feed,0);
  const ar=list.length>0?Math.round(list.reduce((s,r)=>s+r.rate,0)/list.length):0;
  const fcr=FeedingEngine.calcFCR(tf,totalGainKg);

  // === 核心指标卡片 ===
  document.getElementById('dhFCR').textContent=fcr;
  document.getElementById('dhFCR').style.color=fcr<1.3?'var(--kelp)':fcr<1.8?'var(--accent)':fcr<2.5?'var(--gold)':'var(--coral)';
  document.getElementById('dhFeed').textContent=tf.toFixed(1);
  document.getElementById('dhGain').textContent=wg;
  document.getElementById('dhRate').textContent=ar;

  // === 智能异常检测 ===
  const warnings=[];
  // FCR 异常
  if(fcr>2.5) warnings.push({l:'🔴',c:'coral',t:`FCR ${fcr} — 严重偏高`,d:'饲料转化效率低，建议检查水质、饲料品质、投喂量是否过量'});
  else if(fcr>1.8) warnings.push({l:'🟡',c:'gold',t:`FCR ${fcr} — 偏高`,d:'建议检查溶氧是否充足、是否有残饵'});
  // 溶氧检查
  list.forEach((r,i)=>{
    if((r.doLevel||0)<6) warnings.push({l:'🔴',c:'coral',t:`${r.date} 溶氧 ${r.doLevel}mg/L`,d:'溶氧低于6mg/L，严重影响摄食和饲料转化'});
    else if((r.doLevel||0)<7) warnings.push({l:'🟡',c:'gold',t:`${r.date} 溶氧 ${r.doLevel}mg/L`,d:'溶氧偏低，建议增加曝气'});
  });
  // 摄食率骤降 (连续2天下降超过10%)
  for(let i=2;i<list.length;i++){
    if(list[i].rate<list[i-1].rate-10&&list[i-1].rate<list[i-2].rate-5){
      warnings.push({l:'🟡',c:'gold',t:`${list[i].date} 摄食率骤降至 ${list[i].rate}%`,d:'连续下降，检查鱼群健康和水质变化'});
    }
  }
  // 体重停滞 (3天增重<5g)
  for(let i=3;i<list.length;i++){
    if(list[i].weight-list[i-3].weight<5){
      warnings.push({l:'🟡',c:'gold',t:`${list[i].date} 生长停滞`,d:'近3天增重不足5g，检查饲料和水温'});
      break;
    }
  }
  // 去重
  const seenW=new Set();
  const uniqueWarns=warnings.filter(w=>{const k=w.t;if(seenW.has(k))return false;seenW.add(k);return true;}).slice(0,8);

  document.getElementById('dhWarn').textContent=uniqueWarns.length;
  document.getElementById('warnings').innerHTML=uniqueWarns.length>0
    ?uniqueWarns.map(w=>`<div class="warn-item" style="border-left-color:${w.c}"><b>${w.l} ${w.t}</b><small>${w.d}</small></div>`).join('')
    :'<div style="color:var(--kelp);padding:20px;text-align:center">✅ 所有指标正常，养殖状态良好</div>';

  // === FCR 趋势表 (从旧到新计算) ===
  const fcrRows=[];
  for(let i=1;i<list.length;i++){
    const dayFeed=list[i].feed;
    const dayGain=(list[i].weight-list[i-1].weight)*count/1000;
    const dayFCR=dayGain>0?(dayFeed/dayGain).toFixed(2):'—';
    const rating=dayFCR==='—'?'—':dayFCR<1.3?'✅':dayFCR<1.8?'🟢':dayFCR<2.5?'🟡':'🔴';
    fcrRows.push({date:list[i].date,feed:dayFeed,gain:list[i].weight-list[i-1].weight,dayFCR,rating});
  }
  document.querySelector('#fcrTable tbody').innerHTML=fcrRows.slice(-10).map(r=>`<tr>
    <td>${r.date}</td><td><b>${r.feed}kg</b></td><td>${r.gain>0?'+':''}${r.gain}g</td>
    <td style="font-weight:700">${r.dayFCR}</td><td>${r.rating}</td>
  </tr>`).join('');

  // === 核心图表: 投喂量(柱) + 体重(线) 双Y轴 ===
  setTimeout(()=>{
    const dates=list.map(r=>r.date);
    const feeds=list.map(r=>r.feed);
    const weights=list.map(r=>r.weight);
    const dom=document.getElementById('chartMain');
    if(!dom) return;
    if(!charts.main) charts.main=echarts.init(dom);
    charts.main.setOption({
      tooltip:{trigger:'axis'},
      legend:{data:['投喂量','体重'],textStyle:{color:'#8899aa'},top:0},
      grid:{left:50,right:50,top:40,bottom:30},
      xAxis:{type:'category',data:dates,axisLabel:{color:'#8899aa',fontSize:10}},
      yAxis:[
        {type:'value',name:'投喂(kg)',axisLabel:{color:'#8899aa'},splitLine:{lineStyle:{color:'rgba(255,255,255,.05)'}}},
        {type:'value',name:'体重(g)',axisLabel:{color:'#8899aa'},splitLine:{show:false}},
      ],
      series:[
        {name:'投喂量',type:'bar',data:feeds,itemStyle:{color:'#4a9eff'},barMaxWidth:24},
        {name:'体重',type:'line',yAxisIndex:1,data:weights,smooth:true,itemStyle:{color:'#27ae60'},lineStyle:{width:2.5},symbol:'circle',symbolSize:6},
      ],
    });
    charts.main.resize();
  },200);
}

// ============ 知识库 (v2 — 动态文档管理) ============

let kbDocuments = [];

async function refreshKnowledge() {
  try {
    // 获取统计
    const statsRes = await fetch('/api/knowledge/stats');
    const stats = await statsRes.json();
    document.getElementById('kbStats').textContent =
      `— ${stats.documentCount} 篇文档 · ${stats.chunkCount} 块 · ${(stats.totalChars/1000).toFixed(0)}K 字`;

    // 获取文档列表
    const docsRes = await fetch('/api/knowledge/documents');
    kbDocuments = await docsRes.json();
    renderKnowledgeList();
  } catch(e) {
    document.getElementById('kbStats').textContent = '— 加载失败，请检查服务器';
    document.getElementById('kbList').innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-dim)">⚠️ 无法连接到知识库服务</div>';
  }
}

function renderKnowledgeList() {
  const search = (document.getElementById('kbSearch')?.value || '').toLowerCase();
  const typeFilter = document.getElementById('kbTypeFilter')?.value || '';

  let docs = kbDocuments;
  if (search) {
    docs = docs.filter(d =>
      (d.title || '').toLowerCase().includes(search) ||
      (d.sourceName || '').toLowerCase().includes(search) ||
      (d.author || '').toLowerCase().includes(search) ||
      (d.tags || []).some(t => t.toLowerCase().includes(search))
    );
  }
  if (typeFilter) {
    docs = docs.filter(d => d.sourceType === typeFilter);
  }

  if (docs.length === 0) {
    document.getElementById('kbList').innerHTML =
      '<div style="text-align:center;padding:40px;color:var(--text-dim);grid-column:1/-1">📭 没有匹配的文档<br><small>点击「添加文档」导入养殖知识</small></div>';
    return;
  }

  const typeIcons = {
    manual: '📖', paper: '📄', standard: '📏', web_article: '🌐', rss_feed: '📡'
  };

  document.getElementById('kbList').innerHTML = docs.map(d => {
    const icon = typeIcons[d.sourceType] || '📎';
    const tagsHtml = (d.tags || []).map(t => `<span class="kb-tag">${t}</span>`).join('');
    const hasUrl = d.sourceUrl && d.sourceUrl !== '#';
    return `<div class="kb-item">
      <div class="kb-header">
        <div class="kb-num">${icon}</div>
        <div class="kb-title">${d.title}</div>
        <span class="kb-tag">${d.sourceType}</span>
      </div>
      <div class="kb-src">📖 ${d.sourceName || '手动导入'} ${d.author ? '· ' + d.author : ''} ${d.publishDate ? '· ' + d.publishDate : ''}</div>
      <div class="kb-desc">${d.chunkCount} 个文本块 · ${(d.totalChars/1000).toFixed(1)}K 字符 · 摄入于 ${(d.ingestedAt||'').substring(0,10)}</div>
      <div class="kb-footer">
        <span>${tagsHtml}</span>
        <span style="display:flex;gap:8px;align-items:center">
          ${hasUrl ? `<a href="${d.sourceUrl}" target="_blank" rel="noopener" class="kb-link">🔗 查看原文</a>` : ''}
          <button class="btn-outline btn-xs" onclick="if(confirm('确定删除此文档？'))deleteDocument('${d.id}')" title="删除文档">🗑️</button>
        </span>
      </div>
    </div>`;
  }).join('');
}

async function deleteDocument(docId) {
  try {
    await fetch('/api/knowledge/documents/' + docId, { method: 'DELETE' });
    showToast('✅ 文档已删除', 'ok');
    refreshKnowledge();
  } catch(e) {
    showToast('❌ 删除失败', 'error');
  }
}

// 摄入文档弹窗
function showIngestModal() {
  document.getElementById('ingestModal').style.display = 'flex';
  document.getElementById('ingestTitle').value = '';
  document.getElementById('ingestURL').value = '';
  document.getElementById('ingestText').value = '';
  document.getElementById('ingestStatus').style.display = 'none';
}

function closeIngestModal() {
  document.getElementById('ingestModal').style.display = 'none';
}

async function ingestDocument() {
  const url = document.getElementById('ingestURL').value.trim();
  const text = document.getElementById('ingestText').value.trim();
  const title = document.getElementById('ingestTitle').value.trim();
  const author = document.getElementById('ingestAuthor').value.trim();
  const pubDate = document.getElementById('ingestDate').value;
  const tagsStr = document.getElementById('ingestTags').value.trim();
  const sourceType = document.getElementById('ingestType').value;

  if (!url && !text) {
    showToast('请提供 URL 或文本内容', 'error');
    return;
  }

  const btn = document.getElementById('ingestBtn');
  const statusEl = document.getElementById('ingestStatus');
  btn.disabled = true;
  btn.textContent = '⏳ 摄入中...';
  statusEl.style.display = 'block';
  statusEl.textContent = '正在抓取/分块/生成向量...';
  statusEl.style.color = 'var(--gold)';

  try {
    const body = {
      options: {
        title: title || undefined,
        author: author || undefined,
        publishDate: pubDate || undefined,
        sourceType,
        tags: tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [],
      }
    };

    if (url) {
      body.url = url;
    } else {
      body.text = text;
    }

    const resp = await fetch('/api/knowledge/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    if (data.ok) {
      statusEl.textContent = `✅ 摄入成功! ${data.document.chunkCount} 个文本块已索引`;
      statusEl.style.color = 'var(--kelp)';
      showToast('✅ 文档已添加', 'ok');
      setTimeout(() => { closeIngestModal(); refreshKnowledge(); }, 1500);
    } else {
      throw new Error(data.error || '未知错误');
    }
  } catch(e) {
    statusEl.textContent = '❌ 失败: ' + e.message;
    statusEl.style.color = 'var(--coral)';
    showToast('❌ 摄入失败', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '📥 摄入文档';
  }
}

// ============ 🌟 AI 智能对话 ============

// 🌐 联网搜索开关
// 简易 Markdown → HTML 渲染
function renderMarkdown(text) {
  // 预处理 [来源:N] 标记为可点击的 sup 标签
  text = text.replace(/\[来源:(\d+)\]/g, '<sup class="src-ref" onclick="scrollToSource($1)" title="点击查看来源 $1">[$1]</sup>');
  if (typeof marked !== 'undefined' && marked.parse) {
    try {
      marked.setOptions?.({ breaks: true, gfm: true });
      return marked.parse(text);
    } catch(e) { /* 回退 */ }
  }
  // 简易渲染
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\n## (.+)/g, '<h3>$1</h3>')
    .replace(/\n### (.+)/g, '<h4>$1</h4>')
    .replace(/\n- (.+)/g, '\n<li>$1</li>')
    .replace(/\n\d+\. (.+)/g, '\n<li>$1</li>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

// 构建可展开的来源卡片 (增强版)
function _buildSourceCards(sources, msgId) {
  if (!sources || sources.length === 0) return '';
  let html = `<div class="source-section">
    <div class="source-header" onclick="this.parentElement.classList.toggle('expanded')">
      <span>📚 引用来源 (${sources.length}条)</span>
      <span class="source-expand-icon">▼</span>
    </div>
    <div class="source-list" id="sources-${msgId}">`;
  sources.forEach((s, i) => {
    const relStars = '⭐'.repeat(Math.min(5, s.relevance || 1));
    const typeIcons = { paper: '📄', standard: '📏', web_article: '🌐', manual: '📖', rss_feed: '📡', patent: '📜' };
    const typeIcon = typeIcons[s.docType] || (s.source || '').includes('🌐') ? '🌐' : '📖';
    const linkHtml = s.link ? `<a href="${s.link}" target="_blank" rel="noopener" class="src-link">🔗 查看原文</a>` : '';

    // 溯源信息行
    let traceLine = '';
    if (s.author) traceLine += `👤 ${s.author} · `;
    if (s.publishDate) traceLine += `📅 ${s.publishDate} · `;
    if (s.sectionTitle) traceLine += `📖 ${s.sectionTitle} · `;
    if (s.pageNum) traceLine += `📄 第${s.pageNum}页 · `;
    if (s.docType) traceLine += `🏷️ ${s.docType}`;

    html += `<div class="source-item" id="src-${s.id}">
      <div class="source-item-header">
        <span class="source-num">${typeIcon} [来源:${s.id}]</span>
        <span class="source-title">${s.title}</span>
        <span class="source-relevance">${relStars}</span>
        ${linkHtml}
      </div>
      <div class="source-trace">${traceLine}</div>
      <div class="source-snippet">${s.snippet || '（原文较长，已截取前300字）'}</div>
      <div class="source-meta">出处: ${s.source || '知识库'}</div>
    </div>`;
  });
  html += '</div></div>';
  return html;
}

// 滚动到指定来源
let _pendingSources = {};
function scrollToSource(id) {
  const el = document.getElementById('src-' + id);
  if (el) {
    // 先展开来源面板
    const section = el.closest('.source-section');
    if (section && !section.classList.contains('expanded')) {
      section.classList.add('expanded');
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.background = 'rgba(74,158,255,.2)';
    setTimeout(() => { el.style.background = ''; }, 2000);
  }
}

// 显示加载动画
function _showLoading() {
  const box = document.getElementById('chatBox');
  const loadId = '_load_' + Date.now();
  box.innerHTML += `<div class="chat-msg ai" id="${loadId}">
    <div class="chat-role">🤖 鲑鱼博士</div>
    <div class="chat-content loading-dots">正在检索知识库<span>.</span><span>.</span><span>.</span></div>
  </div>`;
  box.scrollTop = box.scrollHeight;
  return loadId;
}

function askAI() {
  const q = document.getElementById('chatInput').value.trim();
  if (!q) return;

  const box = document.getElementById('chatBox');

  // 添加用户消息
  box.innerHTML += `<div class="chat-msg user">
    <div class="chat-content">${q.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
  </div>`;
  chatHistory.push({ role: 'user', content: q });
  document.getElementById('chatInput').value = '';
  box.scrollTop = box.scrollHeight;

  // 加载动画
  const loadId = _showLoading();

  // 调用 API
  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: q,
      history: chatHistory.slice(0, -1),
    }),
  }).then(r => r.json()).then(data => {
    const el = document.getElementById(loadId);
    const msgId = loadId.replace('_load_', 'msg_');

    // 领域外拒绝
    if (data.outOfDomain) {
      if (el) {
        el.innerHTML = `<div class="chat-role">🤖 鲑鱼博士</div>
          <div class="chat-content markdown-body" style="border-left:3px solid var(--gold,#e6a817);padding-left:12px">${renderMarkdown(data.answer)}</div>`;
      }
      chatHistory.push({ role: 'assistant', content: data.answer });
      if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
      box.scrollTop = box.scrollHeight;
      return;
    }

    // 知识库无匹配
    if (data.noMatch) {
      if (el) {
        el.innerHTML = `<div class="chat-role">🤖 鲑鱼博士</div>
          <div class="chat-content markdown-body" style="opacity:.85">${renderMarkdown(data.answer)}</div>`;
      }
      chatHistory.push({ role: 'assistant', content: data.answer });
      if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
      box.scrollTop = box.scrollHeight;
      return;
    }

    const rendered = renderMarkdown(data.answer);
    const sourcesHtml = _buildSourceCards(data.sources, msgId);

    if (el) {
      el.innerHTML = `<div class="chat-role">🤖 鲑鱼博士</div>
        <div class="chat-content markdown-body">${rendered}</div>
        ${sourcesHtml}`;
    }
    chatHistory.push({ role: 'assistant', content: data.answer });
    if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);

    box.scrollTop = box.scrollHeight;
  }).catch((err) => {
    const el = document.getElementById(loadId);
    if (el) {
      el.innerHTML = `<div class="chat-role">🤖 鲑鱼博士</div>
        <div class="chat-content">😅 抱歉，网络连接出现问题。<br><br>
        💡 请检查服务器是否在运行: <code>npm start</code></div>`;
    }
  });
}

function quickAsk(q) {
  document.getElementById('chatInput').value = q;
  askAI();
}

function clearChat() {
  chatHistory = [];
  document.getElementById('chatBox').innerHTML = `<div class="chat-msg ai">
    <div class="chat-role">🤖 鲑鱼博士</div>
    <div class="chat-content">🗑️ 对话已清空！有什么新的问题吗？</div>
  </div>`;
  showToast('✅ 对话历史已清空', 'ok');
}

// ============ 设置 ============
function loadSettings(){
  const s=JSON.parse(localStorage.getItem('salmon_settings')||'{}');
  document.getElementById('defFish').value=s.fish||'三文鱼(大西洋鲑)';
  document.getElementById('defWeight').value=s.weight||150;document.getElementById('defCount').value=s.count||5000;
  document.getElementById('defTemp').value=s.temp||14;document.getElementById('defDO').value=s.do||8.5;
}
function saveSettings(){
  const s={fish:document.getElementById('defFish').value,weight:document.getElementById('defWeight').value,count:document.getElementById('defCount').value,temp:document.getElementById('defTemp').value,do:document.getElementById('defDO').value};
  localStorage.setItem('salmon_settings',JSON.stringify(s));
  document.getElementById('avgWeight').value=s.weight;document.getElementById('count').value=s.count;
  document.getElementById('waterTemp').value=s.temp;document.getElementById('doLevel').value=s.do;
  showToast('✅ 已保存, 参数已应用','ok');
}
function resetSettings(){localStorage.removeItem('salmon_settings');loadSettings();showToast('🔄 已恢复默认','ok');}
function exportData(){
  const blob=new Blob([JSON.stringify({records,settings:JSON.parse(localStorage.getItem('salmon_settings')||'{}'),exported:new Date().toISOString()},null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='salmon-feeding-backup-'+new Date().toISOString().split('T')[0]+'.json';a.click();
  showToast('✅ 已导出','ok');
}
function importData(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();reader.onload=function(e){
    try{const data=JSON.parse(e.target.result);if(data.records){records=data.records;saveRecordsLocal();renderRecords();showToast('✅ 已导入'+data.records.length+'条记录','ok');}}catch(err){showToast('❌ 文件格式错误','error');}
  };reader.readAsText(file);
}

// ============ 初始化 ============
async function init(){
  document.querySelector('.top-bar').style.display='flex'; // 首页显示搜索栏
  await loadRecords();const s=JSON.parse(localStorage.getItem('salmon_settings')||'{}');
  if(s.weight){document.getElementById('avgWeight').value=s.weight;document.getElementById('count').value=s.count||5000;document.getElementById('waterTemp').value=s.temp||14;document.getElementById('doLevel').value=s.do||8.5;}
  renderHome();setTimeout(function(){validateParams();if(document.getElementById('feedingResult').innerHTML.indexOf('输入参数')>=0) calcFeeding(true);},300);
  document.getElementById('fishLabel').textContent='三文鱼';
  // Update clock in sidebar
  const updateClock=()=>{const el=document.getElementById('clock');if(el)el.textContent=new Date().toLocaleString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});};
  updateClock();setInterval(updateClock,1000);
}

window.addEventListener('load',init);
window.addEventListener('resize',()=>{Object.values(charts).forEach(c=>{try{c.resize()}catch(e){}})});
window.addEventListener('orientationchange',()=>{setTimeout(()=>{Object.values(charts).forEach(c=>{try{c.resize()}catch(e){}})},200)});
// Ctrl+K global search shortcut
window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();document.getElementById('globalSearch').focus();}});
