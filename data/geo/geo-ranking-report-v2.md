# GEO 排名分析报告 (v2)

> 生成时间：2026-05-19 | 查询：广东服装加工企业排名
> v2 改进：优化了 DeepSeek 外链提取策略（扩展到全页面扫描），新增 360AI/纳米AI 引擎

---

## 一、测试总览

| 指标 | v1 | v2 | 变化 |
|------|----|----|------|
| 测试引擎数 | 10 | 10 | 不变 |
| 含外链引擎数 | 3 | 3 | 不变 |
| 总 URL 数 | 20 | **116** | +480% |
| 去噪后 URL 数 | 20 | **74** | +270% |
| 去重域名数 | 12 | **55** | +358% |

### 引擎状态明细

| 引擎 | 状态 | 总 URL | 域名数 | 耗时 | 备注 |
|------|------|:------:|:-------:|------|------|
| DeepSeek | SUCCESS | 99 | 48 | 35.1s | 含 37 个 cdn.deepseek.com 图片资源 |
| Kimi | SUCCESS | 12 | 8 | 60.2s | 含 moonshot.ai/platform.kimi.ai 自身链接 |
| 元宝 | SUCCESS | 2 | 2 | 17.0s | v1 为 0，v2 突破提取 |
| 360AI(纳米AI) | MINIMAL | 2 | 2 | 51.2s | 仅图片资源 URL，非内容外链 |
| 智谱 | MINIMAL | 1 | 1 | 19.1s | 仅备案网站，非有效外链 |
| 豆包 | ZERO_URLS | 0 | 0 | 25.1s | 联网搜索未启用 |
| 文心 | ZERO_URLS | 0 | 0 | 61.2s | 超时，未提取到 URL |
| 秘塔 | ZERO_URLS | 0 | 0 | 25.1s | v1 有 5 个 URL，v2 反而未提取到 |
| 天工 | ERROR | 0 | 0 | N/A | 元素在视口外无法点击 |
| 通义千问 | TIMEOUT | 0 | 0 | 60s+ | 引擎未返回有效回复 |

> **去噪说明**：去除 cdn.deepseek.com(37)、moonshot.ai(1)、platform.kimi.ai(1)、beian.miit.gov.cn(1)、zhaomi.cn 图片(2) 等非内容链接后，有效 URL 为 **74** 个，有效域名 **55** 个。

---

## 二、域名排名 Top 20

按"总频次"降序，并列按"域名"排序。仅统计去噪后的有效域名。

| 排名 | 域名 | 被引擎引用数 | 总频次 | 来源引擎 | 所属平台 |
|:---:|------|:-----------:|:------:|----------|----------|
| 1 | **baike.baidu.com** | 1 | 8 | DeepSeek(8) | 百度百科 |
| 2 | **info.texnet.com.cn** | 1 | 4 | DeepSeek(4) | 中国纺织网 |
| 3 | **m.jobui.com** | 1 | 4 | Kimi(4) | 职友集 |
| 4 | **ctie.webtex.cn** | 1 | 2 | DeepSeek(2) | 中国纺织经济信息网 |
| 5 | **news.efu.com.cn** | 1 | 2 | DeepSeek(2) | 中国服装网 |
| 6 | **ep.ycwb.com** | 1 | 2 | DeepSeek(2) | 羊城晚报 |
| 7 | **wenku.baidu.com** | 1 | 2 | DeepSeek(2) | 百度文库 |
| 8 | **ctn1986.com** | 1 | 2 | DeepSeek(2) | 中国纺织报 |
| 9 | **app.mokahr.com** | 1 | 2 | Kimi(2) | MokaHR 招聘 |
| 10 | **dg.gov.cn** | 1 | 1 | DeepSeek(1) | 东莞市政府 |
| 11 | **m.163.com / 163.com** | 1 | 2 | DeepSeek(1+1) | 网易号 |
| 12 | **sohu.com / m.sohu.com** | 1 | 2 | DeepSeek(1+1) | 搜狐号 |
| 13 | **m.itouchtv.cn** | 1 | 1 | DeepSeek(1) | 艾瑞咨询 |
| 14 | **gdfashionweek.com** | 1 | 1 | DeepSeek(1) | 广东时装周 |
| 15 | **huaon.com** | 1 | 1 | DeepSeek(1) | 华经情报网 |
| 16 | **tianyancha.com** | 1 | 1 | 元宝(1) | 天眼查 |
| 17 | **corp.efu.com.cn** | 1 | 1 | 元宝(1) | 中国服装网 |
| 18 | **epaper.nfnews.com** | 1 | 1 | Kimi(1) | 南方日报 |
| 19 | **dayaotex.com** | 1 | 1 | Kimi(1) | 大耀纺织 |
| 20 | **jiangmen.gov.cn** | 1 | 1 | Kimi(1) | 江门市政府 |

