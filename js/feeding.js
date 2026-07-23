// ================================================================
// feeding.js — 投喂计算引擎 v2.0 (数学插值 + 科研模型)
// 基于: 孙国祥2014, Remen2016, Azevedo2026
// ================================================================

const FeedingEngine = {

  // ---- 内部工具 ----
  _lerp(x, x0, x1, y0, y1) {
    if (x1 === x0) return y0;
    return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  },

  // 二维插值: 在二维表中查找/插值
  _interpolate2D(xVal, xArr, yVal, yArr, table) {
    // 找到 x 的包围区间
    let xLo = 0, xHi = xArr.length - 1;
    for (let i = 0; i < xArr.length; i++) {
      if (xArr[i] <= xVal) xLo = i;
      if (xArr[i] >= xVal) { xHi = i; break; }
    }
    if (xLo > xHi) xHi = xLo;

    // 找到 y 的包围区间
    let yLo = 0, yHi = yArr.length - 1;
    for (let i = 0; i < yArr.length; i++) {
      if (yArr[i] <= yVal) yLo = i;
      if (yArr[i] >= yVal) { yHi = i; break; }
    }
    if (yLo > yHi) yHi = yLo;

    // 双线性插值
    const f00 = table[xLo][yLo];
    const f01 = table[xLo][yHi];
    const f10 = table[xHi][yLo];
    const f11 = table[xHi][yHi];

    const fx0 = this._lerp(xVal, xArr[xLo], xArr[xHi], f00, f10);
    const fx1 = this._lerp(xVal, xArr[xLo], xArr[xHi], f01, f11);
    return this._lerp(yVal, yArr[yLo], yArr[yHi], fx0, fx1);
  },

  // Sigmoid 溶氧修正函数 (Azevedo et al., 2026)
  _sigmoidDO(doLevel, doMax) {
    // h(DO) = 1 / (1 + exp(-k*(DO - DO_half)))
    // DO_half 取 doMax 的 60%
    const doHalf = doMax * 0.6;
    const k = 0.5;
    return 1.0 / (1.0 + Math.exp(-k * (doLevel - doHalf)));
  },

  // 异速生长体重修正: FI ∝ BW^β (β ≈ 0.6)
  _allometricScale(weightG, refWeight, baseRate) {
    // 以 refWeight 为基准，按 BW^0.6 缩放
    const beta = 0.6;
    return baseRate * Math.pow(weightG / refWeight, beta - 1);
  },

  // ================================================================
  // 方法一: 二维双线性插值法 (基于虹鳟投饲率表)
  // ================================================================
  methodTableLookup(avgWeightG, waterTemp, doLevel) {
    const tbl = KnowledgeBase.feedingTable;
    const steps = [];

    // Step 1: 二维插值查表
    const baseRate = this._interpolate2D(
      waterTemp, tbl.temps,
      avgWeightG, tbl.weightLevels,
      tbl.rates
    );
    steps.push({
      step: 1, title: '二维双线性插值查表',
      formula: '在虹鳟投饲率表中, 根据(水温,体重)做双线性插值',
      input: `水温=${waterTemp}℃, 体重=${avgWeightG}g`,
      result: `基准投饲率 = ${baseRate.toFixed(3)}%`,
      source: '《水产动物营养与饲料学》虹鳟投饲率表',
      detail: `水温区间 [${tbl.temps[0]}~${tbl.temps[tbl.temps.length-1]}]℃, 体重 0~999g 全覆盖`,
    });

    return this._applyCorrections(baseRate, avgWeightG, waterTemp, doLevel, steps,
      '二维查表法: 虹鳟投饲率表 + 双线性插值');
  },

  // ================================================================
  // 方法二: 科研模型法 (Azevedo + Remen 综合模型)
  // FI(BW, T, DO) = α × BW^β × e^(γ×T) × h(DO)
  // ================================================================
  methodScientificModel(avgWeightG, waterTemp, doLevel, fishCount) {
    const steps = [];

    // 参数 (来自 Azevedo et al. 2026 对大西洋鲑的标定)
    const alpha = 0.015;   // 缩放因子
    const beta = 0.6;      // 异速生长指数
    const gamma = 0.06;    // 温度敏感系数

    // Step 1: 基础代谢 FI = α × BW^β
    const bwKg = avgWeightG / 1000;
    const baseFI = alpha * Math.pow(bwKg, beta);
    steps.push({
      step: 1, title: '异速生长模型 FI = α × BW^β',
      formula: `FI_base = ${alpha} × (${bwKg}kg)^${beta}`,
      input: `体重=${avgWeightG}g (${bwKg.toFixed(3)}kg)`,
      result: `基础FI = ${baseFI.toFixed(4)} kg/尾/天`,
      source: 'Azevedo et al., 2026 (Aquaculture)',
      detail: `α=${alpha}, β=${beta} (异速生长指数)`,
    });

    // Step 2: 温度修正 e^(γ×T)
    const tempFactor = Math.exp(gamma * waterTemp);
    const tempFI = baseFI * tempFactor;
    steps.push({
      step: 2, title: '温度修正 exp(γ×T)',
      formula: `exp(${gamma} × ${waterTemp}℃) = ${tempFactor.toFixed(4)}`,
      input: `水温=${waterTemp}℃`,
      result: `温度修正后 FI = ${baseFI.toFixed(4)} × ${tempFactor.toFixed(4)} = ${tempFI.toFixed(4)} kg/尾/天`,
      source: 'Azevedo et al., 2026',
      detail: `γ=${gamma} (温度敏感系数), e^(γT) 反映代谢加速`,
    });

    // Step 3: 溶氧修正 h(DO) (Sigmoid 函数)
    const doMax = waterTemp >= 15 ? 66 : waterTemp >= 10 ? 53 : 42;
    const doFactor = this._sigmoidDO(doLevel, doMax);
    const finalFI = tempFI * doFactor;
    steps.push({
      step: 3, title: '溶氧修正 h(DO) — Sigmoid 饱和函数',
      formula: `h(DO) = 1/(1+exp(-0.5×(DO-${(doMax*0.6).toFixed(1)}))) = ${doFactor.toFixed(4)}`,
      input: `溶氧=${doLevel}mg/L, DOmax=${doMax}%`,
      result: `最终FI = ${tempFI.toFixed(4)} × ${doFactor.toFixed(4)} = ${finalFI.toFixed(4)} kg/尾/天`,
      source: 'Remen et al., 2016 + Azevedo et al., 2026',
      detail: `DOmaxFI(${waterTemp}℃)=${doMax}%, h(DO)用Sigmoid平滑过渡`,
    });

    // 每日投喂量
    const dailyFeedKg = finalFI * fishCount;
    const feedRatePercent = (finalFI / bwKg) * 100;

    steps.push({
      step: 4, title: '总量换算',
      formula: `日投喂量 = FI × 数量`,
      input: `单尾FI=${finalFI.toFixed(4)}kg, 数量=${fishCount}尾`,
      result: `日投喂量 = ${dailyFeedKg.toFixed(2)} kg (投饲率 ${feedRatePercent.toFixed(3)}%)`,
      source: '综合计算',
      detail: `折合日投饲率 = ${feedRatePercent.toFixed(3)}% 体重/天`,
    });

    return this._finalize(dailyFeedKg, feedRatePercent, waterTemp, doLevel, steps,
      '科研模型法: Azevedo2026 FI(BW,T,DO) + Remen2016 DOmaxFI');
  },

  // ================================================================
  // 方法三: 生长模型反推法 (孙国祥 2014)
  // G = -0.023F×lnW + 0.224F - 0.016lnW + 0.682
  // 反解 F (投喂率%) = (G + 0.016lnW - 0.682) / (0.224 - 0.023lnW)
  // ================================================================
  methodGrowthModel(avgWeightG, waterTemp, doLevel, fishCount) {
    const steps = [];
    const bwKg = avgWeightG / 1000;
    const lnW = Math.log(bwKg);

    // 目标日增重 (根据水温估算, g/天)
    const targetGrowth = 0.5 + (waterTemp - 5) * 0.08;

    steps.push({
      step: 1, title: '设定目标日增重',
      formula: `目标增重 = 0.5 + (T-5)×0.08`,
      input: `水温=${waterTemp}℃`,
      result: `目标SGR ≈ ${targetGrowth.toFixed(2)} g/天`,
      source: '经验估算',
      detail: '可根据实际期望调整目标值',
    });

    // 反解投喂率 F
    const G = targetGrowth / avgWeightG; // 转为增长率
    const denominator = 0.224 - 0.023 * lnW;
    let feedRate;
    if (denominator > 0.01) {
      feedRate = (G + 0.016 * lnW - 0.682) / denominator;
    } else {
      feedRate = 1.0; // fallback
    }
    feedRate = Math.max(0.1, Math.min(feedRate, 5.0));

    steps.push({
      step: 2, title: '生长模型反解投喂率',
      formula: 'F = (G + 0.016lnW - 0.682) / (0.224 - 0.023lnW)',
      input: `G=${G.toFixed(4)}, lnW=${lnW.toFixed(4)}`,
      result: `推算投喂率 = ${feedRate.toFixed(3)}%`,
      source: '孙国祥 2014 博士论文 (中科院海洋所)',
      detail: `基于大西洋鲑循环水养殖实验数据标定`,
    });

    // 溶氧修正
    let finalRate = feedRate;
    if (doLevel < 9) {
      const doOld = finalRate;
      const doFactor = this._sigmoidDO(doLevel, 66);
      finalRate *= doFactor;
      steps.push({
        step: 3, title: '溶氧修正 (Sigmoid)',
        formula: `h(DO) = sigmoid(DO, DOmax=66%)`,
        input: `溶氧=${doLevel}mg/L`,
        result: `${doOld.toFixed(3)}% × ${doFactor.toFixed(3)} = ${finalRate.toFixed(3)}%`,
        source: 'Remen et al., 2016',
        detail: `Sigmoid平滑过渡, 避免阈值突变`,
      });
    }

    // 高温修正
    if (waterTemp > 20) {
      const oldRate = finalRate;
      finalRate *= (1 - 0.035 * (waterTemp - 20));
      steps.push({
        step: 4, title: '高温修正 (>20℃)',
        formula: `修正 = 1 - 0.035×(T-20)`,
        input: `水温=${waterTemp}℃`,
        result: `${oldRate.toFixed(3)}% × ${(1-0.035*(waterTemp-20)).toFixed(3)} = ${finalRate.toFixed(3)}%`,
        source: '水产养殖通用规则',
        detail: '每升高1℃减3.5%',
      });
    }

    const dailyFeedKg = bwKg * fishCount * (finalRate / 100);

    steps.push({
      step: 5, title: '日投喂量计算',
      formula: '日投喂量 = 体重×数量×投喂率',
      input: `${bwKg.toFixed(3)}kg × ${fishCount}尾 × ${finalRate.toFixed(3)}%`,
      result: `日投喂量 = ${dailyFeedKg.toFixed(2)} kg`,
      source: '综合计算',
      detail: '',
    });

    // 氮磷排放估算
    const nitrogenKg = 2.10e-4 * finalRate + 4.94e-4 * Math.pow(bwKg, 1.0117);
    const phosphorusKg = 3.69e-4 * finalRate + 2.61e-4 * Math.pow(bwKg, 0.7605);
    steps.push({
      step: 6, title: '环境影响评估 (氮磷排放)',
      formula: 'No = 2.10e-4F + 4.94e-4W^1.0117; Po = 3.69e-4F + 2.61e-4W^0.7605',
      input: `F=${finalRate.toFixed(3)}%, W=${bwKg.toFixed(3)}kg`,
      result: `氮排放: ${nitrogenKg.toFixed(4)} kg/d, 磷排放: ${phosphorusKg.toFixed(4)} kg/d`,
      source: '孙国祥 2014 博士论文',
      detail: `模型偏离度: N=17.93%, P=23.65%`,
    });

    return this._finalize(dailyFeedKg, finalRate, waterTemp, doLevel, steps,
      '生长模型反推法: 孙国祥2014 生长-G-F模型 + 氮磷排放');
  },

  // ---- 共用输出构建 ----
  _applyCorrections(baseRate, avgWeightG, waterTemp, doLevel, steps, methodName) {
    let finalRate = baseRate;

    // 高温修正
    if (waterTemp > 20) {
      const old = finalRate;
      const corr = 1 - 0.035 * (waterTemp - 20);
      finalRate *= corr;
      steps.push({
        step: steps.length + 1, title: '高温修正 (>20℃)',
        formula: '修正系数 = 1 - 0.035×(T-20)',
        input: `水温=${waterTemp}℃, 超温=${(waterTemp-20).toFixed(1)}℃`,
        result: `${old.toFixed(3)}% × ${corr.toFixed(3)} = ${finalRate.toFixed(3)}%`,
        source: '水产养殖通用规则',
        detail: '每升1℃减3.5%, 基于代谢率-温度关系',
      });
    }

    // 大鱼修正 (>10g 取 84%)
    if (avgWeightG > 10) {
      const old = finalRate;
      finalRate *= 0.84;
      steps.push({
        step: steps.length + 1, title: '大鱼修正 (>10g取84%)',
        formula: '修正系数 = 0.84 (经验值)',
        input: `体重=${avgWeightG}g > 10g`,
        result: `${old.toFixed(3)}% × 0.84 = ${finalRate.toFixed(3)}%`,
        source: '虹鳟投饲率表附注',
        detail: '大鱼代谢率下降, 需减量避免浪费',
      });
    }

    // 溶氧修正
    if (doLevel < 9) {
      const old = finalRate;
      const doFactor = this._sigmoidDO(doLevel, 66);
      finalRate *= doFactor;
      steps.push({
        step: steps.length + 1, title: '溶氧修正 (Sigmoid函数)',
        formula: `h(DO) = sigmoid(DO, DOmax=66%)`,
        input: `溶氧=${doLevel}mg/L`,
        result: `${old.toFixed(3)}% × ${doFactor.toFixed(3)} = ${finalRate.toFixed(3)}%`,
        source: 'Azevedo et al., 2026 (Sigmoid模型)',
        detail: '平滑过渡, 避免查表法的阶梯跳变',
      });
    }

    const bwKg = avgWeightG / 1000;
    const dailyFeedKg = bwKg * 1000 * (finalRate / 100); // 按1000尾标准化
    const feedRate = finalRate;

    return this._finalize(dailyFeedKg, feedRate, waterTemp, doLevel, steps, methodName);
  },

  _finalize(dailyFeedKg, feedRate, waterTemp, doLevel, steps, methodName) {
    const mealsPerDay = waterTemp >= 10 ? 3 : 2;
    const feedPerMeal = dailyFeedKg / mealsPerDay;

    const warnings = [];
    if (waterTemp < 2 || waterTemp > 22) warnings.push('🚨 水温超出三文鱼适宜范围(2~22℃)');
    if (doLevel < 4) warnings.push('🚨 溶氧<4mg/L, 鱼类停食风险');
    else if (doLevel < 7) warnings.push('⚡ 溶氧偏低(<7mg/L), 投喂量已下调');
    if (feedRate > 4) warnings.push('⚠️ 投饲率偏高(>4%), 请核实参数');

    return {
      method: methodName,
      dailyFeed: Math.round(dailyFeedKg * 1000) / 1000,
      feedPerMeal: Math.round(feedPerMeal * 1000) / 1000,
      feedingRate: Math.round(feedRate * 1000) / 1000,
      mealsPerDay,
      mealTimes: mealsPerDay === 3
        ? ['8:00-10:00', '12:00-13:00', '17:00-18:00']
        : ['8:00-10:00', '17:00-18:00'],
      steps,
      warnings,
      inputs: { waterTemp, doLevel },
    };
  },

  // ---- 主入口: 三法并行对比 ----
  calculate(params) {
    const { avgWeight, count, waterTemp, doLevel, fishType } = params;

    // 方法一: 二维插值
    const r1 = this.methodTableLookup(avgWeight, waterTemp, doLevel);
    r1.dailyFeed = Math.round(r1.dailyFeed * count / 1000 * 1000) / 1000;
    r1.feedPerMeal = Math.round(r1.dailyFeed / r1.mealsPerDay * 1000) / 1000;

    // 方法二: 科研模型
    const r2 = this.methodScientificModel(avgWeight, waterTemp, doLevel, count);

    // 方法三: 生长模型反推
    const r3 = this.methodGrowthModel(avgWeight, waterTemp, doLevel, count);

    // 加权平均推荐值 (三种方法取中位数)
    const allRates = [r1.feedingRate, r2.feedingRate, r3.feedingRate].sort((a,b)=>a-b);
    const recommended = allRates[1]; // 中位数

    return {
      // 推荐值
      dailyFeed: r2.dailyFeed,  // 科研模型为主要推荐
      feedPerMeal: r2.feedPerMeal,
      feedingRate: recommended,
      mealsPerDay: r2.mealsPerDay,
      mealTimes: r2.mealTimes,
      warnings: [...new Set([...r1.warnings, ...r2.warnings, ...r3.warnings])],

      // 三种方法的详细推导
      methods: {
        table: { label: '📊 查表插值法', source: '虹鳟投饲率表 (教材)', rate: r1.feedingRate, daily: r1.dailyFeed, steps: r1.steps },
        science: { label: '🔬 科研模型法', source: 'Azevedo2026 + Remen2016', rate: r2.feedingRate, daily: r2.dailyFeed, steps: r2.steps },
        growth: { label: '📈 生长反推法', source: '孙国祥2014 博士论文', rate: r3.feedingRate, daily: r3.dailyFeed, steps: r3.steps, extras: r3.steps.filter(s=>s.title.includes('排放')) },
      },

      recommendedMethod: '中位数综合推荐',
      inputs: params,
    };
  },

  calcFCR(totalFeed, weightGain) {
    return weightGain > 0 ? Math.round((totalFeed / weightGain) * 100) / 100 : 0;
  },

  assessWaterQuality(temp, doLevel, ph, ammonia) {
    const issues = [];
    if (temp < 2 || temp > 22) issues.push('水温异常 (正常2-22℃)');
    if (doLevel < 6) issues.push('溶氧不足 (<6mg/L)');
    else if (doLevel < 9) issues.push('溶氧偏低 (<9mg/L, 大西洋鲑标准)');
    if (ph < 6 || ph > 8.5) issues.push('pH异常 (正常6-8.5)');
    if (ammonia > 0.6) issues.push('氨氮超标 (>0.6mg/L)');
    return { status: issues.length === 0 ? 'normal' : issues.length <= 2 ? 'warning' : 'critical', issues };
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FeedingEngine;
}
