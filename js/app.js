// ================================================================
// app.js v3 — App式界面 + 全局搜索 + 自动计算
// ================================================================
let records=[], charts={}, currentPage='home';

// ============ 页面切换 ============
function switchPage(name) {
  currentPage = name;
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  const pg = document.getElementById('page-'+name);
  if(pg) pg.classList.add('active');
  const btn = document.querySelector(`[data-page="${name}"]`);
  if(btn) btn.classList.add('active');
  if(name==='dashboard') renderDashboard();
  if(name==='records') renderRecords();
  if(name==='home') renderHome();
  if(name==='knowledge') renderKbList();
  if(name==='calc'){ validateParams(); if(document.getElementById('feedingResult').innerHTML==='') calcFeeding(); }
  if(name==='settings') loadSettings();
  hideSearchResults();
}

function renderHome() {
  document.querySelector('.quick-btn:nth-child(2) small').textContent = records.length+'条记录';
}

// ============ 搜索 ============
function showSearchResults() { document.getElementById('searchResults').style.display='block'; document.getElementById('searchOverlay').style.display='block'; }
function hideSearchResults() { document.getElementById('searchResults').style.display='none'; document.getElementById('searchOverlay').style.display='none'; }

function onSearch(q) {
  if (!q || q.length<1) { hideSearchResults(); return; }
  showSearchResults();
  const terms = ['投喂计算','FCR','溶氧','水温','pH','氨氮','密度','疾病','模型','饲料','标准'];
  const hits = terms.filter(t=>t.includes(q)||q.includes(t));
  const actions = [
    {icon:'📐',label:'投喂计划计算',desc:'输入参数自动计算日投喂量',action:()=>{switchPage('calc');document.getElementById('globalSearch').value=q;}},
    {icon:'📋',label:`投喂记录 (${records.length}条)`,desc:'查看和管理历史记录',action:()=>switchPage('records')},
    {icon:'📊',label:'数据分析面板',desc:'图表+FCR+预警',action:()=>switchPage('dashboard')},
    {icon:'📚',label:'知识库搜索',desc:'12条领域知识',action:()=>switchPage('knowledge')},
    {icon:'🤖',label:`AI问答: "${q}"`,desc:'智能回答养殖问题',action:()=>{switchPage('chat');document.getElementById('chatInput').value=q;askAI();}},
  ].filter(a=>a.label.includes(q)||q.includes(a.label.split(':')[0])||hits.some(h=>a.label.includes(h)));
  if (actions.length===0) actions.push(...actions.slice(0,3)); // fallback
  document.getElementById('searchResults').innerHTML=actions.map(a=>
    `<div class="sr-item" onclick="hideSearchResults();${a.action.toString().replace(/^\(\)=>/,'').replace(/}$/,'')}">
      <span>${a.icon}</span><div><div>${a.label}</div><small style="color:var(--text-dim)">${a.desc}</small></div>
    </div>`
  ).join('');
}

function runSearch() {
  const q = document.getElementById('globalSearch').value.trim();
  if (!q) return;
  // 智能识别: 如果是参数格式, 直接跳计算
  const tm = q.match(/(\d+)\s*度/) || q.match(/水温\s*(\d+)/);
  const wm = q.match(/(\d+)\s*g/);
  if (tm && wm) { switchPage('calc'); document.getElementById('avgWeight').value=wm[1]; document.getElementById('waterTemp').value=tm[1]; autoCalc(); return; }
  // 否则跳AI问答
  switchPage('chat'); document.getElementById('chatInput').value=q; askAI();
}

// ============ 参数 ============
const LIMITS={
  avgWeight:{min:1,max:5000,label:'体重',unit:'g'},
  count:{min:1,max:999999,label:'数量',unit:'尾'},
  waterTemp:{min:2,max:22,label:'水温',unit:'℃',optimal:[12,18]},
  doLevel:{min:0,max:20,label:'溶氧',unit:'mg/L',warn:7,crit:4,ok:9},
  ph:{min:6,max:8,label:'pH',unit:'',optimal:[7,7.5]},
  ammonia:{min:0,max:2,label:'氨氮',unit:'mg/L',warn:0.2,crit:0.6},
};