> **关键发现**：v2 中无任何域名被 **2 个以上引擎** 同时引用（v1 中 163.com 被 3 个引擎引用）。原因是 v2 秘塔引擎未能提取到 URL，导致跨引擎重合度降低。

---

## 三、平台排名 Top 15（按可发帖/可运营平台聚合）

| 排名 | 平台 | 覆盖引擎数 | 总频次 | 对应域名 | 价值评级 |
|:---:|------|:---------:|:------:|----------|:--------:|
| 1 | **中国服装网** | 2 | 5 | news.efu.com.cn、corp.efu.com.cn、yun-f.cfw.cn、cxo.cfw.cn | ⭐⭐⭐⭐⭐ |
| 2 | **百度百科** | 1 | 10 | baike.baidu.com、bkso.baidu.com、wapbaike.baidu.com | ⭐⭐⭐⭐⭐ |
| 3 | **中国纺织网** | 1 | 6 | info.texnet.com.cn、ctc.webtex.cn、news.webtex.cn | ⭐⭐⭐⭐ |
| 4 | **职友集** | 1 | 4 | m.jobui.com | ⭐⭐⭐⭐ |
| 5 | **中国纺织经济信息网** | 1 | 3 | ctie.webtex.cn、news.ctei.cn | ⭐⭐⭐⭐ |
| 6 | **羊城晚报** | 1 | 3 | ep.ycwb.com、wap.ycwb.com | ⭐⭐⭐ |
| 7 | **百度文库** | 1 | 2 | wenku.baidu.com | ⭐⭐⭐ |
| 8 | **中国纺织报** | 1 | 2 | ctn1986.com | ⭐⭐⭐ |
| 9 | **网易号** | 1 | 2 | m.163.com、163.com | ⭐⭐⭐ |
| 10 | **搜狐号** | 1 | 2 | m.sohu.com、sohu.com | ⭐⭐⭐ |
| 11 | **MokaHR 招聘** | 1 | 2 | app.mokahr.com | ⭐⭐ |
| 12 | **天眼查** | 1 | 1 | tianyancha.com | ⭐⭐ |
| 13 | **艾瑞咨询** | 1 | 1 | m.itouchtv.cn | ⭐⭐ |
| 14 | **华经情报网** | 1 | 1 | huaon.com | ⭐⭐ |
| 15 | **广东时装周** | 1 | 1 | gdfashionweek.com | ⭐⭐ |

> 价值评级依据：引擎覆盖数（权重 50%）+ 总频次（权重 30%）+ 平台可操作性（权重 20%）

---

## 四、v1 vs v2 对比分析

### 4.1 URL 数量对比

