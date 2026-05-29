# 把每天 30 分钟的浏览器重复操作变成一条 Cron 命令

早上到工位，泡杯咖啡，打开电脑。

然后呢？

登录 Google Search Console，看一眼昨天的索引量。切到 Ahrefs，查一下几个核心关键词的排名变化。打开百度站长平台，手动提交一下昨晚新发的三篇文章的链接。再切到友链检查工具，看看那几个交换的友情链接还在不在。

完了？还没。还要打开 Medium，把昨天写好的草稿发布。打开 Dev.to，再发一遍。Reddit 相关 subreddit 也要贴一下。

等你做完这些，咖啡凉了，一上午过去了三分之一。

## 这些操作有什么共同点？

仔细想想，上面这些操作有一个共同的模式：

1. 打开浏览器
2. 导航到某个页面
3. 登录（如果 session 过期了还要重新来）
4. 找到对应的输入框或按钮
5. 填内容 / 点按钮
6. 等待结果
7. 关掉标签页

每一步都不难，但每一步都要你**亲自操作**。你的手在鼠标和键盘之间来回切换，眼睛在十几个标签页之间来回跳。

问题是——你是一个拿工资的工程师，不是一个人肉 Selenium。

如果这些操作能变成命令行呢？

```bash
# 提交 sitemap
seo ping --sitemap https://mysite.com/sitemap.xml

# 查 Google 排名
google search "我的关键词" --json | jq '.[0].position'

# 发布文章
devto publish --file article.md --tags "javascript,webdev"

# 检查友链
curl-check --url https://partner.com --find "mysite.com"
```

一行命令，回车，完事。

## 从手动到自动：三步走

### 第一步：把操作抽象成命令

任何浏览器操作，本质上都可以拆成：打开页面 → 定位元素 → 执行动作 → 获取结果。

比如"提交 sitemap 到 Google"，手动操作是这样的：

1. 打开 https://www.google.com/ping?sitemap=
2. 在 URL 后面拼上你的 sitemap 地址
3. 回车
4. 看到成功提示

这玩意用 CLI 来做，就是一行：

```bash
xbrowser navigate "https://www.google.com/ping?sitemap=https://mysite.com/sitemap.xml"
```

再比如"检查某篇新文章在 Google 的收录情况"，手动要做的事：

1. 打开 Google
2. 搜索 `site:mysite.com/my-new-article`
3. 看有没有结果

CLI 版：

```bash
xbrowser google search "site:mysite.com/my-new-article" --json
```

返回的是结构化 JSON，你可以用 `jq` 过滤、用 `grep` 搜索、用管道拼接到其他命令。

### 第二步：把命令组装成脚本

单个命令解决单个操作。但你的日常工作是一系列操作的组合——每天早上都要跑一遍的那种。

那就写个脚本：

```bash
#!/bin/bash
# daily-seo-check.sh

SITE="https://mysite.com"
KEYWORDS=("javascript tutorial" "node.js guide" "react best practices")
LOG_FILE="/var/log/seo-$(date +%Y%m%d).log"

echo "=== SEO Daily Report $(date) ===" >> "$LOG_FILE"

# 提交 sitemap
echo "[1/4] Submitting sitemap..." >> "$LOG_FILE"
xbrowser seo ping --sitemap "$SITE/sitemap.xml" >> "$LOG_FILE" 2>&1

# 检查排名
echo "[2/4] Checking rankings..." >> "$LOG_FILE"
for kw in "${KEYWORDS[@]}"; do
  position=$(xbrowser google search "$kw" --json | jq -r '.[0].position // "Not found"')
  echo "  $kw: Position $position" >> "$LOG_FILE"
done

# 检查索引量
echo "[3/4] Checking index count..." >> "$LOG_FILE"
count=$(xbrowser google search "site:$SITE" --json | jq 'length')
echo "  Indexed pages: $count" >> "$LOG_FILE"

# 检查友链
echo "[4/4] Checking backlinks..." >> "$LOG_FILE"
while IFS=',' read -r url anchor; do
  found=$(xbrowser crawl "$url" --find "$anchor" | jq -r '.found')
  echo "  $url: $found" >> "$LOG_FILE"
done < backlinks.csv

echo "Done. Report saved to $LOG_FILE"
```

这个脚本做了你每天早上要做的所有事——提交 sitemap、查排名、看索引量、检查友链。

运行一次试试：

```bash
chmod +x daily-seo-check.sh
./daily-seo-check.sh
```

20 秒后，你拿到了今天的数据。没有打开浏览器，没有点来点去，没有等页面加载。

### 第三步：交给 Cron 定时执行

脚本写好了，手动跑一次只要 20 秒。但你还是会忘。

那就让机器自己跑：

```bash
# 编辑 crontab
crontab -e
```

加上这几行：

```bash
# 每天早上 9 点执行 SEO 检查
0 9 * * * /home/user/scripts/daily-seo-check.sh

# 每小时检查核心关键词排名，追加到日志
0 * * * * xbrowser google search "javascript tutorial" --json >> /var/log/rankings-hourly.log

# 每天凌晨 3 点提交 sitemap（避开白天高峰）
0 3 * * * xbrowser seo ping --sitemap https://mysite.com/sitemap.xml

# 每周一早上 8 点检查友链
0 8 * * 1 /home/user/scripts/check-backlinks.sh
```

保存退出。从现在开始，这些事情自动完成。

你每天到工位要做的第一件事，不是打开浏览器，而是打开日志文件看看昨晚的自动任务跑得怎么样：

```bash
cat /var/log/seo-$(date +%Y%m%d).log
```

输出大概长这样：

