// ================================================================
// crawler.js — 水产养殖文档自动采集器
// 从多个可达数据源抓取文档，自动入库
// ================================================================

const { ingestURL, ingestText } = require('./doc-pipeline');
const vstore = require('./vector-store');
const { embedBatch } = require('./embedder');
const fs = require('fs');
const path = require('path');

// ============ 可访问数据源配置 ============

const SOURCES = {
  // NOAA Fisheries — 美国海洋渔业局
  noaa: {
    name: 'NOAA Fisheries',
    baseURL: 'https://www.fisheries.noaa.gov',
    pages: [
      {
        url: 'https://www.fisheries.noaa.gov/topic/aquaculture',
        title: 'NOAA Aquaculture Overview',
        tags: ['NOAA', '美国', '渔业政策', '水产养殖'],
      },
      {
        url: 'https://www.fisheries.noaa.gov/national/aquaculture/aquaculture-grants-and-funding',
        title: 'NOAA Aquaculture Funding Programs',
        tags: ['NOAA', '资金', '研发'],
      },
      {
        url: 'https://www.fisheries.noaa.gov/national/aquaculture/ aquaculture-policy-and-regulations',
        title: 'NOAA Aquaculture Policy',
        tags: ['NOAA', '政策', '法规'],
      },
    ],
  },

  // Global Seafood Alliance — 全球海产联盟
  gsa: {
    name: 'Global Seafood Alliance',
    baseURL: 'https://www.globalseafood.org',
    pages: [
      {
        url: 'https://www.globalseafood.org/advocate/category/responsible-aquaculture/',
        title: 'GSA Responsible Aquaculture Articles',
        tags: ['GSA', '负责任养殖', '认证', 'BAP'],
      },
      {
        url: 'https://www.globalseafood.org/advocate/category/aquafeeds/',
        title: 'GSA Aquafeeds & Nutrition',
        tags: ['GSA', '饲料', '营养', '投喂'],
      },
      {
        url: 'https://www.globalseafood.org/advocate/category/animal-welfare/',
        title: 'GSA Animal Welfare in Aquaculture',
        tags: ['GSA', '动物福利', '健康'],
      },
    ],
  },

  // FAO 水产养殖文档
  fao: {
    name: 'FAO Fisheries',
    baseURL: 'https://www.fao.org',
    pages: [
      {
        url: 'https://www.fao.org/fishery/aquaculture/en',
        title: 'FAO Aquaculture Portal',
        tags: ['FAO', '国际组织', '水产养殖'],
      },
      {
        url: 'https://www.fao.org/fishery/en/collection/aquaculture',
        title: 'FAO Aquaculture Document Collection',
        tags: ['FAO', '文档', '技术'],
      },
    ],
  },

  // Semantic Scholar 学术论文搜索
  semanticscholar: {
    name: 'Semantic Scholar',
    baseURL: 'https://api.semanticscholar.org',
    queries: [
      'salmon+feeding+strategy+aquaculture',
      'salmon+feed+conversion+ratio+FCR',
      'atlantic+salmon+water+quality+management',
      'rainbow+trout+feeding+rate+optimization',
      'aquaculture+RAS+recirculating+system',
      'salmon+disease+prevention+treatment',
      'fish+feed+protein+nutrition+salmon',
      'salmon+growth+model+temperature+dissolved+oxygen',
    ],
  },
};

// ============ 内置知识文档 (直接从养殖知识库生成，丰富覆盖面) ============