| 引擎 | v1 URL 数 | v2 URL 数 | 变化 | 说明 |
|------|:---------:|:---------:|------|------|
| DeepSeek | 1 | 99 | **+98** | v2 扩展到全页面扫描，大幅提升提取量 |
| Kimi | 12 | 12 | 不变 | 提取策略相同 |
| 元宝 | 0 | 2 | **+2** | v2 优化后首次提取到外链 |
| 秘塔 | 5 | 0 | **-5** | v2 未提取到，可能是页面结构变化 |
| 360AI(纳米AI) | 0* | 2 | **+2** | v1 未测试/v2 新增引擎 |
| 智谱 | 0 | 1 | **+1** | v2 检测到备案链接 |
| **合计(去噪)** | **20** | **74** | **+270%** | 有效外链数大幅增长 |

> *v1 中纳米AI 因落地页需登录而失败，v2 替换为 360AI 引擎测试

### 4.2 核心变化

| 维度 | v1 | v2 | 解读 |
|------|----|----|------|
| 跨引擎重合度 | 163.com 被 3 引擎引用 | 无域名被 2+ 引擎引用 | 秘塔 v2 未提取导致重合消失 |
| 行业垂直度 | 通用平台为主 | **纺织服装行业平台占 60%+** | DeepSeek 全页面扫描暴露了更多行业垂域来源 |
| 域名多样性 | 12 个域名 | 55 个域名 | v2 覆盖面大幅扩展 |
| 可发帖平台 | 网易号、艾瑞咨询等通用平台 | 中国服装网、纺织网等垂域平台 | 行业垂直平台成为 GEO 新重点 |

---

## 五、关键洞察

### DeepSeek 是 GEO 外链数据量最大的引擎

DeepSeek v2 提取了 **99 个 URL**（去噪后 62 个），覆盖 **48 个域名**，占 v2 全部有效外链的 **84%**。其引用来源以纺织服装行业垂直网站为主，反映 DeepSeek 在行业类查询中倾向于引用专业垂域内容。

### 纺织服装行业平台是 GEO 的新蓝海

v2 揭示了一个 v1 未发现的现象：AI 搜索引擎（特别是 DeepSeek）在回答"广东服装加工企业"类查询时，大量引用行业垂直平台：

| 行业垂域 | 频次 | 占比 |
|----------|:----:|:----:|
| 中国纺织网/纺织经济信息网 | 9 | 12.2% |
| 中国服装网 | 5 | 6.8% |
| 中国纺织报 | 2 | 2.7% |
| 全球纺织网/纺织网等 | 3 | 4.1% |
| **行业垂域合计** | **19** | **25.7%** |

### 跨引擎共识缺失是 v2 的最大遗憾

v1 中 163.com 被 3 个引擎同时引用，是 GEO 外链的"共识平台"。但 v2 中秘塔未提取到任何 URL，导致**没有任何域名被 2 个以上引擎同时引用**。这说明：
- 单次测试结果波动较大，需多次测试取平均值
- 秘塔引擎的页面交互稳定性需要改进

### 元宝引擎的突破

v1 中元宝为"纯文本回复"（0 个外链），v2 成功提取到 2 个 URL（中国服装网、天眼查），说明元宝在某些查询场景下也会提供外链引用。

---

## 六、发帖策略建议

### 优先级 1：行业垂直平台（新发现）

| 平台 | 理由 | 操作建议 |
|------|------|----------|
| **中国服装网 (efu.com.cn / cfw.cn)** | 唯一被 DeepSeek+元宝 2 个引擎引用的平台 | 发布企业介绍、产品展示、行业分析文章 |
| **中国纺织网 (texnet.com.cn)** | DeepSeek 引用 6 次，频次第 3 | 发布行业新闻、企业动态 |
| **中国纺织经济信息网 (ctei.cn / webtex.cn)** | DeepSeek 引用 3 次 | 发布行业研究报告、数据统计 |

### 优先级 2：通用高权重平台（v1 验证 + v2 再次验证）