```
=== SEO Daily Report 2025-01-15 09:00:01 ===
[1/4] Submitting sitemap... OK
[2/4] Checking rankings...
  javascript tutorial: Position 7
  node.js guide: Position 12
  react best practices: Position 3
[3/4] Checking index count...
  Indexed pages: 847
[4/4] Checking backlinks...
  https://partner1.com: found
  https://partner2.com: found
  https://partner3.com: NOT FOUND ⚠️
Done.
```

30 秒看完，比手动操作快了不知道多少倍。

## 不只是 SEO：任何重复的浏览器操作都能自动化

也许你不是 SEO 工程师。但你一定有自己每天重复的浏览器操作。

**开发者**：每天检查 GitHub Actions 的构建状态？CI 跑完了没有？npm 包发布成功了没有？

```bash
# 每小时检查 CI 状态
0 * * * * xbrowser github actions --repo myorg/myrepo --status failed >> /var/log/ci-monitor.log
```

**内容创作者**：每天要在 Medium、Dev.to、Hashnode 同步发文？

```bash
# 一键发布到多平台
xbrowser devto publish --file article.md --tags "js,webdev"
xbrowser medium publish --file article.md --tags "javascript,web-development"
```

**电商运营**：每天要查竞品价格、看自己的店铺评分、检查库存预警？

```bash
# 每天早上查竞品价格
0 8 * * * xbrowser crawl "https://competitor.com/product/123" --extract '.price' >> /var/log/price-monitor.log
```

**社交媒体管理**：定时发帖、查互动数据、监控品牌提及？

```bash
# 每小时检查品牌提及
0 * * * * xbrowser twitter search "mybrand" --json | jq '.[].text' >> /var/log/brand-mentions.log
```

关键不是具体做什么——关键是**模式是一样的**。

## 管道的力量：CLI 真正的优势

也许你会说："我用 Python 脚本也能做这些事啊。"

没错。但 CLI 有一个 Python 脚本做不到的事：**管道组合**。

```bash
# 查排名 → 过滤前 10 → 发到 Slack
xbrowser google search "javascript tutorial" --json \
  | jq '[.[] | select(.position <= 10)]' \
  | curl -X POST "$SLACK_WEBHOOK" -d @-
```

```bash
# 抓竞品价格 → 比对阈值 → 邮件告警
xbrowser crawl "$COMPETITOR_URL" --extract '.price' \
  | awk -v threshold=99 '{if ($1 < threshold) print "ALERT: Competitor price dropped to " $1}' \
  | mail -s "Price Alert" me@example.com
```

```bash
# 每日 SEO 报告 → 生成 Markdown → 转成 PDF → 发邮件
cat /var/log/seo-$(date +%Y%m%d).log \
  | pandoc -f markdown -o /tmp/seo-report.pdf \
  | mail -s "Daily SEO Report" team@example.com -A /tmp/seo-report.pdf
```

每个命令做好一件事，管道把它们串起来。这是 Unix 哲学的核心——也是 CLI 自动化比写脚本更优雅的地方。

你不需要为一个新需求写一个新脚本。你只需要把已有的命令用管道重新组合。

## 常见的顾虑

**"自动操作会不会被封号？"**

频率控制好就行。Cron 最小粒度是分钟级，你设置成每小时一次，没有人会把你当机器人。就像你自己手动操作一样——只不过你不用亲自坐在电脑前。

**"万一操作失败了怎么办？"**

脚本能做的事情，cron 也能做：加错误处理、写日志、失败时发通知。

```bash
# 失败时发邮件通知
0 9 * * * /home/user/scripts/daily-seo.sh || echo "SEO check failed" | mail -s "Alert" me@example.com
```

或者更精细一点，在脚本里加 `set -e` 和 `trap`：

```bash
#!/bin/bash
set -euo pipefail

cleanup() {
  echo "Script failed at line $1" | mail -s "SEO Script Error" me@example.com
}
trap 'cleanup $LINENO' ERR
```

**"我没有服务器，本地电脑能跑 cron 吗？"**

macOS 有 `launchd`（比 cron 更强大），Linux 有 `systemd timers`，Windows 有"任务计划程序"。当然，cron 也到处都能用。

如果你有一台闲置的 VPS（每月 5 美元那种），那就更简单了——把脚本扔上去，cron 一配，再也不用管。

## 算一笔时间账

保守估计，一个 SEO 工程师每天在浏览器上做的重复操作：

| 操作 | 手动耗时 | CLI 耗时 |
|------|---------|---------|
| 提交 sitemap | 3 分钟 | 2 秒 |
| 查 5 个关键词排名 | 10 分钟 | 10 秒 |
| 检查索引量 | 2 分钟 | 2 秒 |
| 检查 10 个友链 | 15 分钟 | 5 秒 |
| 发布到 3 个平台 | 10 分钟 | 15 秒 |
| 查竞品价格 | 5 分钟 | 3 秒 |
| **合计** | **45 分钟** | **37 秒** |

每天省 45 分钟，一个月省 22.5 小时——将近三个工作日。

这些时间拿来写代码、做分析、甚至摸鱼，不比在浏览器里点来点去强？

## 立刻能做的事

如果你今天就想开始，建议从**最小的自动化**做起：

1. 找出你今天重复最多的一次浏览器操作
2. 用 CLI 命令完成同样的操作
3. 确认结果正确
4. 写进 cron

不需要一次性把所有操作都自动化。先自动化一个，省出时间，再自动化下一个。

渐进式的，不急。

---

我最近在用 [xbrowser](https://github.com/yanqdinho/xbrowser) 做这些事——它是一个浏览器自动化 CLI 工具，把 Puppeteer 的能力封装成了命令行接口，支持 Google 搜索、网页抓取、SEO ping 等常用操作，也可以配合 cron 实现定时自动化。如果你也有类似的日常重复操作，可以试试。
