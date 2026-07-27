# 三文鱼养殖投喂策略 — 学术论文综述

## 第一章：投喂模型研究

### 论文 1: Azevedo et al. (2025)
**标题**: A comprehensive feed intake prediction model for salmonids integrating body weight, temperature, and dissolved oxygen
**期刊**: Aquacultural Engineering, Vol. 108
**类型**: 元分析 + 模型开发
**样本量**: 64篇已发表研究 + 25张商业投喂表
**验证范围**: 水温6-19℃, 体重0.9-4076g

**核心模型**:
FI (g/fish/day) = 0.006 × BW^0.80 × exp(0.287×T - 0.012×T²) × h(DO)

**关键发现**:
1. 二次温度项 (0.287T - 0.012T²) 准确体现了12℃附近的最优温度和高温端抑制
2. 这一发现得到 Lai et al. (2025) 独立验证: 12℃时三文鱼生长基因表达最优
3. 模型 MAPE 为 29.4%，优于前代线性模型 (MAPE 35-40%)
4. 与 Remen(2016)的 Sigmoid DOmaxFI 函数兼容

**实用价值**:
- 养殖户可据此模型在不同水温-体重组合下精确计算日投喂量
- 特别适合 RAS 系统（水质可控，模型预测更准）

### 论文 2: Remen et al. (2016)
**标题**: The oxygen requirement for maximum feed intake in Atlantic salmon post-smolts
**期刊**: Aquaculture, Vol. 451
**机构**: Nofima (挪威食品、渔业和水产养殖研究所)
**实验设计**: 4个水温 (7, 11, 15, 19℃) × 5个溶氧水平

**核心概念 — DOmaxFI**:
DOmaxFI = 鱼达到最大摄食量 (>95%) 所需的最低溶氧浓度

**关键发现**:
1. DOmaxFI 随水温升高而增加: 42%(7℃) → 53%(11℃) → 66%(15℃) → 76%(19℃)
2. 这意味着高温时鱼需要更高的溶氧才能维持正常摄食
3. 摄食停止阈值 (LOS) 也随水温升高: 24%→33%→34%→40%
4. 养殖中推荐在 DOmaxFI 基础上加 40% 安全余量

**实用价值**:
- 养殖户可根据当前水温和溶氧判断摄食是否受限
- 15℃时 DOmaxFI=66%≈6.8mg/L — 这是 RAS 系统的最低目标
- 解释了为什么夏季高温时三文鱼更容易出现摄食问题（DOmaxFI 更高 + DO 饱和度更低）

### 论文 3: 孙国祥 (2014)
**标题**: 大西洋鲑工业化循环水养殖投喂策略研究
**类型**: 博士论文
**机构**: 中国科学院海洋研究所
**实验设计**: L₉(3⁴) 正交实验 — 投喂率(0.8/1.2/1.6%) × 频率(2/3/4次/d) × 密度(10/20/30 kg/m³)

**关键发现**:
1. **生长最优组合**: 投喂率 1.2% + 频率 4次/d + 密度 10 kg/m³
2. **消化最优组合**: 投喂率 0.8% + 频率 2次/d + 密度 30 kg/m³ (低投喂高密度反而不浪费)
3. **饲料效率最优**: 中等投喂率 (1.2%) + 中高频率 (3次/d)
4. 建立了氮磷排放模型:
   - No (g/kg feed) = 2.10×10⁻⁴F + 4.94×10⁻⁴W^1.0117 (偏离度 17.93%)
   - Po (g/kg feed) = 3.69×10⁻⁴F + 2.61×10⁻⁴W^0.7605 (偏离度 23.65%)

**实用价值**:
- 为中国RAS三文鱼养殖提供了首个系统性的投喂策略优化数据
- 氮磷排放模型可用于RAS系统的环境负荷评估
- 验证了中等投喂率+较高频率是最佳生长策略

## 第二章：生长与代谢研究

### 论文 4: Lai et al. (2025)
**标题**: Temperature-dependent gene expression in Atlantic salmon: Implications for optimal growth temperature
**期刊**: Frontiers in Physiology, Vol. 16
**方法**: 转录组分析 (RNA-seq) — 不同温度下三文鱼肝脏和肌肉基因表达

**关键发现**:
1. 12℃ 时生长相关基因 (GH/IGF-1 通路) 表达最高
2. 15℃ 时食欲调节基因 (NPY/AgRP) 开始受到抑制
3. 超过 18℃ 时热应激蛋白 (HSP70/HSP90) 显著上调
4. 分子层面的证据支持 12℃ 是三文鱼生长最适温度

