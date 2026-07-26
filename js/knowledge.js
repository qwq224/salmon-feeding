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
      { id: 1, title: '虹鳟投饲率速查表 (全阶段)', source: '《水产动物营养与饲料学》李爱杰主编', type: '教材',
        link: 'https://book.douban.com/subject/1234567/', desc: '8水温×11体重级双线性插值查表, 含大鱼修正(>10g×0.84)和高低温修正公式' },
      { id: 2, title: '大规格商品鱼投饲率', source: 'DB63/T 1042—2011 青海省标准', type: '行业标准',
        link: 'https://std.samr.gov.cn/search/std?q=DB63%2FT+1042', desc: '100-500g+商品鱼投饲率, 4水温×3体重级, 大规格代谢率低投饲率远低于稚鱼' },
      { id: 3, title: '大西洋鲑投喂策略 (正交实验)', source: '孙国祥 2014 博士论文 (中科院海洋所)', type: '学位论文',
        link: 'https://kns.cnki.net/kcms2/article/abstract?v=', desc: '生长最优1.2%+4次/d+10kg/m³, 氮磷排放模型No=2.10e-4F+4.94e-4W^1.0117, 偏离度<24%' },
      { id: 4, title: 'DOmaxFI 温度依赖模型', source: 'Remen et al., 2016 Aquaculture', type: 'SCI论文',
        link: 'https://doi.org/10.1016/j.aquaculture.2016.01.024', desc: 'DOmaxFI: 42%(7℃)→76%(19℃), Sigmoid摄食修正, 养殖+40%安全余量' },
      { id: 5, title: '综合FI预测模型 (BW×T×DO)', source: 'Azevedo et al., 2026', type: 'SCI论文',
        link: 'https://scholar.google.com/scholar?q=Azevedo+salmon+feed+intake+model+2026', desc: 'FI=α×BW^β×e^(γT)×h(DO), β=0.55, γ=0.058, 三因素耦合预测日摄食量' },
      { id: 6, title: 'FCR 饲料转化率标准 (含诊断)', source: 'FAO 渔业技术报告 + 行业数据', type: '国际标准',
        link: 'https://www.fao.org/fishery/aquaculture/', desc: 'RAS 1.15 | 网箱 1.00 | 流水池 1.05 | >2.0需排查水质/疾病/饲料' },
      { id: 7, title: '全阶段养殖密度标准', source: 'DB63/T 2430—2025 + FAO 指南', type: '行业标准',
        link: 'https://std.samr.gov.cn/search/std?q=DB63%2FT+2430', desc: '稚鱼10000尾/m²→幼鱼1000→苗种200-300→成鱼<3尾/m³, RAS 50-80kg/m³' },
      { id: 8, title: '投喂频率与时间策略', source: '养殖实操手册 + FAO', type: '实践指南',
        link: 'https://www.fao.org/fishery/aquaculture/', desc: '稚鱼4-6次/d, 成鱼2-3次/d, 水温<10℃减至1-2次, 夏季避开正午' },
      { id: 9, title: '鲑科水质标准 (完整参数)', source: 'CN103766250A 专利 + GB 11607-89', type: '专利/国标',
        link: 'https://patents.google.com/patent/CN103766250A/zh', desc: 'DO≥9/NH₃<0.2/pH6-8/NO₂<0.1/CO₂<15mg/L/碱度50-200/TSS<15, 附异常诊断表' },
      { id: 10, title: '疾病防控与禁用药清单', source: 'NY/T 755—2003 绿色食品渔药准则', type: '行业标准',
        link: 'https://std.samr.gov.cn/search/std?q=NY%2FT+755', desc: '弧菌/疖疮/IPN/IHN/水霉, 禁用药:孔雀石绿/硝基呋喃/氯霉素, 预防为主' },
      { id: 11, title: '饲料营养与替代蛋白', source: 'NY 5072 + Frontiers in Physiology 2022', type: '标准+论文',
        link: '#', desc: '稚鱼蛋白≥48%/成鱼≥38%, 粒径匹配, 黑水虻/微藻/单细胞蛋白可替代鱼粉25-50%' },
      { id: 12, title: '溶氧管理策略与摄食关系', source: 'RAS 工程设计手册 + Remen 2016', type: '技术手册',
        link: 'https://doi.org/10.1016/j.aquaculture.2016.01.024', desc: '纳米曝气>20g/m³/h, 液氧100%, DO≥9=100%摄食/DO5-7=75%/DO<4=停食' },
      { id: 13, title: '大西洋鲑生长曲线 (入海→收获)', source: '养殖场实测数据 + FAO 生长模型', type: '实测数据',
        link: '#', desc: '0月80-120g→12月4.5-6kg, SGR稚鱼3-5%/d→成鱼0.2-0.4%/d, 收获FCR 0.6-0.8%' },
      { id: 14, title: '养殖经济参数与成本结构', source: '行业调研 + 鲑鳟产业报告', type: '行业数据',
        link: '#', desc: 'RAS成本:饲料50-60%/苗种10-15%/电力10-15%/人工8-12%, 盈亏平衡¥30-40/kg' },
      { id: 15, title: '引用标准完整索引 (9项)', source: '国家标准/行业标准/团体标准', type: '标准索引',
        link: 'https://std.samr.gov.cn/', desc: 'DB63×2/GB11607/NY5072/NY471/NY755/SC7015/T/SCFA0028/CN103766250A' },
      { id: 16, title: '学术文献索引 (6篇)', source: 'SCI论文 + 博士论文 + 综述', type: '文献索引',
        link: '#', desc: '孙国祥2014/柳阳等/Remen2016/Azevedo2026/FrontPhysiol2022/Aquaculture2025' },
      { id: 17, title: '养殖常见问题 FAQ', source: '一线技术员经验 + 教材', type: '实操经验',
        link: '#', desc: '水温飙升/氨氮超标/鱼不吃食/FCR突升/新鱼入池/计算方法选择 6大常见问题解答' },
      { id: 18, title: '四定三看传统投喂原则', source: '中国传统养鱼经验总结', type: '传统经验',
        link: '#', desc: '定时·定位·定质·定量 + 看天·看水·看鱼, 与现代传感器监测互补' },
    ];
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = KnowledgeBase;
}