const BUILTIN_DOCS = [
  {
    title: '三文鱼养殖水质管理完全手册',
    type: 'manual',
    author: 'SalmonFeeding 知识工程组',
    tags: ['水质', '管理', '监测', '溶氧', '氨氮', 'pH'],
    content: `# 三文鱼养殖水质管理完全手册

## 第一章：水质参数标准

### 1.1 核心水质指标

| 参数 | 最佳范围 | 警戒范围 | 危险范围 | 测量频率 |
|------|---------|---------|---------|---------|
| 溶解氧 (DO) | ≥9 mg/L | 5-7 mg/L | <5 mg/L | 每日2次 (早晚) |
| 水温 | 12-18℃ | 2-12℃ / 18-20℃ | <2℃ / >22℃ | 连续监测 |
| pH | 7.0-7.5 | 6.0-7.0 / 7.5-8.5 | <6.0 / >8.5 | 每日1次 |
| 氨氮 (NH₃-N) | ≤0.1 mg/L | 0.1-0.2 mg/L | >0.6 mg/L | 每周2次 |
| 亚硝酸盐 (NO₂-N) | ≤0.1 mg/L | 0.1-0.5 mg/L | >1.0 mg/L | 每周2次 |
| 硝酸盐 (NO₃-N) | ≤50 mg/L | 50-100 mg/L | >200 mg/L | 每周1次 |
| 碱度 (Alkalinity) | 50-200 mg/L CaCO₃ | 20-50 mg/L | <20 mg/L | 每周1次 |
| CO₂ | ≤15 mg/L | 15-30 mg/L | >30 mg/L | 每周1次 |
| TSS (总悬浮物) | ≤15 mg/L | 15-40 mg/L | >40 mg/L | 每周1次 |

### 1.2 溶氧管理策略

**DO 对摄食的影响 (Remen 2016 DOmaxFI 模型)**:

DOmaxFI 是鱼类达到最大摄食量所需的最低溶氧浓度。其值随水温升高而增加：

| 水温 | DOmaxFI (%饱和度) | DOmaxFI (mg/L, 淡水) | 半饱和点 (mg/L) |
|------|-------------------|---------------------|----------------|
| 7℃ | 42% | 5.5 | 3.3 |
| 11℃ | 53% | 6.2 | 3.7 |
| 15℃ | 66% | 6.8 | 4.1 |
| 19℃ | 76% | 6.9 | 4.1 |

**Sigmoid 摄食响应函数**:
h(DO) = 1.0 / (1.0 + exp(-k × (DO_actual - DO_half)))
其中 k = 0.8, DO_half = DOmaxFI × 0.6

**增氧方案梯度**:
1. 正常 (DO≥9): 标准曝气，维持现状
2. 偏低 (DO 7-9): 增加曝气量20%，检查曝气头
3. 不足 (DO 5-7): 全负荷曝气 + 启动纯氧补充 + 减少投喂30%
4. 危急 (DO<5): 立即停食 + 全负荷增氧 + 纯氧 + 大换水50%

## 第二章：氨氮管理

### 2.1 氨氮来源与转化

养殖水体中氨氮主要来源:
1. 鱼类代谢排泄 (占60-70%): 蛋白质代谢产生NH₃, 通过鳃排出
2. 残饵分解 (占20-25%): 未被摄食的饲料蛋白质分解
3. 粪便分解 (占10-15%): 鱼类粪便中有机氮矿化

### 2.2 硝化系统管理

**生物滤池硝化过程**:
NH₃ → (Nitrosomonas) → NO₂⁻ → (Nitrobacter) → NO₃⁻

**硝化速率影响因素**:
- 水温: 最适25-30℃, 低于10℃速率减半
- pH: 最适7.5-8.5, 低于6.5显著抑制
- 碱度: 每氧化1g NH₃-N消耗7.14g CaCO₃碱度
- DO: 需维持≥4mg/L, 低于2mg/L硝化停止

### 2.3 氨氮超标应急方案

| 超标程度 | NH₃-N浓度 | 应急措施 |
|---------|-----------|---------|
| 轻度 | 0.2-0.4 mg/L | 减少投喂15%, 增加换水20%/d |
| 中度 | 0.4-0.6 mg/L | 停食1天, 换水40%/d, 添加沸石粉1kg/m³ |
| 重度 | 0.6-1.0 mg/L | 停食2-3天, 换水50%/d, 检查生物滤池 |
| 危急 | >1.0 mg/L | 立即停食, 大换水80%+, 排查死鱼, 考虑紧急出鱼 |

## 第三章：pH与碱度管理

### 3.1 pH 对鱼类的影响

- pH 6.5-7.0: 轻度应激, 摄食略降
- pH 6.0-6.5: 鳃组织损伤, 摄食减少30-50%
- pH <5.5: 酸中毒, 鳃大量分泌粘液, 死亡率上升
- pH 8.5-9.0: 游离氨(NH₃)占比急剧上升, 毒性增加5-10倍
- pH >9.0: 鳃上皮细胞脱落, 高死亡率

### 3.2 碱度缓冲体系

维持碱度 50-200 mg/L CaCO₃ 是RAS系统稳定运行的关键:
- 补充碳酸氢钠 (NaHCO₃): 每提升1 mg/L碱度, 添加NaHCO₃ 1.68 g/m³
- 补充碳酸钙 (CaCO₃): 缓慢释放, 适合长期缓冲

## 第四章：日常监测制度

### 4.1 监测频率表

| 参数 | 频率 | 工具 | 记录要求 |
|------|------|------|---------|
| 水温 | 连续 | 在线探头 | 自动记录, 报警阈值设置 |
| 溶解氧 | 连续 | 光学DO探头 | 早晚各人工校准1次 |
| pH | 每日1次 | pH计/试纸 | 固定时间(早8点) |
| 氨氮 | 每周2次 | 分光光度计/试剂盒 | 记录TAN + 计算NH₃占比 |
| 亚硝酸盐 | 每周2次 | 分光光度计 | 同氨氮一起测 |
| 碱度 | 每周1次 | 滴定法 | 维持>50 mg/L |
| 鱼体重 | 每2周1次 | 电子秤 | 随机抽样30尾+, 记录CV |

### 4.2 数据记录与分析

建立水质数据库, 每周生成趋势图:
- DO日变化曲线 (凌晨最低点 vs 午后最高点)
- NH₃-N 周趋势 (是否持续上升? → 硝化系统可能崩溃)
- pH 周趋势 (是否持续下降? → 碱度不足, 硝化产酸)
`,
  },
  {
    title: '三文鱼投喂策略与饲料营养技术指南',
    type: 'manual',
    author: 'SalmonFeeding 知识工程组',
    tags: ['投喂', '饲料', '营养', '投饲率', '饲料系数', '生长'],
    content: `# 三文鱼投喂策略与饲料营养技术指南

## 第一章：投饲率计算方法

### 1.1 投饲率的定义

投饲率 (Feeding Rate, %) = 日投喂量(kg) / 存塘鱼总重(kg) × 100%

虹鳟投饲率受两个核心因素影响: 水温 和 鱼体重。

### 1.2 虹鳟全阶段投饲率矩阵

| 水温\\体重 | <0.18g | 0.18-1.5g | 1.5-5.1g | 5.1-12g | 12-23g | 23-39g | 39-62g | 62-92g | 92-130g | 130-180g | >180g |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 2℃ | 2.1 | 1.8 | 1.4 | 1.0 | 1.0 | 0.8 | 0.7 | 0.6 | 0.5 | 0.5 | 0.4 |
| 5℃ | 2.6 | 2.2 | 1.8 | 1.4 | 1.3 | 1.1 | 0.9 | 0.8 | 0.7 | 0.6 | 0.5 |
| 8℃ | 3.2 | 2.8 | 2.2 | 1.7 | 1.6 | 1.3 | 1.1 | 1.0 | 0.9 | 0.8 | 0.7 |
| 10℃ | 3.9 | 3.4 | 2.6 | 2.1 | 2.0 | 1.6 | 1.4 | 1.2 | 1.1 | 0.9 | 0.8 |
| 12℃ | 4.8 | 4.0 | 3.2 | 2.5 | 2.4 | 1.9 | 1.6 | 1.4 | 1.3 | 1.1 | 1.0 |
| 15℃ | 5.8 | 4.8 | 3.9 | 3.0 | 2.8 | 2.3 | 1.9 | 1.7 | 1.5 | 1.3 | 1.3 |
| 18℃ | 7.0 | 5.8 | 4.8 | 3.7 | 3.4 | 2.8 | 2.2 | 2.0 | 1.8 | 1.6 | 1.5 |
| 20℃ | 7.9 | 6.6 | 5.5 | 4.4 | 4.0 | 3.2 | 2.5 | 2.2 | 2.0 | 1.8 | 1.7 |

> 来源: 《水产动物营养与饲料学》(李爱杰主编), 中国农业出版社

### 1.3 修正系数

**大鱼修正 (鱼体重 >10g)**:
当鱼体重大于10g时, 需将表值乘以修正系数 0.84

**高温修正 (水温 >20℃)**:
修正 = 1 - 0.035 × (T - 20)

**低温修正 (水温 <8℃)**:
代谢率大幅降低, 投饲率需额外减少20-30%

## 第二章：饲料营养标准

### 2.1 不同生长阶段饲料规格

| 生长阶段 | 鱼体重(g) | 蛋白(%) | 脂肪(%) | 粒径(mm) | 投喂频率 |
|---------|----------|--------|--------|---------|---------|
| 开口期 | <0.5 | ≥52 | ≥15 | 0.2-0.5 | 8-12次/天 |
| 稚鱼期 | 0.5-10 | ≥48 | ≥18 | 0.5-1.5 | 6-8次/天 |
| 幼鱼期 | 10-50 | ≥45 | ≥20 | 1.5-2.5 | 4-6次/天 |
| 生长期 | 50-200 | ≥42 | ≥22 | 2.5-4.0 | 3-4次/天 |
| 成鱼期 | 200-1000 | ≥38 | ≥25 | 4.0-6.0 | 2-3次/天 |
| 上市期 | >1000 | ≥35 | ≥28 | 6.0-8.0 | 2次/天 |

### 2.2 替代蛋白源

**可替代鱼粉的蛋白源评估**:

| 替代原料 | 最大替代比例 | 蛋白含量 | 注意事项 |
|---------|------------|--------|---------|
| 豆粕 | 25% | 44-48% | 需发酵处理去除抗营养因子 |
| 黑水虻粉 | 30% | 40-45% | 脂肪酸组成需调整 |
| 微藻粉 | 15% | 50-60% | 富含EPA/DHA, 成本较高 |
| 单细胞蛋白 | 20% | 60-70% | 甲烷氧化菌, 欧盟已批准 |
| 磷虾粉 | 50% | 55-60% | 诱食性好, 资源有限 |
| 黄粉虫粉 | 20% | 45-55% | 甲壳素含量需控制 |

### 2.3 饲料质量管理

**存储条件**:
- 温度: ≤25℃ (高温加速脂肪氧化)
- 湿度: ≤65% (防霉变)
- 避光: 避免紫外线破坏维生素
- 期限: 开封后30天内用完

**质量检测指标**:
- 外观: 颗粒均匀, 无霉变结块
- 水中稳定性: 浸泡10分钟后不崩解 (膨化料要求)
- 粉末率: ≤2%
- 黄曲霉毒素: <20 ppb

## 第三章：FCR 饲料转化率优化

### 3.1 FCR 影响因素排序

从对FCR影响最大的因素开始:

1. **溶氧不足** (影响最大): DO<7mg/L, FCR 升高 0.1-0.3
2. **过量投喂**: 残饵直接拉高FCR 0.2-0.5
3. **水温不适**: 偏离12-18℃, 代谢耗能增加
4. **饲料品质差**: 蛋白消化率低, FCR升高0.3+
5. **疾病亚临床**: 能量用于免疫而非生长
6. **密度应激**: >50 kg/m³, 皮质醇升高, 生长减缓

### 3.2 FCR 优化清单

每月检查:
- [ ] 溶氧记录是否<7mg/L 超过2小时/天?
- [ ] 投喂后15分钟是否有残饵?
- [ ] 最近一次称重是否在2周内?
- [ ] 饲料粒径是否匹配当前鱼体重?
- [ ] 饲料是否在保质期内?
- [ ] 抽样解剖: 肠道健康? 肝脏颜色?
- [ ] 日死鱼数量是否在正常范围 (<0.05%/天)?
`,
  },
  {
    title: '三文鱼常见疾病诊断与防控手册',
    type: 'manual',
    author: 'SalmonFeeding 知识工程组',
    tags: ['疾病', '防控', '治疗', '弧菌', 'IPN', '海虱', '疫苗'],
    content: `# 三文鱼常见疾病诊断与防控手册

## 第一章：细菌性疾病

### 1.1 弧菌病 (Vibriosis)

**病原**: 鳗弧菌 (Vibrio anguillarum)、杀鲑弧菌 (V. salmonicida)
**高发条件**: 水温>15℃, 密度应激, 水质恶化
**主要症状**:
- 体表发黑, 鳍基部出血
- 肠道炎性充血, 肛门红肿
- 鳃部苍白 (贫血)
- 急性死亡, 死亡率可达50%+

**治疗方案**:
1. 磺胺类: 75-100 mg/kg 鱼体重/天, 拌饲投喂, 连用7-10天
2. 氟苯尼考: 10 mg/kg 鱼体重/天, 拌饲投喂, 连用5-7天
3. 土霉素: 50-75 mg/kg 鱼体重/天, 拌饲投喂, 连用7-10天

**休药期**: 氟苯尼考14天, 土霉素21天

### 1.2 疖疮病 (Furunculosis)

**病原**: 杀鲑气单胞菌 (Aeromonas salmonicida)
**症状**: 肌肉组织出现疖疮样脓肿, 鳍基部出血
**治疗**: 氟苯尼考 10 mg/kg/天, 连用7天

## 第二章：病毒性疾病

### 2.1 传染性胰脏坏死症 (IPN)

**病原**: IPN 病毒 (Birnaviridae)
**易感群体**: 稚鱼 (<1g 体重), 死亡率可达 90%
**症状**:
- 急性死亡, 无明显外部症状
- 解剖见胰脏坏死、肠道内无食物
- 鱼体色发黑, 螺旋游动

**防控措施**:
1. 鱼卵消毒: 50 mg/L 有机碘, 浸泡15分钟
2. 严格检疫亲鱼 (筛查IPN携带者)
3. 降低养殖密度
4. 提高水温至16-18℃可降低死亡率

### 2.2 传染性造血器官坏死症 (IHN)

**病原**: IHN 病毒 (Rhabdoviridae)
**易感群体**: 幼鱼 (10-20g)
**症状**: 体色发黑, 眼球突出, 腹部膨大, 鳃部贫血

### 2.3 鲑鱼贫血症 (ISA)

**病原**: ISA 病毒 (Orthomyxoviridae)
**高发条件**: 海水网箱养殖
**症状**: 鳃丝苍白, 肝脏色淡, 严重贫血 (Hct <10%)
**防控**: 法定报告疫病, 确诊后需全群扑杀

## 第三章：寄生虫病

### 3.1 海虱 (Sea Lice)

**病原**: 鲑疮痂鱼虱 (Lepeophtheirus salmonis)
**危害**:
- 叮咬导致皮肤损伤, 渗透压失调
- 继发细菌感染
- 严重时导致大规模死亡
- 挪威年损失超 5亿美元

**防控方案**:
1. 清洁鱼 (Wrasse/Lumpfish): 生物防控, 每万尾鲑鱼配200-300尾清洁鱼
2. 过氧化氢浴: 1500 mg/L, 浸泡20分钟
3. 温水浴: 30-34℃, 浸泡30秒
4. 药物浴: 依马菌素苯甲酸盐 (Slice®)

### 3.2 阿米巴鳃病 (AGD)

**病原**: 副变形虫 (Neoparamoeba perurans)
**症状**: 鳃丝增厚, 粘液过多, 呼吸急促
**高发**: 水温>14℃, 盐度>30‰
**治疗**: 淡水浴3-4小时, 或过氧化氢 1000 mg/L

## 第四章：疫苗与免疫

### 4.1 常用疫苗程序

| 疫苗类型 | 接种时间 | 方法 | 保护期 |
|---------|---------|------|--------|
| 弧菌+疖疮灭活苗 | 稚鱼 20-30g | 腹腔注射 | 12-18个月 |
| IPN 灭活苗 | 稚鱼 5-10g | 浸泡 | 6-12个月 |
| ISA 灭活苗 | 降海前 50-80g | 腹腔注射 | 12-18个月 |
| PD (胰腺病) 苗 | 降海前 | 腹腔注射 | 12个月 |

### 4.2 疫苗接种操作规范

1. 停食24小时 (减少应激)
2. 麻醉: MS-222 80-100 mg/L
3. 注射部位: 腹鳍基部, 腹腔
4. 针头规格: 23-25G
5. 接种后观察: 2-4小时, 正常摄食后再投喂

## 第五章：禁用药清单

根据 NY/T 755—2003 绿色食品渔药使用准则:

| 禁用药物 | 原因 |
|---------|------|
| 孔雀石绿 | 致癌、致畸、致突变 |
| 硝基呋喃类 (呋喃唑酮等) | 致癌性, 代谢产物残留长 |
| 氯霉素 | 再生障碍性贫血 |
| 己烯雌酚 | 内分泌干扰物 |
| 喹乙醇 | 致突变性 |
`,
  },
];

