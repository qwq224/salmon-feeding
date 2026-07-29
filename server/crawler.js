// ================================================================
// crawler.js v2 — 水产养殖文档自动采集器
// 从多个可达数据源抓取文档，自动入库
// ================================================================

const { ingestURL, ingestText } = require('./doc-pipeline');
const vstore = require('./vector-store');
const { embedBatch } = require('./embedder');
const fs = require('fs');
const path = require('path');

// User-Agent 轮换池 (降低被反爬概率)
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  'SalmonFeedingAI/2.0 (research bot; academic use only)',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
];
let _uaIdx = 0;
function _nextUA() {
  const ua = USER_AGENTS[_uaIdx % USER_AGENTS.length];
  _uaIdx++;
  return ua;
}

// ============ 可访问数据源配置 ============

const SOURCES = {
  // NOAA Fisheries — 美国海洋渔业局
  noaa: {
    name: 'NOAA Fisheries',
    baseURL: 'https://www.fisheries.noaa.gov',
    pages: [
      { url:'https://www.fisheries.noaa.gov/topic/aquaculture', title:'NOAA Aquaculture Overview', tags:['NOAA','美国','渔业政策','水产养殖'] },
      { url:'https://www.fisheries.noaa.gov/national/aquaculture/aquaculture-grants-and-funding', title:'NOAA Aquaculture Funding', tags:['NOAA','资金','研发'] },
      { url:'https://www.fisheries.noaa.gov/national/aquaculture/aquaculture-policy-and-regulations', title:'NOAA Aquaculture Policy', tags:['NOAA','政策','法规'] },
      { url:'https://www.fisheries.noaa.gov/national/aquaculture/FAO-aquaculture-reports', title:'NOAA-USDA Aquaculture Reports', tags:['NOAA','报告','FAO'] },
      { url:'https://www.fisheries.noaa.gov/feature-story/aquaculture-supports-sustainable-seafood', title:'Aquaculture & Sustainable Seafood', tags:['NOAA','可持续','海产'] },
      { url:'https://www.fisheries.noaa.gov/national/aquaculture/ aquaculture-economic-impact', title:'Aquaculture Economic Impact', tags:['NOAA','经济','影响'] },
      { url:'https://www.fisheries.noaa.gov/national/sustainable-seafood/ seafood-import-monitoring-program', title:'Seafood Import Monitoring', tags:['NOAA','进口','监管'] },
    ],
  },

  // Global Seafood Alliance — 全球海产联盟
  gsa: {
    name: 'Global Seafood Alliance',
    baseURL: 'https://www.globalseafood.org',
    pages: [
      { url:'https://www.globalseafood.org/advocate/category/responsible-aquaculture/', title:'GSA Responsible Aquaculture', tags:['GSA','负责任养殖','认证'] },
      { url:'https://www.globalseafood.org/advocate/category/aquafeeds/', title:'GSA Aquafeeds & Nutrition', tags:['GSA','饲料','营养'] },
      { url:'https://www.globalseafood.org/advocate/category/animal-welfare/', title:'GSA Animal Welfare', tags:['GSA','动物福利','健康'] },
      { url:'https://www.globalseafood.org/advocate/category/water-quality/', title:'GSA Water Quality', tags:['GSA','水质','管理'] },
      { url:'https://www.globalseafood.org/advocate/category/fish-health-disease/', title:'GSA Fish Health & Disease', tags:['GSA','疾病','健康'] },
      { url:'https://www.globalseafood.org/advocate/category/sustainability/', title:'GSA Sustainability', tags:['GSA','可持续','环境'] },
      { url:'https://www.globalseafood.org/advocate/category/innovation-technology/', title:'GSA Innovation & Technology', tags:['GSA','创新','技术'] },
      { url:'https://www.globalseafood.org/advocate/category/finance-investment/', title:'GSA Finance & Investment', tags:['GSA','投资','金融'] },
    ],
  },

  // FAO 水产养殖文档
  fao: {
    name: 'FAO Fisheries',
    baseURL: 'https://www.fao.org',
    pages: [
      { url:'https://www.fao.org/fishery/aquaculture/en', title:'FAO Aquaculture Portal', tags:['FAO','国际组织','水产养殖'] },
      { url:'https://www.fao.org/fishery/en/collection/aquaculture', title:'FAO Aquaculture Documents', tags:['FAO','文档','技术'] },
      { url:'https://www.fao.org/fishery/statistics/global-aquaculture-production/en', title:'FAO Global Aquaculture Statistics', tags:['FAO','统计','全球产量'] },
      { url:'https://www.fao.org/fishery/en/countryprofiles/search/en', title:'FAO Country Profiles - Fisheries', tags:['FAO','国家','概况'] },
      { url:'https://www.fao.org/3/cc9461en/cc9461en.pdf', title:'FAO State of World Fisheries 2024', tags:['FAO','世界渔业','报告'] },
    ],
  },

  // 水产前沿 fishfirst.cn — 中文水产行业媒体
  fishfirst: {
    name: '水产前沿',
    baseURL: 'http://www.fishfirst.cn',
    pages: [
      { url:'http://www.fishfirst.cn/category/jiance', title:'水产前沿 - 监测', tags:['水产前沿','监测','水质'], lang:'zh' },
      { url:'http://www.fishfirst.cn/category/siyang', title:'水产前沿 - 饲养管理', tags:['水产前沿','饲养','管理'], lang:'zh' },
      { url:'http://www.fishfirst.cn/category/jibing', title:'水产前沿 - 疾病防治', tags:['水产前沿','疾病','防治'], lang:'zh' },
      { url:'http://www.fishfirst.cn/category/siliao', title:'水产前沿 - 饲料营养', tags:['水产前沿','饲料','营养'], lang:'zh' },
      { url:'http://www.fishfirst.cn/category/shuichan', title:'水产前沿 - 水产资讯', tags:['水产前沿','资讯','行业'], lang:'zh' },
      { url:'http://www.fishfirst.cn/category/yumiao', title:'水产前沿 - 育苗育种', tags:['水产前沿','育苗','育种'], lang:'zh' },
      { url:'http://www.fishfirst.cn/category/shichang', title:'水产前沿 - 市场行情', tags:['水产前沿','市场','行情'], lang:'zh' },
    ],
  },

  // 中国水产频道 — 备用中文源
  chinafish: {
    name: '中国水产频道',
    baseURL: 'http://www.fishfirst.cn',
    pages: [
      { url:'http://www.fishfirst.cn/article-1.html', title:'中国水产频道 - 养殖技术', tags:['水产频道','技术','养殖'], lang:'zh' },
    ],
  },

  // 🆕 FAO 技术论文深度文档
  fao_deep: {
    name: 'FAO Technical Papers',
    baseURL: 'https://www.fao.org',
    pages: [
      { url:'https://www.fao.org/fishery/en/publication/28947', title:'FAO Aquaculture Feed Ingredients', tags:['FAO','饲料','营养'], lang:'en' },
      { url:'https://www.fao.org/fishery/en/global-search?q=salmon%20feeding%20nutrition', title:'FAO Salmon Feeding Search', tags:['FAO','三文鱼','投喂'], lang:'en' },
      { url:'https://www.fao.org/fishery/en/global-search?q=aquaculture%20RAS%20recirculating', title:'FAO RAS Technical Papers', tags:['FAO','RAS','循环水'], lang:'en' },
    ],
  },

  // 🆕 Nofima — 挪威水产研究所 (全球顶级三文鱼研究机构)
  nofima: {
    name: 'Nofima Research',
    baseURL: 'https://nofima.com',
    pages: [
      { url:'https://nofima.com/en/research-topics/aquaculture/', title:'Nofima Aquaculture Research', tags:['Nofima','研究','三文鱼'], lang:'en' },
      { url:'https://nofima.com/en/research-topics/feed-and-nutrition/', title:'Nofima Feed & Nutrition', tags:['Nofima','饲料','营养'], lang:'en' },
      { url:'https://nofima.com/en/research-topics/breeding-and-genetics/', title:'Nofima Breeding & Genetics', tags:['Nofima','育种','遗传'], lang:'en' },
      { url:'https://nofima.com/en/research-topics/fish-health/', title:'Nofima Fish Health', tags:['Nofima','疾病','健康'], lang:'en' },
    ],
  },

  // 🆕 开放获取学术论文 (MDPI / Frontiers)
  openaccess: {
    name: 'Open Access Journals',
    baseURL: 'https://www.mdpi.com',
    pages: [
      { url:'https://www.mdpi.com/search?q=salmon+aquaculture+feeding+nutrition', title:'MDPI Salmon Feeding Papers', tags:['MDPI','学术','投喂'], lang:'en' },
      { url:'https://www.frontiersin.org/search?q=salmon+aquaculture+water+quality', title:'Frontiers Salmon Water Quality', tags:['Frontiers','学术','水质'], lang:'en' },
    ],
  },

  // 🆕 水产养殖网 (中文)
  shuichan: {
    name: '水产养殖网',
    baseURL: 'https://www.shuichan.cc',
    pages: [
      { url:'https://www.shuichan.cc/article/list_20_1.html', title:'水产养殖网 - 养殖技术', tags:['水产养殖网','技术','养殖'], lang:'zh' },
      { url:'https://www.shuichan.cc/article/list_22_1.html', title:'水产养殖网 - 病害防治', tags:['水产养殖网','病害','防治'], lang:'zh' },
      { url:'https://www.shuichan.cc/article/list_25_1.html', title:'水产养殖网 - 饲料营养', tags:['水产养殖网','饲料','营养'], lang:'zh' },
    ],
  },

  // 🆕 Semantic Scholar 学术论文查询 (修复 Bug: 之前引用但未定义)
  semanticscholar: {
    name: 'Semantic Scholar',
    baseURL: 'https://api.semanticscholar.org',
    queries: [
      'salmon+feeding+rate+model+temperature',
      'Atlantic+salmon+feed+conversion+ratio+FCR',
      'rainbow+trout+nutrition+requirement+feeding',
      'salmon+RAS+recirculating+aquaculture+system',
      'salmon+welfare+stocking+density+growth',
      'salmon+alternative+protein+feed+fishmeal+replacement',
      'aquaculture+sustainability+environmental+impact',
      'salmon+disease+prevention+vaccine+aquaculture',
      'recirculating+aquaculture+system+design+operation',
      'Atlantic+salmon+growth+model+bioenergetics',
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

  // 🆕 第4篇: RAS 循环水系统
  {
    title: 'RAS 循环水养殖系统设计与运维指南',
    type: 'manual',
    author: 'SalmonFeeding 知识工程组',
    tags: ['RAS', '循环水', '系统设计', '生物滤池', '硝化', '消毒'],
    content: `# RAS 循环水养殖系统设计与运维指南

## 第一章：RAS 系统架构

### 1.1 核心处理单元

一个完整的 RAS 系统包括以下核心单元:

| 单元 | 功能 | 关键参数 |
|------|------|---------|
| 固液分离 (机械过滤) | 去除悬浮固体 (TSS) | 微筛机 40-100μm, TSS<15 mg/L |
| 生物滤池 (硝化) | NH₃→NO₂⁻→NO₃⁻ | 氨氮去除率>90%, HRT 4-8min |
| CO₂ 脱气 | 去除溶解 CO₂ | CO₂<15 mg/L, 气水比 5:1-10:1 |
| 增氧/充氧 | DO≥9 mg/L | 纯氧/LHO, O₂利用率>85% |
| 消毒 (UV/O₃) | 杀灭病原体 | UV 剂量 30-50 mJ/cm² |
| 温控 | 维持最佳水温 12-18℃ | 热泵/冷却塔, ±1℃ |

### 1.2 设计参数速查

| 参数 | 推荐值 | 单位 |
|------|--------|------|
| 循环率 | 1-4 | 次/小时 |
| 补水率 | 5-15% | 系统总量/天 |
| 水力停留时间 (HRT) | 0.5-2 | 小时 |
| 最大养殖密度 | 40-80 | kg/m³ |
| 生物滤池负荷 | 0.2-0.5 | g TAN/m²/d |
| MBBR 填料填充率 | 30-50% | — |
| 系统总动力 | 10-20 | kW/吨鱼 |

## 第二章：生物滤池硝化系统

### 2.1 硝化过程

NH₄⁺ + 1.5O₂ →(Nitrosomonas)→ NO₂⁻ + 2H⁺ + H₂O
NO₂⁻ + 0.5O₂ →(Nitrobacter)→ NO₃⁻

**关键消耗**: 每氧化 1g NH₃-N → 消耗 4.57g O₂ + 7.14g CaCO₃ 碱度

### 2.2 硝化速率影响因素

| 因素 | 最佳范围 | 影响 |
|------|---------|------|
| 水温 | 25-30℃ | <10℃速率降50% |
| pH | 7.5-8.5 | <6.5 显著抑制 |
| DO | ≥4 mg/L | <2 mg/L 硝化停止 |
| 碱度 | 50-200 mg/L | <20 硝化受限 |
| TAN | 0.5-2.0 mg/L | >3.0 抑制硝化菌 |
| 有机物 | 越低越好 | BOD 高→异养菌竞争 |

### 2.3 MBBR vs 固定床

| 特性 | MBBR | 固定床 (滴滤) |
|------|------|-------------|
| 比表面积 | 500-800 m²/m³ | 150-300 m²/m³ |
| 堵塞风险 | 低 (自清洁) | 中-高 |
| TAN 去除率 | 0.3-0.8 g/m²/d | 0.1-0.4 g/m²/d |
| 能耗 | 低-中 | 中 |
| 维护 | 简单 | 需反冲洗 |

## 第三章：固体去除与消毒

### 3.1 固体分级去除

1. **粗滤 (1000-3000μm)**: 弧形筛/滚筒筛, 去除残饵和粪便
2. **精滤 (40-100μm)**: 微筛机/砂滤, 确保 TSS<15 mg/L
3. **蛋白分离器**: 去除溶解有机物, 泡沫分选
4. **沉淀池**: 水力停留 15-30min, 去除可沉降固体

### 3.2 消毒方案

| 方法 | 剂量 | 优点 | 缺点 |
|------|------|------|------|
| UV 紫外线 | 30-50 mJ/cm² | 无残留, 安全 | 水质影响(TSS↑→效果↓) |
| 臭氧 O₃ | 0.1-0.3 mg/L | 强氧化, 去色 | 需监测余量, ORP<350mV |
| 过氧乙酸 | 0.5-2.0 mg/L | 广谱杀菌 | 成本较高 |

## 第四章：运行监控

### 4.1 日常检查清单

| 项目 | 频率 | 目标值 | 报警值 |
|------|------|--------|--------|
| 循环泵流量 | 每日 | 设计值±10% | ±20% |
| 微筛机前后液位差 | 每日 | <5 cm | >10 cm (堵塞) |
| 生物滤池进出口 NH₃ | 每周2次 | 去除率>90% | <70% |
| 充氧锥 DO 出口 | 每日 | >20 mg/L | <15 mg/L |
| 养殖池 DO | 连续 | ≥9 mg/L | <7 mg/L |
| 补水流量 | 每日 | 5-15%/天 | <3% 或 >20% |
| 碱度 | 每周1次 | 50-200 mg/L | <30 mg/L |

### 4.2 常见故障与应急

| 故障 | 症状 | 应急措施 |
|------|------|---------|
| 停电 | 泵停止,DO 骤降 | 启动发电机/UPS, 纯氧应急供氧 |
| 生物滤池崩溃 | NH₃ 快速上升 | 停食, 大换水, 添加硝化菌种 |
| 微筛机堵塞 | 液位差过大 | 切换备用, 清洗筛网 |
| 管道破裂 | 水位下降 | 关闭阀门, 启动补水泵 |
`,
  },

  // 🆕 第5篇: 经济分析与商业模式
  {
    title: '三文鱼养殖经济分析与商业模式',
    type: 'manual',
    author: 'SalmonFeeding 知识工程组',
    tags: ['经济', '成本', '市场', '商业模式', '投资', '盈亏'],
    content: `# 三文鱼养殖经济分析与商业模式

## 第一章：成本结构分析

### 1.1 典型 RAS 陆基养殖成本构成

| 成本项 | 占比 | 数值 (元/kg) | 说明 |
|--------|------|-------------|------|
| 饲料 | 45-55% | 18-25 | 最大单项成本 |
| 苗种 | 8-12% | 3-6 | 100g 降海 smolt |
| 电力 | 10-15% | 5-9 | 水泵+增氧+温控 |
| 人工 | 10-15% | 5-8 | 技术员+操作工 |
| 折旧 | 8-12% | 4-7 | 基建+设备 15年摊销 |
| 动保/疫苗 | 3-5% | 1.5-3 | 疫苗+消毒+药品 |
| 其他 | 5-8% | 3-5 | 运输/检测/保险 |
| **合计** | **100%** | **40-63** | 挪威网箱约35元/kg |

### 1.2 饲料成本优化策略

| 策略 | 预期效果 |
|------|---------|
| FCR 从1.3→1.1 | 饲料成本降 15% |
| 替代蛋白 (昆虫粉替代25%鱼粉) | 饲料单价降 8-12% |
| 精准投喂 (减少残饵) | 节省 5-10% 饲料 |
| 批量采购 (年>500吨) | 单价降 5-8% |
| 使用副产品 (鱼油/磷虾粉) | 营养成分更优 |

## 第二章：市场规模与行情

### 2.1 全球三文鱼产量

| 国家 | 年产量 (万吨) | 占比 | 主要模式 |
|------|-------------|------|---------|
| 挪威 | 150 | 55% | 海水网箱 |
| 智利 | 100 | 37% | 海水网箱 |
| 英国 (苏格兰) | 20 | 7% | 海水网箱 |
| 加拿大 | 15 | 5% | 海水网箱 |
| 法罗群岛 | 8 | 3% | 海水网箱 |
| 中国 | 5+ | — | 陆基RAS+网箱 |
| 冰岛 | 5 | 2% | 陆基RAS |

全球总产量约 270万吨/年, 价值约 2000亿人民币

### 2.2 市场价格参考 (2025-2026)

| 规格 | 价格 (元/kg) | 价格 (NOK/kg) |
|------|-------------|---------------|
| 3-4 kg (鲜整条) | 55-70 | 80-105 |
| 4-5 kg (鲜整条) | 60-75 | 90-115 |
| 5-6 kg (鲜整条) | 65-85 | 95-125 |
| 鱼柳 (冷冻) | 90-120 | 130-180 |
| 即食烟熏切片 | 180-300 | 260-450 |

## 第三章：投资回报分析

### 3.1 陆基 RAS 养殖场投资估算 (年产1000吨)

| 投资项目 | 金额 (万元) |
|---------|-----------|
| 场地/土建 | 1500-2500 |
| RAS 设备 (生物滤池/微筛/充氧/管道) | 3000-5000 |
| 温控系统 (热泵+冷却塔) | 800-1200 |
| 配电/自控/监控 | 500-800 |
| 辅助设施 (冷库/实验室/办公室) | 500-1000 |
| 设计/监理/不可预见费 | 500-800 |
| **总投资** | **6800-12000** |

### 3.2 盈亏平衡分析

以年产 1000 吨、售价 60 元/kg 计:
- 年收入: 6000 万元
- 年运营成本: 4000-5000 万元
- 年毛利: 1000-2000 万元
- 投资回收期: 4-8 年

**关键盈亏因子**: FCR 每降低 0.1, 年利润增加约 120万元
`,
  },

  // 🆕 第6篇: 苗种培育与降海驯化
  {
    title: '三文鱼苗种培育与降海驯化技术',
    type: 'manual',
    author: 'SalmonFeeding 知识工程组',
    tags: ['苗种', '育苗', '降海', 'smolt', '银化', '光周期'],
    content: `# 三文鱼苗种培育与降海驯化技术

## 第一章：育苗阶段划分

### 1.1 生命周期阶段

| 阶段 | 体重 | 时长 | 关键管理 |
|------|------|------|---------|
| 鱼卵 (Eyed Egg) | — | 30-60天 | 温度控制 6-10℃, DO>8 mg/L |
| 仔鱼 (Alevin) | 0.1-0.2g | 3-6周 | 卵黄囊吸收, 避光, 静水 |
| 稚鱼 (Fry) | 0.2-1.5g | 4-8周 | 开口投喂, 活饵→微颗粒 |
| 幼鱼 (Parr) | 1.5-50g | 3-6月 | 快速生长, 分级管理 |
| 降海幼鲑 (Smolt) | 50-120g | 2-3月 | 银化驯化, 转入海水 |

### 1.2 各阶段投喂要点

| 阶段 | 投饲率 (%) | 蛋白 (%) | 脂肪 (%) | 粒径 (mm) | 频率 |
|------|-----------|---------|---------|---------|------|
| 开口仔鱼 | 6-10 | ≥52 | ≥15 | 0.1-0.3 | 12-24次/天 |
| 稚鱼 | 4-8 | ≥48 | ≥18 | 0.3-1.0 | 8-12次/天 |
| 幼鱼前期 | 3-5 | ≥45 | ≥20 | 1.0-2.5 | 6-8次/天 |
| 幼鱼后期 | 2-4 | ≥42 | ≥22 | 2.5-4.0 | 4-6次/天 |
| Smolt | 1.5-2.5 | ≥40 | ≥26 | 4.0-6.0 | 2-3次/天 |

## 第二章：Smoltification (银化/降海驯化)

### 2.1 银化生理变化

大西洋鲑在降海前经历一系列生理变化:

1. **外观变化**: 体色由深色→银白色, Parr Mark (幼鱼斑纹) 消失
2. **鳃部变化**: 鳃 Na⁺/K⁺-ATPase 活性↑3-5倍, 适应海水渗透压
3. **代谢变化**: 海水适应能力↑, 生长潜力激活
4. **行为变化**: 趋流性增强, 集群游向水流

### 2.2 光周期控制方案

光周期是调控 Smoltification 的核心手段:

| 阶段 | 光照方案 | 时长 | 目的 |
|------|---------|------|------|
| 冬季模拟 (Winter Signal) | LD 12:12 | 6周 | 启动银化程序 |
| 春季模拟 (Spring Signal) | LD 24:0 | 6-8周 | 加速银化完成 |
| 维持 | LD 24:0 或自然光 | — | 保持银化状态 |

### 2.3 Smolt 质量评估

| 指标 | 合格标准 | 检测方法 |
|------|---------|---------|
| 鳃 Na/K-ATPase | >10 μmol ADP/mg protein/h | 酶活分析 |
| 海水挑战试验 | 96h 存活率>95% @35‰ | 直接放入海水 |
| 体长 | ≥12 cm | 抽样30尾 |
| 体重 | ≥50 g | 抽样30尾 |
| 肥满度 (CF) | 0.9-1.2 | 体重/体长³×100 |
| 银化指数 | 外观评分≥3/5 | 视觉评估 |

## 第三章：育苗系统管理

### 3.1 稚鱼期关键参数

| 参数 | 最佳范围 |
|------|---------|
| 水温 | 12-16℃ |
| DO | ≥9 mg/L (饱和度>90%) |
| 光照强度 | 200-500 lux |
| 水流速 | 1-2 体长/秒 |
| 密度 (稚鱼) | <10 kg/m³ |
| 日换水率 | 100-300% (流水) |

### 3.2 分级管理

定期分级 (Grading) 是防止同类相残、保证均匀生长的关键:
- 体重>1g 后每周分级1次
- CV (变异系数) 控制在 <15%
- 分级器间距按体重设定，每2周调整
`,
  },

  // 🆕 第7篇: 收获加工与品质控制
  {
    title: '三文鱼收获加工与品质控制标准',
    type: 'manual',
    author: 'SalmonFeeding 知识工程组',
    tags: ['收获', '加工', '品质', 'HACCP', '屠宰', '冷链'],
    content: `# 三文鱼收获加工与品质控制标准

## 第一章：收获前管理

### 1.1 出鱼前准备

| 时间节点 | 操作 | 说明 |
|---------|------|------|
| 出鱼前 7天 | 停用药物 | 确保休药期已过 |
| 出鱼前 3天 | 停食 (Starvation) | 清空肠道, 减少运输污染 |
| 出鱼前 1天 | 降温至 2-4℃ | 降低代谢, 减少应激 |
| 出鱼前 2小时 | 抽样检测 | 品质指标确认 |
| 出鱼时 | CO₂ 麻醉或电击 | 人道的宰前处理 |

### 1.2 品质评估指标

| 指标 | 优级 | 标准级 |
|------|------|--------|
| 体色 | 银白光亮, 无损伤 | 轻微变色 |
| 体表粘液 | 完整均匀 | 部分缺失 |
| 鳃色 | 鲜红, 无粘液 | 暗红 |
| 眼球 | 饱满透明 | 轻微凹陷 |
| 肌肉弹性 | 按压后即刻恢复 | 较慢恢复 |
| 脂肪含量 | 12-18% | 10-20% |
| Pigment (Astaxanthin) | ≥6 mg/kg | ≥4 mg/kg |

## 第二章：屠宰与加工

### 2.1 人道屠宰流程

| 步骤 | 方法 | 参数 |
|------|------|------|
| 1. 镇静 | CO₂ 饱和水 (或低温) | 2-4℃, 3-5min |
| 2. 击昏 | 电击/敲击 | 50-100V, 3-5s |
| 3. 放血 | 鳃部动脉切开 | 冰水 0-2℃, 15-20min |
| 4. 去内脏 | 机械/手工 | 避免胆囊破裂 |
| 5. 清洗 | 高压水冲洗腹腔 | 0-2℃ 清水 |

### 2.2 加工产品形态

| 产品形态 | 加工要求 | 温度要求 |
|---------|---------|---------|
| 鲜整条 (Fresh Whole) | 带内脏/去内脏 | 0-2℃ (冰鲜) |
| 鲜鱼柳 (Fresh Fillet) | 去皮去骨 | 0-2℃ |
| 冷冻整条 (Frozen Whole) | -40℃ 速冻 | ≤-18℃ 储存 |
| 冷冻鱼柳 (Frozen Fillet) | 真空独立包装 | ≤-18℃ |
| 烟熏切片 (Smoked Sliced) | 冷熏/热熏 | 0-4℃ (冷熏) |
| 即食 (RTE) | HPP 高压灭菌 | 0-4℃ |

### 2.3 冷链管理

| 环节 | 温度要求 | 时限 |
|------|---------|------|
| 宰后冷却 | 0-2℃ | <2小时 |
| 加工车间 | <10℃ | — |
| 包装 | 0-2℃ | <30min |
| 冷藏运输 | 0-2℃ | <72小时 |
| 冷藏展示 | 0-2℃ | <48小时 |
| 冷冻储存 | ≤-18℃ | <18个月 |

## 第三章：HACCP 关键控制点

### 3.1 三文鱼加工 HACCP 计划

| CCP | 危害 | 控制措施 | 关键限值 | 监控频率 |
|-----|------|---------|---------|---------|
| 原料接收 | 微生物/药残 | 供应商审核 | 药残报告合格 | 每批次 |
| 冷藏 | 微生物生长 | 温度控制 | 0-2℃ | 连续+每2h记录 |
| 去内脏 | 交叉污染 | 刀具消毒 | 82℃热水 | 每30分钟 |
| 金属检测 | 物理异物 | 金属探测器 | Fe≤2.0mm, SS≤3.0mm | 每件产品 |
| 包装密封 | 二次污染 | 密封性检查 | 真空度达标 | 每30分钟 |
| 冷藏运输 | 冷链断裂 | 温度记录仪 | 全程 0-2℃ | 连续记录 |

### 3.2 微生物标准

| 指标 | 限值 (CFU/g) |
|------|-------------|
| 菌落总数 (APC) | ≤5×10⁵ |
| 大肠菌群 | ≤100 |
| 大肠杆菌 | ≤10 |
| 金黄色葡萄球菌 | ≤100 |
| 沙门氏菌 | 不得检出/25g |
| 单增李斯特菌 | 不得检出/25g |
`,
  },

  // 🆕 第8篇: 全球标准与法规
  {
    title: '三文鱼养殖全球标准与法规汇编',
    type: 'manual',
    author: 'SalmonFeeding 知识工程组',
    tags: ['标准', '法规', '认证', 'ASC', 'BAP', 'GlobalGAP', '绿色食品'],
    content: `# 三文鱼养殖全球标准与法规汇编

## 第一章：国际认证体系

### 1.1 三大国际认证对比

| 维度 | ASC | BAP | GlobalG.A.P. |
|------|-----|-----|-------------|
| 管理机构 | ASC (WWF+IDH) | GAA (全球水产联盟) | GlobalG.A.P. c/o FAO |
| 关注焦点 | 环境+社会 | 全产业链 | 食品安全+追溯 |
| 审核方式 | 第三方年度审核 | 第三方+飞行检查 | 第三方年度审核 |
| 饲料要求 | 鱼粉鱼油可追溯 | 饲料厂需 BAP 认证 | 符合法规即可 |
| 鱼类福利 | 有明确标准 | 有明确标准 | 基础要求 |
| 适用场景 | 出口欧美市场 | 北美市场 | 欧洲零售市场 |

### 1.2 ASC 三文鱼标准核心要求

| 指标 | ASC 标准 |
|------|---------|
| 最大养殖密度 | 海水网箱≤25 kg/m³ |
| FCR (饲料系数) | ≤1.3 (海水网箱) |
| 鱼粉效率比 (FFERm) | ≤1.35 |
| 抗生素使用 | 治疗用, 不能用预防用 |
| 鱼类逃脱 | ≤300条/生产周期 (需报告) |
| 底泥影响 | 网箱下底泥 Zn≤标准值 |
| 社会责任 | 符合 ILO 核心劳工标准 |
| 海虱数量 | 平均<0.5 雌虫/鱼 |

## 第二章：中国标准

### 2.1 现行有效标准

| 标准编号 | 名称 | 主要内容 |
|---------|------|---------|
| GB/T 22213-2008 | 水产养殖术语 | 术语定义 |
| NY/T 755-2003 | 绿色食品 渔药使用准则 | 禁用药清单+休药期 |
| NY 5071-2002 | 无公害食品 渔用药物使用准则 | 药物使用规范 |
| NY 5072-2002 | 无公害食品 渔用配合饲料安全限量 | 饲料卫生指标 |
| DB63/T 1042-2011 | 虹鳟商品鱼养殖技术规范 | 青海标准 |
| SC/T 1030.1-1999 | 虹鳟养殖技术规范 亲鱼 | 行业标准 |
| SC/T 1030.2-1999 | 虹鳟养殖技术规范 亲鱼培育 | — |
| GB 11607-1989 | 渔业水质标准 | 水质基本要求 |

### 2.2 绿色食品认证要求

| 项目 | 要求 |
|------|------|
| 环境 | 产地环境符合 NY/T 391 |
| 投入品 | 渔药/饲料符合绿色食品准则 |
| 休药期 | ≥500度日 (水温×天数) |
| 可追溯 | 养殖全过程记录 |
| 检测 | 第三方检测 每年至少1次 |

## 第三章：饲料法规

### 3.1 饲料安全关键指标

| 检测项 | 限量 | 依据 |
|--------|------|------|
| 黄曲霉毒素 B1 | ≤10 μg/kg | NY 5072 |
| 总砷 | ≤3 mg/kg | NY 5072 |
| 铅 | ≤5 mg/kg | NY 5072 |
| 汞 | ≤0.5 mg/kg | NY 5072 |
| 镉 | ≤0.5 mg/kg | NY 5072 |
| 沙门氏菌 | 不得检出/25g | NY 5072 |
| 三聚氰胺 | 不得检出 | 农业部公告 |

### 3.2 进口饲料登记

境外饲料添加剂和预混料需通过农业农村部进口登记:
- 提交: 生产工艺、质量标准、安全评价报告
- 审查周期: 6-12 个月
- 有效期: 5年 (需续展)

## 第四章：出口合规

### 4.1 主要出口市场要求

| 市场 | 核心要求 | 认证 |
|------|---------|------|
| 欧盟 | 出口国列入 EU 清单 + HACCP | EU 批号 |
| 美国 | FSMA + HACCP + 水产 HACCP | FDA 注册 |
| 日本 | 肯定列表制度 (残留限量) | 出口备案 |
| 韩国 | 进口水产品检验法 | 卫生证书 |

### 4.2 出口检测项目

| 检测类别 | 项目数 | 常见不合格项 |
|---------|--------|------------|
| 兽药残留 | 30-50项 | 磺胺类、氟苯尼考超休药期 |
| 重金属 | 5项 | — |
| 微生物 | 5-7项 | 菌落总数 |
| 污染物 | 3-5项 | — |
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
      headers: { 'User-Agent': _nextUA() },
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
      signal: AbortSignal.timeout(30000),
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
        // 礼貌延迟 (增加到3秒 + 跨域额外等待)
        await new Promise(r => setTimeout(r, 3000));
      }
      // 跨源额外延迟
      await new Promise(r => setTimeout(r, 2000));
      console.log('');
    }
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
    console.log('🎓 [3/5] Semantic Scholar 学术论文...');
    if (SOURCES.semanticscholar && SOURCES.semanticscholar.queries) {
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
          await new Promise(r => setTimeout(r, 1500));
        }
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    console.log('');
  }

  // 3.5. 专业知识库文件
  if (ingestBuiltin) {
    console.log('📖 [3.5/5] 专业知识库文档...');
    const kbResults = await ingestKnowledgeFiles();
    for (const r of kbResults) {
      if (r) { totalDocs++; totalChars += r.totalChars; }
    }
    console.log('');
  }

  // 4. 导入 RSS 新闻
  console.log('📰 [4/5] 导入 RSS 新闻文章...');
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

// ============ 知识库文件导入 ============

async function ingestKnowledgeFiles() {
  const knowledgeDir = require('path').join(__dirname, '..', 'data', 'knowledge');
  if (!require('fs').existsSync(knowledgeDir)) {
    console.log('📭 data/knowledge/ 目录不存在');
    return [];
  }

  const files = require('fs').readdirSync(knowledgeDir).filter(f => f.endsWith('.md'));
  console.log(`📝 发现 ${files.length} 个专业知识文档`);

  const results = [];
  for (const file of files) {
    const filePath = require('path').join(knowledgeDir, file);
    const content = require('fs').readFileSync(filePath, 'utf-8');
    const title = content.split('\n')[0].replace(/^#+\s*/, '').trim();

    try {
      const { ingestText } = require('./doc-pipeline');
      const result = await ingestText(content, {
        title,
        author: 'SalmonFeeding 知识工程组',
        sourceType: 'manual',
        sourceName: 'SalmonFeeding 专业知识库',
        tags: ['知识库', '养殖', file.replace('.md', '')],
      });
      const chunkTexts = result.chunks.map(c => c.text);
      const embeddings = await embedBatch(chunkTexts);
      const docResult = await vstore.addDocument(result.metadata, result.chunks, embeddings);
      console.log(`  ✅ ${title}: ${docResult.chunkCount}块, ${docResult.totalChars}字`);
      results.push(docResult);
    } catch (e) {
      console.log(`  ⚠️ ${title}: ${e.message}`);
    }
  }
  return results;
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
  ingestKnowledgeFiles,
  importNewsArticles,
  importPDFs,
  getModelDownloadScript,
  SOURCES,
  BUILTIN_DOCS,
};