| 平台 | 理由 | 操作建议 |
|------|------|----------|
| **百度百科** | DeepSeek 引用 10 次（频次最高） | 创建/编辑企业词条、品牌词条 |
| **百度文库** | DeepSeek 引用 2 次 | 上传行业报告、企业白皮书 |
| **网易号** | v1 被 3 引擎引用，v2 被 DeepSeek 引用 | 发布行业观点、企业新闻 |
| **搜狐号** | DeepSeek 引用 2 次 | 同步网易号内容 |

### 优先级 3：企业信息平台

| 平台 | 理由 | 操作建议 |
|------|------|----------|
| **天眼查** | 元宝引用 | 完善企业基本信息、经营范围 |
| **职友集 (jobui.com)** | Kimi 引用 4 次 | 完善企业招聘页面、公司评价 |
| **MokaHR** | Kimi 引用 2 次 | 发布招聘信息 |

### 优先级 4：政务/媒体平台

| 平台 | 理由 | 操作建议 |
|------|------|----------|
| **政府网站 (.gov.cn)** | DeepSeek 引用东莞/江门/顺德政府网站 | 联系当地经信局、商务局争取官方报道 |
| **羊城晚报** | DeepSeek 引用 3 次 | 联系记者进行企业采访报道 |

---

## 七、局限性说明

1. **单次查询局限**：仅针对"广东服装加工企业排名"单一查询，不同行业/查询类型的外链分布可能差异巨大
2. **秘塔数据缺失**：v2 秘塔引擎未提取到任何 URL（v1 有 5 个），可能存在页面加载/交互问题，导致跨引擎分析不完整
3. **DeepSeek 图片资源干扰**：cdn.deepseek.com 占 99 个 URL 中的 37 个（37.4%），实际有效外链为 62 个
4. **引擎状态不稳定**：天工(错误)、通义千问(超时)、文心(超时) 3 个引擎未能正常返回，实际有效测试引擎仅 7 个
5. **时间维度缺失**：仅反映测试时刻的外链状态，未跟踪不同时间段的变化趋势
6. **360AI/纳米AI 数据质量低**：仅提取到图片资源 URL，无有效内容外链

---

## 八、附录：完整去噪域名列表（55 个）

### DeepSeek 来源（47 个域名，62 个有效 URL）

baike.baidu.com(8), info.texnet.com.cn(4), ctie.webtex.cn(2), news.efu.com.cn(2), ep.ycwb.com(2), wenku.baidu.com(2), ctn1986.com(2), lfnews.cn(1), dg.gov.cn(1), huaon.com(1), xudoodoo.com(1), guangdong.emagecompany.com(1), pub.timedg.com(1), appzdg.sun0769.com(1), cnga.org.cn(1), ctc.webtex.cn(1), m.163.com(1), tex1951.com(1), m.itouchtv.cn(1), news.webtex.cn(1), static.nfapp.southcn.com(1), workercn.cn(1), alltextile.cn(1), gdfashionweek.com(1), bkso.baidu.com(1), gb.bestgarmentgroup.com(1), offmessageblog.com(1), 163.com(1), gztit.com(1), cfmag.com.cn(1), shunde.gov.cn(1), act.chinatt315.org.cn(1), sdjyt.shunde.gov.cn(1), wapbaike.baidu.com(1), yun-f.cfw.cn(1), huangyewang.cn(1), m.sohu.com(1), sj.qichamao.com(1), chinayarn.com(1), zbzlpp.zbqim.com.cn(1), textileschamber.com.hk(1), cxo.cfw.cn(1), gd.gov.cn(1), wap.ycwb.com(1), huacheng.gz-cmc.com(1), sohu.com(1), news.ctei.cn(1)

### Kimi 来源（6 个有效域名，10 个有效 URL）

m.jobui.com(4), app.mokahr.com(2), epaper.nfnews.com(1), dayaotex.com(1), oxfordfabrics.com(1), jiangmen.gov.cn(1)

### 元宝来源（2 个域名，2 个 URL）

corp.efu.com.cn(1), tianyancha.com(1)