// ============ 爬虫函数 ============

/**
 * 抓取单个 URL 并入库
 */
async function crawlAndIngest(sourceName, pageInfo, sourceType = 'web_article') {
  console.log(`  🌐 ${pageInfo.url}`);
  try {
    const result = await ingestURL(pageInfo.url, {
      title: pageInfo.title,
      author: sourceName,
      tags: pageInfo.tags || [],
      language: pageInfo.lang || 'en',
      sourceName,
      sourceType,
      sourceUrl: pageInfo.url,
    });

    const chunkTexts = result.chunks.map(c => c.text);
    const embeddings = await embedBatch(chunkTexts);

    const docResult = await vstore.addDocument(result.metadata, result.chunks, embeddings);
    console.log(`    ✅ ${result.title.substring(0, 50)}: ${docResult.chunkCount}块, ${docResult.totalChars}字`);
    return docResult;
  } catch (e) {
    console.log(`    ⚠️ 失败: ${e.message.substring(0, 100)}`);
    return null;
  }
}

/**
 * 摄入内置文档
 */
async function ingestBuiltinDoc(doc) {
  console.log(`  📝 ${doc.title}`);
  try {
    const { ingestText } = require('./doc-pipeline');
    const result = await ingestText(doc.content, {
      title: doc.title,
      author: doc.author,
      sourceType: doc.type,
      sourceName: 'SalmonFeeding 知识库',
      tags: doc.tags,
    });

    const chunkTexts = result.chunks.map(c => c.text);
    const embeddings = await embedBatch(chunkTexts);

    const docResult = await vstore.addDocument(result.metadata, result.chunks, embeddings);
    console.log(`    ✅ ${docResult.chunkCount}块, ${docResult.totalChars}字`);
    return docResult;
  } catch (e) {
    console.log(`    ⚠️ ${e.message}`);
    return null;
  }
}