function validateParams() {
  let hasC=false,hasW=false; const issues=[];
  Object.keys(LIMITS).forEach(key=>{
    const el=document.getElementById(key); if(!el)return;
    const v=parseFloat(el.value); const l=LIMITS[key];
    const pc=document.getElementById('pc-'+({avgWeight:'weight',count:'count',waterTemp:'temp',doLevel:'do',ph:'ph',ammonia:'nh3'}[key]));
    if(pc){pc.style.borderColor='var(--border)';pc.style.boxShadow='none'}
    if(isNaN(v))return;
    if(v<l.min||v>l.max){hasC=true;if(pc){pc.style.borderColor='#e74c3c';pc.style.boxShadow='0 0 8px rgba(231,76,60,.3)'}}
    else if(l.crit!==undefined&&v<=l.crit){hasC=true;if(pc){pc.style.borderColor='#e74c3c';pc.style.boxShadow='0 0 8px rgba(231,76,60,.3)'}}
    else if(l.warn!==undefined&&v<l.warn){hasW=true;if(pc){pc.style.borderColor='#e67e22';pc.style.boxShadow='0 0 6px rgba(230,126,34,.2)'}}
    else{if(pc){pc.style.borderColor='rgba(39,174,96,.5)';pc.style.boxShadow='0 0 4px rgba(39,174,96,.15)'}}
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
function autoCalc(){validateParams();clearTimeout(autoTimer);autoTimer=setTimeout(()=>{if(!validateParams().hasCritical)calcFeeding();},350);}

function calcFeeding(){
  const v=validateParams();if(v.hasCritical){showToast('❌ 参数异常','error');document.getElementById('feedingResult').innerHTML='';return;}
  const avgWeight=parseFloat(document.getElementById('avgWeight').value);const count=parseInt(document.getElementById('count').value);
  const waterTemp=parseFloat(document.getElementById('waterTemp').value);const doLevel=parseFloat(document.getElementById('doLevel').value);
  const ph=parseFloat(document.getElementById('ph').value);const ammonia=parseFloat(document.getElementById('ammonia').value);
  const fishType=document.getElementById('fishType').value;
  const result=FeedingEngine.calculate({avgWeight,count,waterTemp,doLevel,fishType});
  const corr=correctionFactors();const wq=FeedingEngine.assessWaterQuality(waterTemp,doLevel,ph,ammonia);
  result.dailyFeed=Math.round(result.dailyFeed*corr.total*1000)/1000;
  result.feedPerMeal=Math.round(result.dailyFeed/result.mealsPerDay*1000)/1000;
  result.feedingRate=Math.round(result.feedingRate*corr.total*1000)/1000;
  Object.keys(result.methods).forEach(k=>{result.methods[k].rate=Math.round(result.methods[k].rate*corr.total*1000)/1000;result.methods[k].daily=Math.round(result.methods[k].daily*corr.total*1000)/1000;});

  let h='<div class="card"><h3>🎯 推荐投喂量</h3>';
  h+=`<div class="result-box"><span class="val">${result.dailyFeed.toFixed(2)}</span> <span class="unit">kg/天</span> &nbsp;|&nbsp; <b>${result.feedingRate.toFixed(3)}%</b> &nbsp;|&nbsp; ${result.mealsPerDay}次<br><small style="color:var(--text-dim)">${result.recommendedMethod} | 总修正:×${corr.total.toFixed(3)}</small></div>`;
  if(corr.factors.length>0){
    h+='<div style="margin-top:8px;padding:8px 12px;background:rgba(15,40,71,.5);border:1px solid var(--border);border-radius:10px;font-size:11px"><b>🌍 环境修正:</b>';
    corr.factors.forEach(f=>h+=`<div style="margin:2px 0">${f.type==='crit'?'🔴':f.type==='warn'?'🟡':'🔵'} ${f.label}: ${f.value} → <code>${f.impact}</code> ${f.detail}</div>`);
    h+='</div>';
  }
  h+='<div class="grid-2" style="margin-top:8px;gap:6px">';
  ['table','science','growth'].forEach(k=>{const m=result.methods[k];h+=`<div class="card" style="padding:10px;text-align:center"><div style="font-size:11px;font-weight:700">${m.label}</div><div style="font-size:20px;font-weight:800;color:var(--accent)">${(m.rate||0).toFixed(3)}%</div><div style="font-size:10px;color:var(--text-dim)">${(m.daily||0).toFixed(2)}kg</div></div>`;});
  h+='</div>';
  h+=`<details style="margin-top:8px"><summary style="font-size:12px;color:var(--accent);cursor:pointer">📐 推导过程</summary><div style="margin-top:6px;font-size:11px">`;
  ['table','science','growth'].forEach(k=>{const m=result.methods[k];h+=`<div style="margin-bottom:6px"><b>${m.label}</b> — ${m.source}`;m.steps.forEach(s=>h+=`<div class="step-list"><div><b>${s.step}.${s.title}</b> → ${s.result}<br><span class="src">${s.source}</span></div></div>`);h+='</div>';});
  h+='</div></details>';
  result.warnings.forEach(w=>h+=`<div class="warning ${w.startsWith('🚨')?'critical':''}" style="font-size:11px">${w}</div>`);
  if(wq.issues.length>0)h+=`<div class="warning" style="font-size:11px">🌊 水质: ${wq.issues.join(',')}</div>`;
  if(ammonia>0.6)h+='<div class="warning critical" style="font-size:11px">🚨 氨氮严重超标!</div>';
  if(ph<5.5||ph>9)h+='<div class="warning critical" style="font-size:11px">🚨 pH严重异常!</div>';
  h+='</div>';document.getElementById('feedingResult').innerHTML=h;
  if(corr.factors.length===0)showToast('✅ 计算完成','ok');else showToast('⚙️ 已应用'+corr.factors.length+'项修正','warn');
}

// ============ 记录 ============
function addRecord(){
  const feed=parseFloat(document.getElementById('recFeed').value);if(!feed||feed<=0)return;
  records.unshift({date:new Date().toISOString().split('T')[0],feed,rate:parseInt(document.getElementById('recRate').value)||90,temp:parseFloat(document.getElementById('waterTemp').value)||14,doLevel:parseFloat(document.getElementById('doLevel').value)||8.5,weight:parseFloat(document.getElementById('avgWeight').value)||150});
  saveRecords();renderRecords();document.getElementById('recFeed').value='';showToast('✅ 已保存','ok');
}
function delRecord(i){records.splice(i,1);saveRecords();renderRecords();}
function renderRecords(){
  document.getElementById('recordList').innerHTML=records.slice(0,30).map((r,i)=>`<div class="record-item"><div class="ri-left"><span class="ri-date">${r.date}</span><span>喂${r.feed}kg · 食${r.rate}% · ${r.weight}g · ${r.temp}℃</span></div><div><span class="ri-val">${r.feed}kg</span> <button class="btn-danger btn-sm" onclick="delRecord(${i})">✕</button></div></div>`).join('')||'<div style="text-align:center;color:var(--text-dim);padding:20px">暂无记录</div>';
}
function saveRecords(){try{localStorage.setItem('salmon_records',JSON.stringify(records));}catch(e){}}
function loadRecords(){try{records=JSON.parse(localStorage.getItem('salmon_records')||'[]');}catch(e){records=[]};if(records.length===0){const d=new Date();for(let i=14;i>=0;i--){const dd=new Date(d);dd.setDate(dd.getDate()-i);records.push({date:dd.toISOString().split('T')[0],feed:Math.round((40+Math.random()*20)*10)/10,rate:80+Math.floor(Math.random()*20),weight:Math.round(120+i*2.2+Math.random()*5),temp:Math.round((13+Math.random()*4)*10)/10,doLevel:Math.round((7.5+Math.random()*3)*10)/10});}saveRecords();}}

// ============ 仪表盘 ============
function renderDashboard(){
  if(records.length===0)loadRecords();
  const tf=records.reduce((s,r)=>s+r.feed,0);const ar=records.length>0?Math.round(records.reduce((s,r)=>s+r.rate,0)/records.length):0;
  const fw=records.length>0?records[records.length-1].weight:0;const lw=records.length>0?records[0].weight:0;const wg=lw-fw;
  const fcr=FeedingEngine.calcFCR(tf,wg/1000);const ado=records.length>0?(records.reduce((s,r)=>s+r.doLevel,0)/records.length).toFixed(1):0;
  document.getElementById('statCards').innerHTML=`<div class="stat-card"><div class="num">${tf.toFixed(1)}</div><div class="label">总投喂kg</div></div><div class="stat-card"><div class="num">${ar}%</div><div class="label">平均摄食率</div></div><div class="stat-card"><div class="num">${fcr}</div><div class="label">FCR</div></div><div class="stat-card"><div class="num">${wg}g</div><div class="label">总增重</div></div>`;
  const warns=[];if(fcr>2)warns.push('⚠️ FCR偏高');if(parseFloat(ado)<7)warns.push('⚡ 溶氧偏低');if(ar<70)warns.push('📉 摄食率低');
  document.getElementById('warnings').innerHTML=warns.length>0?warns.map(w=>`<div class="warning">${w}</div>`).join(''):'<div style="color:#27ae60">✅ 正常</div>';
  setTimeout(()=>{
    const dates=records.map(r=>r.date).reverse();
    if(!charts.feed)charts.feed=echarts.init(document.getElementById('chartFeed'));
    charts.feed.setOption({tooltip:{trigger:'axis'},xAxis:{type:'category',data:dates},yAxis:{type:'value',name:'kg'},series:[{name:'投喂量',type:'bar',data:records.map(r=>r.feed).reverse(),itemStyle:{color:'#2980b9'}}]});
    if(!charts.growth)charts.growth=echarts.init(document.getElementById('chartGrowth'));
    charts.growth.setOption({tooltip:{trigger:'axis'},xAxis:{type:'category',data:dates},yAxis:{type:'value',name:'g'},series:[{name:'体重',type:'line',data:records.map(r=>r.weight).reverse(),smooth:true,itemStyle:{color:'#27ae60'}}]});
  },200);
}

// ============ 知识库 ============
function renderKbList(){
  document.getElementById('kbList').innerHTML=KnowledgeBase.getKnowledgeSources().map(k=>`<div class="kb-item"><div class="kb-num">${k.id}</div><div class="kb-info"><div class="kb-title">${k.title}</div><div class="kb-src">${k.source}</div></div><span class="kb-tag">${k.type}</span></div>`).join('');
}

// ============ AI ============
function askAI(){
  const q=document.getElementById('chatInput').value.trim();if(!q)return;
  const box=document.getElementById('chatBox');box.innerHTML+=`<div class="chat-msg user">${q}</div>`;document.getElementById('chatInput').value='';box.scrollTop=box.scrollHeight;
  setTimeout(()=>{box.innerHTML+=`<div class="chat-msg ai">${localQA(q)}</div>`;box.scrollTop=box.scrollHeight;},400);
}
function quickAsk(q){document.getElementById('chatInput').value=q;askAI();}

function localQA(q){
  const lq=q.toLowerCase();const tm=lq.match(/水温\s*(\d+)/)||lq.match(/(\d+)\s*度/);const wm=lq.match(/体重\s*(\d+)\s*g/i)||lq.match(/(\d+)\s*g[^/]/);
  if(tm&&wm){const t=parseFloat(tm[1]),w=parseFloat(wm[1]);const r=FeedingEngine.calculate({avgWeight:w,count:1000,waterTemp:t,doLevel:9,fishType:'三文鱼'});return`📐 水温<b>${t}℃</b> 体重<b>${w}g</b>:<br>• 推荐投饲率: <b>${r.feedingRate.toFixed(3)}%</b><br>• 千尾日投喂: <b>${r.dailyFeed.toFixed(2)}kg</b><br>• 分<b>${r.mealsPerDay}</b>次<br>• 三法: 查表${r.methods.table.rate.toFixed(2)}% | 科研${r.methods.science.rate.toFixed(2)}% | 生长${r.methods.growth.rate.toFixed(2)}%`;}
  if(lq.includes('fcr'))return'📊 <b>FCR</b>=投喂量÷增重。理想1.0-1.2,>2.0需检查。<br>RAS:1.15 | 网箱:1.00 | 流水:1.05';
  if(lq.includes('溶氧'))return'🌊 三文鱼≥9mg/L, 虹鳟6-7mg/L。DOmaxFI(15℃)=66%≈9.2mg/L, 低于此值Sigmoid递减摄食。';
  if(lq.includes('水温'))return'🌡️ 三文鱼2-22℃(最佳12-18)。<10℃喂2次,≥10℃喂3次。>20℃每升1℃减3.5%。';
  if(lq.includes('密度')){let a='🐟 <b>密度标准:</b><br>';KnowledgeBase.fcrStandards.forEach(s=>a+=`${s.mode}:${s.density}→FCR${s.fcr}<br>`);return a;}
  if(lq.includes('疾病')){let a='🩺 <b>常见病:</b><br>';KnowledgeBase.diseases.forEach(d=>a+=`<b>${d.name}</b>: ${d.treatment}<br>`);return a;}
  if(lq.includes('模型'))return'📐 <b>三模型:</b>①二维插值(教材) ②FI=αBW^βe^(γT)h(DO)(Azevedo2026) ③SGR映射(FAO+孙国祥2014)';
  if(lq.includes('你好')||lq.includes('帮助'))return'👋 智能搜索已上线! 顶部搜索框可搜: 投喂计算/FCR/溶氧/水温/密度/疾病/模型。或输入 "水温15度体重200g" 直接算!';
  return'🤔 试试: "水温15度体重200g" | "FCR" | "密度" | "疾病" | "pH范围"';
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
    try{const data=JSON.parse(e.target.result);if(data.records){records=data.records;saveRecords();renderRecords();showToast('✅ 已导入'+data.records.length+'条记录','ok');}}catch(err){showToast('❌ 文件格式错误','error');}
  };reader.readAsText(file);
}

// ============ 初始化 ============
function init(){
  loadRecords();const s=JSON.parse(localStorage.getItem('salmon_settings')||'{}');
  if(s.weight){document.getElementById('avgWeight').value=s.weight;document.getElementById('count').value=s.count||5000;document.getElementById('waterTemp').value=s.temp||14;document.getElementById('doLevel').value=s.do||8.5;}
  renderHome();validateParams();calcFeeding();
  document.getElementById('fishLabel').textContent='三文鱼';
  setInterval(()=>{try{document.getElementById('clock').textContent=new Date().toLocaleString('zh-CN')}catch(e){}},1000);
}

window.addEventListener('load',init);
window.addEventListener('resize',()=>{Object.values(charts).forEach(c=>c.resize())});
