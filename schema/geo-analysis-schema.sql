-- GEO Analysis Database Schema
-- 用于存储 AI 搜索引擎采集的数据

-- 搜索结果表
CREATE TABLE IF NOT EXISTS search_results (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  engine TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  total INTEGER NOT NULL,
  duration TEXT,
  ai_response TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- 搜索结果项表
CREATE TABLE IF NOT EXISTS search_result_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  search_result_id TEXT NOT NULL,
  title TEXT,
  url TEXT NOT NULL,
  snippet TEXT,
  position INTEGER NOT NULL,
  ai_summary TEXT,
  FOREIGN KEY (search_result_id) REFERENCES search_results(id) ON DELETE CASCADE
);

-- 域名统计表
CREATE TABLE IF NOT EXISTS domain_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL UNIQUE,
  count INTEGER DEFAULT 0,
  platform TEXT,
  first_seen INTEGER,
  last_seen INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- 域名历史表
CREATE TABLE IF NOT EXISTS domain_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL,
  search_result_id TEXT NOT NULL,
  count INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (search_result_id) REFERENCES search_results(id) ON DELETE CASCADE,
  FOREIGN KEY (domain) REFERENCES domain_stats(domain) ON DELETE CASCADE
);

-- 引擎信息表
CREATE TABLE IF NOT EXISTS engine_info (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  search_result_id TEXT NOT NULL UNIQUE,
  engine_name TEXT NOT NULL,
  login_status TEXT,
  internet_search_enabled INTEGER,
  internet_search_details TEXT,
  upload_image INTEGER DEFAULT 0,
  upload_file INTEGER DEFAULT 0,
  FOREIGN KEY (search_result_id) REFERENCES search_results(id) ON DELETE CASCADE
);

-- 趋势数据表
CREATE TABLE IF NOT EXISTS trends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL,
  date TEXT NOT NULL,
  count INTEGER NOT NULL,
  growth_rate REAL,
  trend TEXT CHECK(trend IN ('up', 'down', 'stable')),
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  UNIQUE(domain, date)
);

-- 企业信息表
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  type TEXT CHECK(type IN ('job-platform', 'media', 'gov', 'ai-platform', 'enterprise', 'other')),
  url TEXT,
  description TEXT,
  score INTEGER DEFAULT 0,
  occurrences INTEGER DEFAULT 0,
  first_seen INTEGER,
  last_seen INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- 企业引擎关联表
CREATE TABLE IF NOT EXISTS company_engines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  engine TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  UNIQUE(company_id, engine)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_search_results_query ON search_results(query);
CREATE INDEX IF NOT EXISTS idx_search_results_engine ON search_results(engine);
CREATE INDEX IF NOT EXISTS idx_search_results_timestamp ON search_results(timestamp);
CREATE INDEX IF NOT EXISTS idx_search_result_items_url ON search_result_items(url);
CREATE INDEX IF NOT EXISTS idx_domain_stats_domain ON domain_stats(domain);
CREATE INDEX IF NOT EXISTS idx_domain_stats_platform ON domain_stats(platform);
CREATE INDEX IF NOT EXISTS idx_domain_history_domain ON domain_history(domain);
CREATE INDEX IF NOT EXISTS idx_domain_history_timestamp ON domain_history(timestamp);
CREATE INDEX IF NOT EXISTS idx_trends_domain ON trends(domain);
CREATE INDEX IF NOT EXISTS idx_trends_date ON trends(date);
CREATE INDEX IF NOT EXISTS idx_companies_domain ON companies(domain);
CREATE INDEX IF NOT EXISTS idx_companies_type ON companies(type);
CREATE INDEX IF NOT EXISTS idx_companies_score ON companies(score);

-- 触发器：更新域名统计表的 updated_at
CREATE TRIGGER IF NOT EXISTS update_domain_stats_updated_at
AFTER UPDATE ON domain_stats
FOR EACH ROW
BEGIN
  UPDATE domain_stats SET updated_at = strftime('%s', 'now') WHERE id = NEW.id;
END;

-- 触发器：更新企业信息表的 updated_at
CREATE TRIGGER IF NOT EXISTS update_companies_updated_at
AFTER UPDATE ON companies
FOR EACH ROW
BEGIN
  UPDATE companies SET updated_at = strftime('%s', 'now') WHERE id = NEW.id;
END;

-- 视图：域名排名
CREATE VIEW IF NOT EXISTS domain_rankings AS
SELECT 
  d.domain,
  d.count,
  d.platform,
  d.first_seen,
  d.last_seen,
  (SELECT COUNT(*) FROM domain_history WHERE domain = d.domain) as occurrences,
  ROUND((d.count * 1.0 / (SELECT MAX(count) FROM domain_stats)) * 100, 2) as rank_score
FROM domain_stats d
ORDER BY d.count DESC;

-- 视图：企业排名
CREATE VIEW IF NOT EXISTS company_rankings AS
SELECT 
  c.name,
  c.domain,
  c.type,
  c.score,
  c.occurrences,
  GROUP_CONCAT(ce.engine, ', ') as engines,
  c.first_seen,
  c.last_seen
FROM companies c
LEFT JOIN company_engines ce ON c.id = ce.company_id
GROUP BY c.id
ORDER BY c.score DESC;

-- 视图：趋势分析
CREATE VIEW IF NOT EXISTS trend_analysis AS
SELECT 
  t.domain,
  t.date,
  t.count,
  t.growth_rate,
  t.trend,
  d.platform
FROM trends t
LEFT JOIN domain_stats d ON t.domain = d.domain
ORDER BY ABS(t.growth_rate) DESC;

-- 初始化数据
INSERT OR IGNORE INTO companies (name, domain, type) VALUES
  ('Kimi', 'kimi.moonshot.cn', 'ai-platform'),
  ('DeepSeek', 'deepseek.com', 'ai-platform'),
  ('OpenAI', 'openai.com', 'ai-platform'),
  ('知乎', 'zhihu.com', 'media'),
  ('掘金', 'juejin.cn', 'media'),
  ('CSDN', 'csdn.net', 'media');