/**
 * 从 Semantic Scholar 搜索学术论文摘要
 */
async function searchSemanticScholar(query, maxResults = 5) {
  const papers = [];
  try {
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${maxResults}&fields=title,abstract,year,authors,journal,url`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'SalmonFeedingAI/2.0' },
      signal: AbortSignal.timeout(15000),
    });

    if (resp.status === 429) {
      console.log(`    ⏳ 频率限制, 等待5秒...`);
      await new Promise(r => setTimeout(r, 5000));
      return searchSemanticScholar(query, maxResults);
    }

    if (!resp.ok) {
      console.log(`    ⚠️ HTTP ${resp.status}`);
      return papers;
    }

    const data = await resp.json();
    for (const paper of (data.data || [])) {
      if (paper.title && paper.abstract && paper.abstract.length > 100) {
        papers.push({
          title: paper.title,
          abstract: paper.abstract,
          year: paper.year,
          authors: (paper.authors || []).map(a => a.name).join(', '),
          journal: paper.journal?.name || '',
          url: paper.url || `https://api.semanticscholar.org/CorpusID:${paper.paperId}`,
        });
      }
    }
  } catch (e) {
    console.log(`    ⚠️ API 请求失败: ${e.message}`);
  }
  return papers;
}

/**
 * 摄入学术论文摘要
 */
