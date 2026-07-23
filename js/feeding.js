// ================================================================
// feeding.js — 投喂计算引擎 v2.1
// 三法并行: ①二维插值 ②科研模型 ③SGR生长模型
// ================================================================

const FeedingEngine = {

  _lerp(x, x0, x1, y0, y1) {
    if (x1 === x0) return y0;
    return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  },

  _interpolate2D(xVal, xArr, yVal, yArr, table) {
    let xLo = 0, xHi = xArr.length - 1;
    for (let i = 0; i < xArr.length; i++) { if (xArr[i] <= xVal) xLo = i; if (xArr[i] >= xVal) { xHi = i; break; } }
    if (xLo > xHi) xHi = xLo;
    let yLo = 0, yHi = yArr.length - 1;
    for (let i = 0; i < yArr.length; i++) { if (yArr[i] <= yVal) yLo = i; if (yArr[i] >= yVal) { yHi = i; break; } }
    if (yLo > yHi) yHi = yLo;
    const f00 = table[xLo][yLo], f01 = table[xLo][yHi], f10 = table[xHi][yLo], f11 = table[xHi][yHi];
    const fx0 = this._lerp(xVal, xArr[xLo], xArr[xHi], f00, f10);
    const fx1 = this._lerp(xVal, xArr[xLo], xArr[xHi], f01, f11);
    return this._lerp(yVal, yArr[yLo], yArr[yHi], fx0, fx1);
  },

  _doPercentToMgL(doPercent, waterTemp) {
    const satMgL = 14.6 - 0.4 * waterTemp;
    return doPercent / 100 * satMgL;
  },

  _sigmoidDO(doMgL, doMaxPercent, waterTemp) {
    const doMaxMgL = this._doPercentToMgL(doMaxPercent, waterTemp);
    const doHalf = doMaxMgL * 0.6;
    const k = 0.8;
    const h = 1.0 / (1.0 + Math.exp(-k * (doMgL - doHalf)));
    return Math.max(0, Math.min(1, h));
  },

  _applyCorrections(baseRate, avgWeightG, waterTemp, doLevel, steps) {
    let finalRate = baseRate;
    if (waterTemp > 20) {
      const old = finalRate;
      const corr = 1 - 0.035 * (waterTemp - 20);
      finalRate *= corr;
      steps.push({ step: steps.length+1, title: '高温修正 (>20℃)', formula: '修正=1-0.035×(T-20)', input: `T=${waterTemp}℃`, result: `${old.toFixed(3)}%×${corr.toFixed(3)}=${finalRate.toFixed(3)}%`, source: '水产养殖通用规则', detail: '每升1℃减3.5%' });
    }
    if (avgWeightG > 10) {
      const old = finalRate;
      finalRate *= 0.84;
      steps.push({ step: steps.length+1, title: '大鱼修正 (>10g取84%)', formula: '修正系数=0.84', input: `体重=${avgWeightG}g`, result: `${old.toFixed(3)}%×0.84=${finalRate.toFixed(3)}%`, source: '虹鳟投饲率表附注', detail: '大鱼代谢率降低,避免过投' });
    }
    if (doLevel < 9) {
      const old = finalRate;
      const doF = this._sigmoidDO(doLevel, 66, waterTemp);
      finalRate *= doF;
      const satRef = this._doPercentToMgL(66, waterTemp);
      steps.push({ step: steps.length+1, title: '溶氧修正 (Sigmoid)', formula: `DOmaxFI=66%≈${satRef.toFixed(1)}mg/L, h(DO)=sigmoid(DO,half=${(satRef*0.6).toFixed(1)})`, input: `DO=${doLevel}mg/L`, result: `${old.toFixed(3)}%×${doF.toFixed(3)}=${finalRate.toFixed(3)}%`, source: 'Remen2016+Azevedo2026', detail: `饱和≈${(14.6-0.4*waterTemp).toFixed(1)}mg/L` });
    }
    return finalRate;
  },

  _finalize(feedRate, bwKg, count, waterTemp, doLevel, steps, methodName) {
    const daily = bwKg * count * (feedRate / 100);
    const meals = waterTemp >= 10 ? 3 : 2;
    const w = [];
    if (waterTemp < 2 || waterTemp > 22) w.push('🚨 水温超出适宜范围(2~22℃)');
    if (doLevel < 4) w.push('🚨 溶氧<4mg/L,鱼类停食风险');
    else if (doLevel < 7) w.push('⚡ 溶氧偏低,投喂量已下调');
    if (feedRate > 4) w.push('⚠️ 投饲率偏高(>4%),请核实参数');
    return {
      method: methodName, dailyFeed: Math.round(daily*1000)/1000,
      feedPerMeal: Math.round(daily/meals*1000)/1000,
      feedingRate: Math.round(feedRate*1000)/1000,
      mealsPerDay: meals,
      mealTimes: meals===3?['8:00-10:00','12:00-13:00','17:00-18:00']:['8:00-10:00','17:00-18:00'],
      steps, warnings: w, inputs: { waterTemp, doLevel },
    };
  },

  // ====== 方法一: 二维双线性插值 ======
  methodTable(avgWeightG, waterTemp, doLevel, count) {
    const tbl = KnowledgeBase.feedingTable;
    const steps = [{
      step: 1, title: '二维双线性插值查表',
      formula: '在虹鳟投饲率表(8水温×11体重级)中做双线性插值',
      input: `水温=${waterTemp}℃, 体重=${avgWeightG}g`,
      result: `查表计算中...`,
      source: '《水产动物营养与饲料学》',
      detail: `水温${tbl.temps[0]}~${tbl.temps[tbl.temps.length-1]}℃全覆盖`,
    }];
    const baseRate = this._interpolate2D(waterTemp, tbl.temps, avgWeightG, tbl.weightLevels, tbl.rates);
    steps[0].result = `基准投饲率 = ${baseRate.toFixed(3)}%`;
    const finalRate = this._applyCorrections(baseRate, avgWeightG, waterTemp, doLevel, steps);
    return this._finalize(finalRate, avgWeightG/1000, count, waterTemp, doLevel, steps, '查表插值法');
  },

  // ====== 方法二: 科研模型 FI = α×BW^β×e^(γT)×h(DO) ======
  methodScience(avgWeightG, waterTemp, doLevel, count) {
    const steps = [];
    const bwKg = avgWeightG / 1000;
    const alpha = 0.0045, beta = 0.55, gamma = 0.058;
    const baseFI = alpha * Math.pow(bwKg, beta);
    steps.push({ step: 1, title: '异速生长模型 FI=α×BW^β', formula: `FI_base=${alpha}×(${bwKg.toFixed(3)}kg)^${beta}`, input: `体重=${avgWeightG}g(${bwKg.toFixed(3)}kg)`, result: `基础FI=${baseFI.toFixed(4)}kg/尾/天`, source: 'Azevedo et al.,2026', detail: `α=${alpha},β=${beta}(异速生长指数)` });
    const tempF = Math.exp(gamma * waterTemp);
    const tempFI = baseFI * tempF;
    steps.push({ step: 2, title: '温度修正 exp(γ×T)', formula: `exp(${gamma}×${waterTemp}℃)=${tempF.toFixed(4)}`, input: `水温=${waterTemp}℃`, result: `温度修正后FI=${baseFI.toFixed(4)}×${tempF.toFixed(4)}=${tempFI.toFixed(4)}kg/尾/天`, source: 'Azevedo et al.,2026', detail: `γ=${gamma}(温度敏感系数)` });
    const doF = this._sigmoidDO(doLevel, 66, waterTemp);
    const finalFI = tempFI * doF;
    const satRef = this._doPercentToMgL(66, waterTemp);
    steps.push({ step: 3, title: '溶氧修正 h(DO) Sigmoid', formula: `DOmaxFI=66%≈${satRef.toFixed(1)}mg/L, h=sigmoid(DO,half=${(satRef*0.6).toFixed(1)})`, input: `DO=${doLevel}mg/L`, result: `最终FI=${tempFI.toFixed(4)}×${doF.toFixed(4)}=${finalFI.toFixed(4)}kg/尾/天`, source: 'Remen2016+Azevedo2026', detail: `h(DO)=1/(1+exp(-0.8(DO-${(satRef*0.6).toFixed(1)})))` });
    const feedRate = (finalFI / bwKg) * 100;
    const daily = finalFI * count;
    steps.push({ step: 4, title: '总量换算', formula: '日投喂量=FI×数量, 投饲率=FI/体重×100', input: `FI=${finalFI.toFixed(4)}kg/尾, 数量=${count}`, result: `日投喂=${daily.toFixed(2)}kg, 投饲率=${feedRate.toFixed(3)}%`, source: '综合计算', detail: '' });
    const meals = waterTemp >= 10 ? 3 : 2;
    const w = [];
    if (waterTemp<2||waterTemp>22) w.push('🚨 水温超出适宜范围');
    if (doLevel<4) w.push('🚨 溶氧<4mg/L');
    if (feedRate>4) w.push('⚠️ 投饲率偏高');
    return { method: '科研模型法', dailyFeed: Math.round(daily*1000)/1000, feedPerMeal: Math.round(daily/meals*1000)/1000, feedingRate: Math.round(feedRate*1000)/1000, mealsPerDay: meals, mealTimes: meals===3?['8:00-10:00','12:00-13:00','17:00-18:00']:['8:00-10:00','17:00-18:00'], steps, warnings: w, inputs: { waterTemp, doLevel } };
  },

  // ====== 方法三: SGR 生长模型 ======
  methodGrowth(avgWeightG, waterTemp, doLevel, count) {
    const steps = [];
    const bwKg = avgWeightG / 1000;
    const sgr = Math.max(0.3, Math.min(2.5, 0.3 + (waterTemp - 2) * 0.09));
    const dailyGain = avgWeightG * (sgr / 100);
    steps.push({ step: 1, title: 'SGR特定生长率估算', formula: 'SGR=0.3+(T-2)×0.09', input: `水温=${waterTemp}℃`, result: `SGR=${sgr.toFixed(2)}%/天, 日增重≈${dailyGain.toFixed(2)}g/天`, source: 'FAO鲑科生长模型', detail: `适温范围2-22℃` });
    const optimalSGR = 1.5, optimalRate = 1.2;
    let feedRate = optimalRate * (sgr / optimalSGR);
    if (avgWeightG > 100) feedRate *= Math.pow(avgWeightG / 100, -0.15);
    if (avgWeightG > 500) feedRate *= Math.pow(avgWeightG / 500, -0.1);
    feedRate = Math.max(0.2, Math.min(feedRate, 5.0));
    steps.push({ step: 2, title: 'SGR→投喂率映射', formula: 'F=1.2%×(SGR/1.5)×(W/100)^(-0.15)', input: `SGR=${sgr.toFixed(2)}%,体重=${avgWeightG}g`, result: `推算投喂率=${feedRate.toFixed(3)}%`, source: '孙国祥2014最优参数+FAO', detail: '以15℃/100g为基准等比缩放' });
    let finalRate = feedRate;
    if (doLevel < 9) {
      const old = finalRate;
      const doF = this._sigmoidDO(doLevel, 66, waterTemp);
      finalRate *= doF;
      const satRef = this._doPercentToMgL(66, waterTemp);
      steps.push({ step: 3, title: '溶氧修正(Sigmoid)', formula: `DOmaxFI=66%≈${satRef.toFixed(1)}mg/L`, input: `DO=${doLevel}mg/L`, result: `${old.toFixed(3)}%×${doF.toFixed(3)}=${finalRate.toFixed(3)}%`, source: 'Remen2016', detail: `饱和≈${(14.6-0.4*waterTemp).toFixed(1)}mg/L` });
    }
    if (waterTemp > 20) {
      const old = finalRate;
      finalRate *= 1 - 0.035 * (waterTemp - 20);
      steps.push({ step: 4, title: '高温修正(>20℃)', formula: '修正=1-0.035×(T-20)', input: `T=${waterTemp}℃`, result: `${old.toFixed(3)}%×${(1-0.035*(waterTemp-20)).toFixed(3)}=${finalRate.toFixed(3)}%`, source: '养殖通用规则', detail: '' });
    }
    const daily = bwKg * count * (finalRate / 100);
    steps.push({ step: 5, title: '日投喂量计算', formula: '日投喂量=体重×数量×投喂率', input: `${bwKg.toFixed(3)}kg×${count}尾×${finalRate.toFixed(3)}%`, result: `日投喂量=${daily.toFixed(2)}kg`, source: '', detail: `单尾增重≈${dailyGain.toFixed(1)}g/天` });
    const nKg = 2.10e-4 * finalRate + 4.94e-4 * Math.pow(bwKg, 1.0117);
    const pKg = 3.69e-4 * finalRate + 2.61e-4 * Math.pow(bwKg, 0.7605);
    steps.push({ step: 6, title: '🌍氮磷排放估算', formula: 'No=2.10e-4F+4.94e-4W^1.0117;Po=3.69e-4F+2.61e-4W^0.7605', input: `F=${finalRate.toFixed(3)}%,W=${bwKg.toFixed(3)}kg`, result: `氮:${nKg.toFixed(4)}kg/d | 磷:${pKg.toFixed(4)}kg/d`, source: '孙国祥2014博士论文', detail: `偏离度:N17.93%,P23.65%` });
    return this._finalize(finalRate, bwKg, count, waterTemp, doLevel, steps, 'SGR生长模型法');
  },

  // ====== 主入口 ======
  calculate(params) {
    const { avgWeight, count, waterTemp, doLevel } = params;
    const r1 = this.methodTable(avgWeight, waterTemp, doLevel, count);
    const r2 = this.methodScience(avgWeight, waterTemp, doLevel, count);
    const r3 = this.methodGrowth(avgWeight, waterTemp, doLevel, count);
    const rates = [r1.feedingRate, r2.feedingRate, r3.feedingRate].sort((a,b)=>a-b);
    const recommended = rates[1];
    return {
      dailyFeed: r2.dailyFeed, feedPerMeal: r2.feedPerMeal,
      feedingRate: recommended, mealsPerDay: r2.mealsPerDay, mealTimes: r2.mealTimes,
      warnings: [...new Set([...r1.warnings,...r2.warnings,...r3.warnings])],
      methods: {
        table: { label: '📊 查表插值法', source: '虹鳟投饲率表(教材)', rate: r1.feedingRate, daily: r1.dailyFeed, steps: r1.steps },
        science: { label: '🔬 科研模型法', source: 'Azevedo2026+Remen2016', rate: r2.feedingRate, daily: r2.dailyFeed, steps: r2.steps },
        growth: { label: '📈 SGR生长法', source: 'FAO+孙国祥2014', rate: r3.feedingRate, daily: r3.dailyFeed, steps: r3.steps },
      },
      recommendedMethod: '中位数综合推荐', inputs: params,
    };
  },

  calcFCR(tf, wg) { return wg > 0 ? Math.round((tf/wg)*100)/100 : 0; },
  assessWaterQuality(t, d, ph, a) {
    const i = [];
    if (t < 2 || t > 22) i.push('水温异常');
    if (d < 6) i.push('溶氧不足'); else if (d < 9) i.push('溶氧偏低');
    if (ph < 6 || ph > 8.5) i.push('pH异常');
    if (a > 0.6) i.push('氨氮超标');
    return { status: i.length===0?'normal':i.length<=2?'warning':'critical', issues: i };
  },
};

if (typeof module !== 'undefined' && module.exports) { module.exports = FeedingEngine; }
