// ================================================================
// feeding.js — 投喂计划计算引擎
// ================================================================

const FeedingEngine = {

  // 计算每日投喂量
  calculate(params) {
    const {
      avgWeight,    // 平均鱼体重 (g)
      count,        // 养殖数量
      waterTemp,    // 水温 (℃)
      doLevel,      // 溶氧 (mg/L)
      fishType,     // 鱼种
    } = params;

    const steps = [];
    const warnings = [];

    // Step 1: 查表获取基准投饲率
    const base = KnowledgeBase.lookupFeedingRate(waterTemp, avgWeight);
    steps.push({
      step: 1,
      title: '查表获取基准投饲率',
      input: `水温=${waterTemp}℃, 平均体重=${avgWeight}g`,
      result: `${base.rate}%`,
      source: base.source,
      detail: base.detail,
    });
    let finalRate = base.rate;

    // Step 2: 高温修正
    if (waterTemp > 20) {
      const correction = 1 - 0.035 * (waterTemp - 20);
      const oldRate = finalRate;
      finalRate *= correction;
      steps.push({
        step: 2,
        title: '高温修正 (>20℃)',
        input: `当前水温=${waterTemp}℃`,
        result: `${oldRate}% × ${correction.toFixed(3)} = ${finalRate.toFixed(2)}%`,
        source: '水产养殖通用规则: 每升1℃减3.5%',
        detail: `${waterTemp}℃ - 20℃ = ${waterTemp-20}℃, 修正系数=${correction.toFixed(3)}`,
      });
    }

    // Step 3: 大鱼修正 (10g以上取84%)
    if (avgWeight > 10) {
      const oldRate2 = finalRate;
      finalRate *= 0.84;
      steps.push({
        step: 3,
        title: '大鱼修正 (>10g取84%)',
        input: `鱼体重=${avgWeight}g`,
        result: `${oldRate2.toFixed(2)}% × 0.84 = ${finalRate.toFixed(2)}%`,
        source: '虹鳟投饲率表附注',
        detail: '10g以上鱼取表中投饲率的84%为最佳',
      });
    }

    // Step 4: 溶氧修正
    if (doLevel < 9) {
      const doResult = KnowledgeBase.lookupDOCoefficient(doLevel);
      const oldRate3 = finalRate;
      finalRate *= doResult.coefficient;
      steps.push({
        step: 4,
        title: '溶氧修正 (DO<9mg/L)',
        input: `溶氧=${doLevel} mg/L`,
        result: `${oldRate3.toFixed(2)}% × ${doResult.coefficient} = ${finalRate.toFixed(2)}%`,
        source: doResult.source,
        detail: doResult.detail,
      });
      if (doLevel < 5) {
        warnings.push(`⚠️ 溶氧仅 ${doLevel} mg/L，显著偏低，建议增氧后再投喂`);
      } else if (doLevel < 8) {
        warnings.push(`⚡ 溶氧 ${doLevel} mg/L 偏低，投喂量已下调`);
      }
    }

    // Step 5: 计算最终日投喂量
    const avgWeightKg = avgWeight / 1000;
    const dailyFeed = avgWeightKg * count * (finalRate / 100);
    const feedPerMeal = dailyFeed / (waterTemp >= 10 ? 3 : 2);

    // 投喂频率
    const mealsPerDay = waterTemp >= 10 ? 3 : 2;
    const mealTimes = mealsPerDay === 3
      ? ['8:00-10:00', '12:00-13:00', '17:00-18:00']
      : ['8:00-10:00', '17:00-18:00'];

    // 水质检查
    if (waterTemp < 2 || waterTemp > 22) {
      warnings.push(`🚨 水温 ${waterTemp}℃ 超出三文鱼适宜范围 (2~22℃)，建议暂停投喂`);
    }
    if (doLevel < 4) {
      warnings.push('🚨 溶氧 < 4 mg/L，鱼类摄食严重抑制，建议紧急增氧');
    }

    return {
      dailyFeed: Math.round(dailyFeed * 1000) / 1000,  // kg
      feedPerMeal: Math.round(feedPerMeal * 1000) / 1000,
      feedingRate: Math.round(finalRate * 100) / 100,
      mealsPerDay,
      mealTimes,
      steps,
      warnings,
      inputs: params,
    };
  },

  // 计算 FCR
  calcFCR(totalFeed, weightGain) {
    return weightGain > 0 ? Math.round((totalFeed / weightGain) * 100) / 100 : 0;
  },

  // 水质评估
  assessWaterQuality(temp, doLevel, ph, ammonia) {
    const q = KnowledgeBase.waterQuality;
    const issues = [];
    if (temp < q.tempRange[0] || temp > q.tempRange[1]) issues.push('水温异常');
    if (doLevel < q.doMin) issues.push('溶氧不足');
    if (ph < q.phRange[0] || ph > q.phRange[1]) issues.push('pH异常');
    if (ammonia > q.ammoniaMax) issues.push('氨氮超标');
    return {
      status: issues.length === 0 ? 'normal' : issues.length <= 2 ? 'warning' : 'critical',
      issues,
    };
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FeedingEngine;
}