async function ingestPaper(paper) {
  const text = `标题: ${paper.title}\n作者: ${paper.authors}\n期刊: ${paper.journal}\n年份: ${paper.year}\n\n摘要:\n${paper.abstract}`;

  try {
    const result = await ingestText(text, {
      title: paper.title,
      author: paper.authors,
      sourceType: 'paper',
      sourceName: paper.journal || 'Academic Paper',
      sourceUrl: paper.url,
      publishDate: paper.year ? String(paper.year) : '',
      tags: ['学术论文', 'Semantic Scholar'],
    });

    const chunkTexts = result.chunks.map(c => c.text);
    const embeddings = await embedBatch(chunkTexts);

    return await vstore.addDocument(result.metadata, result.chunks, embeddings);
  } catch (e) {
    return null;
  }
}

// ============ 主入口 ============

/**
 * 运行所有爬虫任务
 */
async function runAllCrawlers(options = {}) {
  const {
    crawlWeb = true,
    ingestBuiltin = true,
    searchPapers = true,
  } = options;

  console.log('🕷️ ====== 开始文档采集 ======\n');

  let totalDocs = 0;
  let totalChars = 0;

  // 1. Web 爬虫
  if (crawlWeb) {
    console.log('📡 [1/4] Web 页面抓取...');
    for (const [key, source] of Object.entries(SOURCES)) {
      console.log(`  📂 ${source.name}`);
      for (const page of source.pages) {
        const result = await crawlAndIngest(source.name, page, 'web_article');
        if (result) {
          totalDocs++;
          totalChars += result.totalChars;
        }
        // 礼貌延迟
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    console.log('');
  }

  // 2. 内置文档
  if (ingestBuiltin) {
    console.log('📝 [2/4] 内置知识文档...');
    for (const doc of BUILTIN_DOCS) {
      const result = await ingestBuiltinDoc(doc);
      if (result) {
        totalDocs++;
        totalChars += result.totalChars;
      }
    }
    console.log('');
  }

  // 3. 学术论文搜索
  if (searchPapers) {
    console.log('🎓 [3/4] Semantic Scholar 学术论文...');
    for (const query of SOURCES.semanticscholar.queries) {
      console.log(`  🔍 "${query.replace(/\+/g, ' ')}"`);
      const papers = await searchSemanticScholar(query, 3);
      for (const paper of papers) {
        console.log(`    📄 ${paper.title.substring(0, 60)}...`);
        const result = await ingestPaper(paper);
        if (result) {
          totalDocs++;
          totalChars += result.totalChars;
        }
        await new Promise(r => setTimeout(r, 1500)); // API 频率限制
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    console.log('');
  }

  // 4. 导入 RSS 新闻
  console.log('📰 [4/4] 导入 RSS 新闻文章...');
  const newsImported = await importNewsArticles();
  totalDocs += newsImported.count;
  totalChars += newsImported.chars;

  console.log('\n🎉 ====== 采集完成 ======');
  const stats = vstore.getStats();
  console.log(`📊 总计: ${stats.documentCount} 篇文档, ${stats.chunkCount} 块, ${(stats.totalChars/1000).toFixed(0)}K 字`);
  console.log(`📊 本轮新增: ${totalDocs} 篇, ${(totalChars/1000).toFixed(0)}K 字`);

  return stats;
}

// ============ RSS 新闻导入 ============

async function importNewsArticles() {
  const newsPath = require('path').join(__dirname, '..', 'data', 'news.json');
  if (!require('fs').existsSync(newsPath)) {
    console.log('  📭 暂无新闻数据');
    return { count: 0, chars: 0 };
  }

  const articles = JSON.parse(require('fs').readFileSync(newsPath, 'utf-8'));
  if (articles.length === 0) {
    console.log('  📭 新闻列表为空');
    return { count: 0, chars: 0 };
  }

  console.log(`  📰 发现 ${articles.length} 篇新闻，开始导入...`);

  let count = 0;
  let totalChars = 0;

  for (const article of articles.slice(0, 30)) {
    try {
      const text = `${article.title || ''}\n\n${article.summary || article.content || ''}`;
      if (text.trim().length < 50) continue;

      const result = await ingestText(text, {
        title: article.title || '新闻',
        author: article.source || '',
        sourceType: 'web_article',
        sourceName: article.source || 'RSS Feed',
        sourceUrl: article.link || '',
        publishDate: (article.date || '').substring(0, 10),
        tags: ['RSS新闻', article.category || ''],
      });

      const chunkTexts = result.chunks.map(c => c.text);
      const embeddings = await embedBatch(chunkTexts);

      const docResult = await vstore.addDocument(result.metadata, result.chunks, embeddings);
      count++;
      totalChars += docResult.totalChars;
    } catch (e) {
      // skip failed articles
    }
  }

  console.log(`  ✅ 导入 ${count} 篇新闻, ${(totalChars/1000).toFixed(0)}K 字`);
  return { count, chars: totalChars };
}

// ============ PDF 批量导入 ============

async function importPDFs() {
  const pdfDir = require('path').join(__dirname, '..', 'data', 'pdfs');
  if (!require('fs').existsSync(pdfDir)) {
    console.log('📭 data/pdfs/ 目录不存在');
    return { count: 0, chars: 0 };
  }

  const files = require('fs').readdirSync(pdfDir).filter(f => f.toLowerCase().endsWith('.pdf'));
  if (files.length === 0) {
    console.log('📭 data/pdfs/ 中没有 PDF 文件');
    return { count: 0, chars: 0 };
  }

  console.log(`📄 发现 ${files.length} 个 PDF 文件`);

  const { ingestPDF } = require('./doc-pipeline');
  let count = 0;
  let totalChars = 0;

  for (const file of files) {
    const filePath = require('path').join(pdfDir, file);
    console.log(`  📄 ${file}`);
    try {
      const result = await ingestPDF(filePath);
      const chunkTexts = result.chunks.map(c => c.text);
      const embeddings = await embedBatch(chunkTexts);
      const docResult = await vstore.addDocument(result.metadata, result.chunks, embeddings);
      count++;
      totalChars += docResult.totalChars;
      console.log(`    ✅ ${docResult.chunkCount}块, ${docResult.totalChars}字`);
    } catch (e) {
      console.log(`    ⚠️ ${e.message}`);
    }
  }

  return { count, chars: totalChars };
}

// ============ 模型下载辅助 ============

/**
 * 生成模型离线下载脚本 (用户在能访问 HF 的环境执行)
 */
function getModelDownloadScript() {
  return `
# ============================================
# SalmonFeeding Embedding 模型离线下载脚本
#
# 使用方法:
#   在有网络访问 huggingface.co 的环境下运行此脚本
#   然后将 ~/.cache/huggingface/ 目录打包复制到目标机器
# ============================================

# 方法1: 使用 huggingface-cli (推荐)
pip install huggingface_hub
huggingface-cli download Xenova/multilingual-e5-small --local-dir ~/.cache/huggingface/hub/models--Xenova--multilingual-e5-small

# 方法2: 使用 git-lfs
git lfs install
git clone https://huggingface.co/Xenova/multilingual-e5-small ~/.cache/huggingface/hub/models--Xenova--multilingual-e5-small

# 方法3: 使用镜像 (国内可用)
pip install huggingface_hub
export HF_ENDPOINT=https://hf-mirror.com
huggingface-cli download Xenova/multilingual-e5-small --local-dir ~/.cache/huggingface/hub/models--Xenova--multilingual-e5-small

# 验证下载
ls ~/.cache/huggingface/hub/models--Xenova--multilingual-e5-small/
# 应该看到: onnx/  tokenizer.json  config.json 等文件
`;
}

module.exports = {
  runAllCrawlers,
  crawlAndIngest,
  searchSemanticScholar,
  ingestPaper,
  ingestBuiltinDoc,
  importNewsArticles,
  importPDFs,
  getModelDownloadScript,
  SOURCES,
  BUILTIN_DOCS,
};
