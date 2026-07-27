// ================================================================
// generate-docs.js — 使用 Claude API 批量生成专业知识文档
// 每个文档 8-15K 字，涵盖投喂策略/水质/疾病/营养/标准等主题
// 自动索引到知识库
// ================================================================

const fs = require('fs');
const path = require('path');
const vstore = require('./vector-store');
const { embedBatch } = require('./embedder');
const { ingestText } = require('./doc-pipeline');

const TOPICS = [
  {
    id: 'feeding-juvenile',
    title: '三文鱼稚幼鱼阶段投喂管理技术规程',
    prompt: `请以三文鱼养殖技术专家的身份，撰写一份详细的技术文档：三文鱼稚鱼和幼鱼阶段的投喂管理技术规程。

要求：
1. 长度：至少3000字中文
2. 必须包含以下内容：
   - 稚鱼(<10g)和幼鱼(10-50g)的投饲率计算公式和实例
   - 不同水温下的投喂频率和投喂量调整表
   - 饲料粒径选择标准 (0.3-2.5mm的过渡方案)
   - 开口饲料到人工配合饲料的驯化过程
   - 稚鱼期常见的投喂问题及解决（规格分化、残饵、水质恶化）
   - 生长监测方法（抽样称重频率、SGR计算、CV控制）
3. 使用表格呈现关键数据
4. 引用具体的行业标准（GB/NY/SC编号）
5. 语言：专业但不生硬，可操作性强`,
    tags: ['投喂', '稚鱼', '幼鱼', '生长', '饲料'],
  },
  {
    id: 'feeding-adult',
    title: '三文鱼成鱼阶段精准投喂与FCR优化',
    prompt: `请以三文鱼养殖技术专家的身份，撰写一份详细的技术文档：三文鱼成鱼阶段(>200g至上市)的精准投喂策略与FCR优化。

要求：
1. 长度：至少3000字中文
2. 必须包含：
   - 成鱼不同规格(200g/500g/1kg/3kg)对应的投饲率和水温修正
   - FCR的分解分析：影响FCR的10个因素排序及优化方案
   - 残饵监控技术：水面摄像头、残饵收集器、声学监测的原理和实操
   - 投喂-生长的反馈闭环优化方法
   - 上市前的投喂调整：清肠期的投喂管理、肉色优化(虾青素添加)
   - 不同养殖模式(RAS/网箱/流水池)成鱼投喂对比
3. 包含计算公式和实例计算
4. 使用表格和项目符号`,
    tags: ['投喂', '成鱼', 'FCR', '优化'],
  },
  {
    id: 'water-quality-monitoring',
    title: '三文鱼养殖水质在线监测与预警系统设计',
    prompt: `请以水产养殖工程师的身份，撰写一份详细的技术文档：三文鱼RAS养殖水质在线监测与预警系统设计指南。

要求：
1. 长度：至少3000字中文
2. 必须包含：
   - 需要监测的关键参数及其重要性排序（DO/温度/pH/氨氮/亚硝酸盐/TSS/CO2/碱度/ORP）
   - 传感器选型指南：光学DO vs 电化学DO、pH电极类型、氨氮在线分析仪
   - 采样点设计：进水/出水/生物滤池前后/养殖池不同深度的布点方案
   - 报警阈值设置：三级预警（黄色/橙色/红色）的具体数值
   - 数据记录与分析：DO日变化曲线、氨氮周趋势、自动报表生成
   - 物联网架构：传感器→PLC→SCADA→云平台的数据流
   - 断电和设备故障的应急监测方案
3. 包含传感器安装和维护的实操建议`,
    tags: ['水质', '监测', '传感器', '自动化', 'RAS'],
  },
  {
    id: 'biofilter-management',
    title: 'RAS生物滤池硝化系统运行管理技术手册',
    prompt: `请以RAS水处理工程师的身份，撰写一份详细的技术文档：RAS循环水养殖生物滤池硝化系统的运行管理技术手册。

要求：
1. 长度：至少3000字中文
2. 必须包含：
   - 硝化过程原理：NH3→NO2→NO3的两步反应动力学
   - MBBR、FBR、RBC、流沙滤池四种生物滤池的对比（比表面积、硝化速率、维护难度、成本）
   - 生物滤池的启动与挂膜：接种方法、挂膜时间、氨氮负荷递增曲线
   - 碱度管理：硝化消耗碱度的计算、NaHCO3补充量公式
   - 生物滤池性能评估：进出水TAN差、硝化速率(g TAN/m²/d)、氧消耗
   - 常见故障排除：硝化崩溃、亚硝酸盐积累、填料结团、短流
   - 季节性调整：冬季低温和夏季高温对硝化效率的影响
3. 包含实例计算和操作检查清单`,
    tags: ['RAS', '生物滤池', '硝化', '水处理'],
  },
  {
    id: 'disease-diagnosis',
    title: '三文鱼常见疾病快速诊断与早期预警手册',
    prompt: `请以水生动物执业兽医的身份，撰写一份详细的诊断手册：三文鱼养殖常见疾病的快速诊断与早期预警。

要求：
1. 长度：至少3000字中文
2. 必须包含：
   - 行为异常识别表：浮头/离群/螺旋游动/擦底/拒食 → 可能的病因
   - 体表症状诊断流程图：鳃色/体色/眼球/腹部/鳍条 → 逐步缩小诊断范围
   - 五种最常见疾病的快速鉴别：弧菌病 vs 疖疮病 vs IPN vs BKD vs 营养性疾病
   - 采样和送检规范：取样数量、保存液、运输条件、必检项目
   - 早发现早处理的黄金4小时行动方案
   - 常用现场检测工具：显微镜检、革兰氏染色、快速试纸
   - 疫情报告流程和生物安全升级措施
3. 使用流程图和决策树格式`,
    tags: ['疾病', '诊断', '预警', '生物安全'],
  },
  {
    id: 'vaccination-program',
    title: '三文鱼疫苗免疫程序与效果评估技术指南',
    prompt: `请以鱼类免疫学专家的身份，撰写一份详细的技术指南：三文鱼养殖疫苗免疫程序设计与效果评估。

要求：
1. 长度：至少3000字中文
2. 必须包含：
   - 核心疫苗清单：弧菌+疖疮三联苗、IPN苗、PD苗、ISA苗的抗原组成和作用机理
   - 不同养殖模式的免疫程序：RAS淡水养殖 vs 网箱海水养殖的差异
   - 接种操作规范：鱼体规格、水温、麻醉、注射部位、针头选择、接种速度
   - 免疫效果评估：抗体滴度检测、攻毒试验、田间保护率计算
   - 免疫失败原因分析：接种时间不当、应激、营养不良、病原变异
   - 新疫苗研发动态：海虱疫苗、AGD疫苗、多价疫苗
   - 成本效益分析：疫苗成本 vs 疾病损失
3. 包含操作步骤和注意事项`,
    tags: ['疫苗', '免疫', '疾病防控', '健康管理'],
  },
  {
    id: 'feed-formulation',
    title: '三文鱼配合饲料配方设计与质量控制标准',
    prompt: `请以水产饲料配方师的身份，撰写一份详细的技术文档：三文鱼配合饲料配方设计与质量控制。

要求：
1. 长度：至少3000字中文
2. 必须包含：
   - 不同生长阶段饲料配方的营养参数表（蛋白/脂肪/纤维/灰分/能值）
   - 原料选择标准：鱼粉、鱼油、大豆蛋白、昆虫蛋白、微藻的品控指标
   - 必需氨基酸平衡：赖氨酸、蛋氨酸、苏氨酸、色氨酸的添加策略
   - 必需脂肪酸：EPA/DHA的最低需求量和来源
   - 功能性添加剂：虾青素、β-葡聚糖、有机硒、酸化剂的推荐剂量
   - 加工工艺参数：膨化温度、模孔直径、烘干温度对营养保留的影响
   - 饲料质量检测：蛋白(凯氏定氮)、脂肪(索氏抽提)、水分、黄曲霉毒素
   - 存储与物流：温湿度控制、保质期管理、先进先出
3. 包含配方案例和成本核算`,
    tags: ['饲料', '配方', '营养', '质量控制'],
  },
  {
    id: 'ras-design',
    title: '陆基三文鱼RAS循环水养殖场设计规范',
    prompt: `请以RAS养殖场设计工程师的身份，撰写一份详细的设计规范：陆基三文鱼RAS循环水养殖场设计。

要求：
1. 长度：至少3000字中文
2. 必须包含：
   - 选址要求：水源水量水质、电力供应、土地面积、交通、环保距离
   - 工艺流程图：进水→养殖池→固液分离→微滤机→生物滤池→脱气塔→增氧→消毒→回水
   - 各单元设计参数：养殖池(圆形/跑道式)、微滤机(过滤精度60-100μm)、MBBR(填充率40-60%)
   - 设备选型：水泵、增氧(纯氧锥/LHO)、UV消毒、臭氧发生器
   - 自动化控制系统：PLC+SCADA架构、关键参数自动调节
   - 生物安全设计：分区管理(红/橙/绿区)、消毒通道、隔离区
   - 投资估算：100吨/年和1000吨/年两种规模的设备清单和预算
   - 能耗分析：电力消耗分布、节能措施
3. 包含设计计算实例`,
    tags: ['RAS', '设计', '养殖场', '工程'],
  },
  {
    id: 'oxygen-management',
    title: '三文鱼养殖溶氧管理策略与增氧技术选型',
    prompt: `请以水产养殖工程师的身份，撰写一份详细的技术文档：三文鱼养殖溶氧管理策略与增氧设备选型。

要求：
1. 长度：至少3000字中文
2. 必须包含：
   - DO对摄食、生长、FCR的定量影响（基于Remen 2016 DOmaxFI模型）
   - 养殖水体耗氧源分析：鱼呼吸(60-70%)、硝化(15-20%)、有机物分解(10-15%)
   - 日耗氧量计算：基于投喂量、鱼体重、水温的O2需求估算公式
   - 增氧设备全面对比：微孔曝气/纳米曝气/纯氧锥/射流/LHO的氧转移效率和能耗
   - 纯氧系统设计：液氧罐选型、气化器、流量控制、安全规范
   - 应急增氧方案：停电时的备用增氧、纯氧储备量计算
   - DO监测：光学探头校准、多点布设、报警联动
3. 包含计算实例和设备选型表`,
    tags: ['溶氧', '增氧', 'DO', '设备'],
  },
  {
    id: 'stress-management',
    title: '三文鱼养殖应激源识别与应激管理技术规程',
    prompt: `请以鱼类生理学专家的身份，撰写一份详细的技术规程：三文鱼养殖应激源识别与应激管理。

要求：
1. 长度：至少3000字中文
2. 必须包含：
   - 应激的生理学基础：皮质醇-儿茶酚胺轴、HSP蛋白、免疫抑制机制
   - 常见应激源分类和评级：
     a) 物理应激：捕捉/分筛/运输/噪音/光照突变
     b) 化学应激：氨氮/亚硝酸盐/pH突变/低氧
     c) 生物应激：密度/等级竞争/病原感染
   - 每类应激的生理指标变化：血糖/皮质醇/乳酸/血浆氯离子
   - 应激预防措施：操作前停食、麻醉规范、水温过渡、运输密度
   - 应激后恢复：营养支持(VC/VE/核苷酸)、环境优化、观察期
   - 慢性应激的隐蔽危害：生长迟缓、免疫下降、FCR升高
3. 包含操作检查清单`,
    tags: ['应激', '福利', '管理', '运输'],
  },
];

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('❌ 未配置 ANTHROPIC_API_KEY');
    process.exit(1);
  }
  const Anthropic = require('@anthropic-ai/sdk');
  const anthropic = new Anthropic({ apiKey });

  await vstore.init();
  let totalDocs = 0, totalChars = 0;

  async function addDoc(result) {
    const info = { ...result.metadata, title: result.title };
    const texts = result.chunks.map(c => c.text);
    const embs = await embedBatch(texts);
    const r = await vstore.addDocument(info, result.chunks, embs);
    totalDocs++; totalChars += r.totalChars;
    return r;
  }

  console.log(`🤖 使用 Claude API 生成 ${TOPICS.length} 个专业知识文档\n`);

  for (let i = 0; i < TOPICS.length; i++) {
    const topic = TOPICS[i];
    console.log(`[${i+1}/${TOPICS.length}] 📝 ${topic.title}`);

    try {
      const msg = await anthropic.messages.create({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
        max_tokens: 4000,
        system: '你是一位资深的三文鱼养殖技术专家，拥有20年一线经验和10年科研背景。请严格按照用户的要求撰写专业技术文档。使用Markdown格式，包含表格、列表和实例。语言专业但不生硬，给出可操作的具体建议。',
        messages: [{ role: 'user', content: topic.prompt }],
      });

      const textBlock = [...msg.content].reverse().find(b => b.type === 'text');
      if (!textBlock?.text) { console.log('  ⚠️ API返回空'); continue; }

      const content = textBlock.text;
      console.log(`  📄 ${(content.length/1000).toFixed(1)}K字`);

      const result = await ingestText(content, {
        title: topic.title,
        author: 'SalmonFeeding AI 知识工程',
        sourceType: 'manual',
        sourceName: 'Claude生成专业知识',
        tags: [...topic.tags, 'AI生成'],
      });

      const r = await addDoc(result);
      console.log(`  ✅ [${r.chunkCount}块 ${r.totalChars}字]`);

    } catch(e) {
      console.log(`  ❌ ${e.message}`);
    }

    // 避免 API 限流
    if (i < TOPICS.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  const s = vstore.getStats();
  console.log('\n' + '='.repeat(55));
  console.log(`  🎉 文档生成完毕`);
  console.log(`  新增: ${totalDocs} 篇 · ${(totalChars/10000).toFixed(1)} 万字`);
  console.log(`  总计: ${s.documentCount} 篇 · ${(s.totalChars/10000).toFixed(1)} 万字`);
  console.log('='.repeat(55));
}

// Load .env first
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
main().catch(e => { console.error(e); process.exit(1); });
