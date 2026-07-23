// ================================================================
// knowledge.js — 三文鱼养殖领域知识库
// 来源: 《水产动物营养与饲料学》+ CN103766250A 专利
// ================================================================

const KnowledgeBase = {

  // 虹鳟投饲率速查表 [水温][体重级别]
  // 体重级别 (g): 0:<0.18, 1:0.18-1.5, 2:1.5-5.1, 3:5.1-12, 4:12-23,
  //              5:23-39, 6:39-62, 7:62-92, 8:92-130, 9:130-180, 10:>180
  feedingTable: {
    temps: [2, 5, 8, 10, 12, 15, 18, 20],
    weightLevels: [0.18, 1.5, 5.1, 12, 23, 39, 62, 92, 130, 180, 999],
    // 行=水温, 列=体重级别
    rates: [
      [2.1, 1.8, 1.4, 1.0, 1.0, 0.8, 0.7, 0.6, 0.5, 0.5, 0.4], // 2℃
      [2.6, 2.2, 1.8, 1.4, 1.3, 1.1, 0.9, 0.8, 0.7, 0.6, 0.5], // 5℃
      [3.2, 2.8, 2.2, 1.7, 1.6, 1.3, 1.1, 1.0, 0.9, 0.8, 0.7], // 8℃
      [3.9, 3.4, 2.6, 2.1, 2.0, 1.6, 1.4, 1.2, 1.1, 0.9, 0.8], // 10℃
      [4.8, 4.0, 3.2, 2.5, 2.4, 1.9, 1.6, 1.4, 1.3, 1.1, 1.0], // 12℃
      [5.8, 4.8, 3.9, 3.0, 2.8, 2.3, 1.9, 1.7, 1.5, 1.3, 1.3], // 15℃
      [7.0, 5.8, 4.8, 3.7, 3.4, 2.8, 2.2, 2.0, 1.8, 1.6, 1.5], // 18℃
      [7.9, 6.6, 5.5, 4.4, 4.0, 3.2, 2.5, 2.2, 2.0, 1.8, 1.7], // 20℃
    ],
  },

  // 溶氧-摄食率系数
  doTable: {
    levels: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    coefficients: [0, 0.43, 0.64, 0.77, 0.87, 0.93, 0.97, 1.0, 1.0],
  },

  // 水质参数
  waterQuality: {
    tempRange: [2, 22],
    tempOptimal: [12, 18],
    doMin: 9,
    doOptimal: [10, 12],
    phRange: [6, 8],
    ammoniaMax: 0.6,
    nitriteMax: 0.6,
  },

  // 查找投饲率基准值
  lookupFeedingRate(waterTemp, fishWeightG) {
    const src = `《水产动物营养与饲料学》(李爱杰) 虹鳟投饲率表`;
    const table = this.feedingTable;

    // 找到最近的水温行
    let tempRow = 0;
    for (let i = table.temps.length - 1; i >= 0; i--) {
      if (waterTemp >= table.temps[i]) { tempRow = i; break; }
    }
    if (waterTemp < table.temps[0]) tempRow = 0;
    if (waterTemp > table.temps[table.temps.length - 1]) tempRow = table.temps.length - 1;

    // 找到对应的体重列
    let weightCol = 0;
    for (let i = 0; i < table.weightLevels.length; i++) {
      if (fishWeightG <= table.weightLevels[i]) { weightCol = i; break; }
    }

    const rate = table.rates[tempRow][weightCol];
    return {
      rate,
      source: src,
      detail: `水温=${waterTemp}℃ → 查${table.temps[tempRow]}℃行, 体重=${fishWeightG}g → 级别${weightCol}`,
    };
  },

  // 查找溶氧系数
  lookupDOCoefficient(doLevel) {
    const src = '溶氧-摄食率关系表 (鲤科实验数据)';
    const table = this.doTable;
    let idx = 0;
    for (let i = table.levels.length - 1; i >= 0; i--) {
      if (doLevel >= table.levels[i]) { idx = i; break; }
    }
    if (doLevel >= table.levels[table.levels.length - 1]) idx = table.levels.length - 1;
    return {
      coefficient: table.coefficients[idx],
      source: src,
      detail: `溶氧=${doLevel} mg/L → 系数=${table.coefficients[idx]}`,
    };
  },

  // 大规格鱼投饲率 (DB63/T 1042—2011)
  largeFishTable: {
    temps: [4, 10, 16, 20],
    weightRanges: ['100~250g', '250~500g', '>500g'],
    rates: [
      [0.5, 0.4, 0.3],
      [1.1, 0.8, 0.7],
      [1.7, 1.4, 0.8],
      [2.0, 1.7, 0.9],
    ],
  },

  // 大西洋鲑研究参数 (孙国祥 2014)
  atlanticSalmon: {
    optimal: { rate: 1.2, frequency: 4, density: 10 },
    growthModel: 'G = -0.023F×lnW + 0.224F - 0.016lnW + 0.682',
    nitrogenModel: 'No = 2.10×10⁻⁴F + 4.94×10⁻⁴W^1.0117',
    phosphorusModel: 'Po = 3.69×10⁻⁴F + 2.61×10⁻⁴W^0.7605',
  },

  // DOmaxFI 模型 (Remen et al., 2016)
  doMaxFI: {
    temps: [7, 11, 15, 19],
    doMax: [42, 53, 66, 76],
    los: [24, 33, 34, 40],
  },

  // FCR 标准
  fcrStandards: [
    { mode: '循环水RAS', density: '50 kg/m³', fcr: 1.15 },
    { mode: '海上网箱', density: '25 kg/m³', fcr: 1.00 },
    { mode: '流水池', density: '50 kg/m³', fcr: 1.05 },
  ],

  // 疾病知识
  diseases: [
    { name: '细菌性鳃病', symptom: '鳃部出血、粘液过多', treatment: '0.5%硫酸铜洗浴1-2分钟' },
    { name: '弧菌病', symptom: '体表变黑、出血', treatment: '磺胺类75-100mg/kg饲料/周' },
    { name: 'IPN(胰脏坏死)', symptom: '稚鱼(<1g)感染', treatment: '50mg/L有机碘消毒鱼卵15分钟' },
    { name: 'IHN(造血器坏死)', symptom: '10-20g鱼', treatment: '50mg/L有机碘消毒鱼卵15分钟' },
    { name: '水霉病', symptom: '体表霉菌', treatment: '0.5-1mg/L孔雀石绿洗浴' },
  ],

  // 知识条目列表
  getKnowledgeSources() {
    return [
      { id: 1, title: '虹鳟投饲率速查表', source: '《水产动物营养与饲料学》李爱杰主编', type: '教材' },
      { id: 2, title: '大规格鱼投饲率表', source: 'DB63/T 1042—2011 青海省标准', type: '行业标准' },
      { id: 3, title: '大西洋鲑生长模型', source: '孙国祥 2014 博士论文 (中科院)', type: '学位论文' },
      { id: 4, title: 'DOmaxFI温度依赖模型', source: 'Remen et al., 2016 Aquaculture', type: 'SCI论文' },
      { id: 5, title: '综合FI预测模型(BW,T,DO)', source: 'Azevedo et al., 2026', type: 'SCI论文' },
      { id: 6, title: 'FCR标准(按养殖模式)', source: 'FAO + 行业数据', type: '国际标准' },
      { id: 7, title: '养殖密度标准', source: 'DB63/T 2430—2025 + FAO', type: '行业标准' },
      { id: 8, title: '三文鱼养殖水质标准', source: 'CN103766250A 专利 + GB 11607', type: '专利/国标' },
      { id: 9, title: '疾病防控标准', source: 'NY/T 755—2003', type: '行业标准' },
      { id: 10, title: '高温修正公式', source: '水产养殖通用规则', type: '经验公式' },
      { id: 11, title: '溶氧-摄食率关系', source: '鲤科鱼类实验数据', type: '实验研究' },
      { id: 12, title: '四定三看投喂原则', source: '中国传统养鱼经验', type: '传统经验' },
    ];
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = KnowledgeBase;
}