**实用价值**:
- 从分子生物学层面验证了养殖实践的"12-16℃ 最佳生长区间"
- 解释了为什么 15℃ 后虽水温升高但生长速率不再线性增加

### 论文 5: Forsberg (1996)
**标题**: The impact of varying feeding regimes on growth and feed conversion in Atlantic salmon
**期刊**: Aquaculture Research, Vol. 27

**经典发现**:
1. 大西洋鲑成鱼的异速生长指数 β≈0.70 (不同于 post-smolt 的 0.55)
2. 投喂频率从 2次/天升至 4次/天，FCR 改善约 0.1
3. 限制投喂 (80%饱食) 可降低 FCR 约 0.05-0.1，但生长速率降低 10-15%
4. 过度投喂 (110%饱食) 对生长无益，FCR 升高 0.2-0.3

**实用价值**:
- 支持"饱食的 90-95%"作为最优投喂量
- 大规格鱼 (>500g) 需使用不同的代谢参数

### 论文 6: Thorarensen & Farrell (2011)
**标题**: The biological requirements for post-smolt Atlantic salmon in closed-containment systems
**期刊**: Aquaculture, Vol. 312

**综述要点**:
1. Post-smolt 三文鱼对水质的要求比成鱼更高
2. RAS 系统中 CO₂ 积累是比 NH₃ 更常见的生长抑制因素
3. 建议 RAS 系统 CO₂ <15 mg/L (成鱼 <20 mg/L)
4. 游泳速度 0.5-1.0 BL/s (体长/秒) 有利于生长和肉质

## 第三章：饲料与营养研究

### 论文 7: Ytrestøyl et al. (2015)
**标题**: Utilisation of feed resources in production of Atlantic salmon in Norway
**期刊**: Aquaculture, Vol. 448

**里程碑发现**:
1. 挪威三文鱼饲料中鱼粉用量从 1990年的 65% 降至 2013年的 18%
2. 鱼油从 25% 降至 10%
3. 替代来源主要是: 大豆蛋白浓缩物 (SPC)、菜籽油、禽副产品粉
4. 尽管配方巨变，FCR 从 1.2 降至 1.1 (饲料效率反而提高)
5. 但 n-3/n-6 比例从 >5:1 降至 <1:1 — 营养价值关注

### 论文 8: Naylor et al. (2021)
**标题**: A 20-year retrospective review of global aquaculture
**期刊**: Nature, Vol. 591

**全球水产养殖趋势**:
1. 1997-2017: 全球水产养殖增长 3.3倍
2. 淡水养殖占 75%，海水养殖快速增长
3. 鲑科鱼类是最成功的水产养殖物种之一 (FCR<1.3)
4. 可持续性挑战: 鱼粉鱼油替代、抗生素使用、环境影响

## 第四章：新兴研究方向

### 4.1 精准投喂 (Precision Feeding)

**最新进展 (2023-2025)**:
- 水下AI摄像头: 实时分析鱼群摄食行为，判断饱食度 (准确率>90%)
- 声学监测: 分析摄食声音 (咬食/咀嚼峰值 → 确定最佳停喂点)
- 个性化投喂: RFID标记个体 + AI识别 → 按大小分级投喂

### 4.2 功能性饲料

- 免疫增强饲料: β-葡聚糖 + MOS + 核苷酸 (降低发病率20-30%)
- 抗应激饲料: 高剂量VC+VE+硒 (运输/分筛前使用)
- 功能性氨基酸: 精氨酸/谷氨酰胺促进肠道发育和修复

### 4.3 循环经济与替代蛋白

- 黑水虻工业化养殖: 全球年产能已达 5万吨 (2025年)
- 单细胞蛋白: Calysseo (中化-凯赛合资) 重庆工厂年产 2万吨
- 微藻 Omega-3: Veramaris (帝斯曼-赢创合资) 年产藻油可替代 15万吨野生鱼油

---

**本文档参考文献**:
1. Azevedo et al. (2025). Aquacultural Engineering, 108.
2. Remen et al. (2016). Aquaculture, 451, 106-115.
3. 孙国祥 (2014). 博士论文, 中国科学院海洋研究所.
4. Lai et al. (2025). Frontiers in Physiology, 16.
5. Forsberg (1996). Aquaculture Research, 27, 301-312.
6. Thorarensen & Farrell (2011). Aquaculture, 312, 1-14.
7. Ytrestøyl et al. (2015). Aquaculture, 448, 365-374.
8. Naylor et al. (2021). Nature, 591, 551-563.
