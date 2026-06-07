import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

interface ProvinceRow { province: string; years: Record<string, number> }
interface TreeNode { id: string; name: string; children: TreeNode[] }

var BASE_URL = 'https://data.stats.gov.cn/';
var API_BASE = '/dg/website/publicrelease/web/external';
var ROOT_CID = 'c4d82af16c3d4f0cb4f09d4af7d5888e';
var PK = ['北京','天津','河北','山西','内蒙古','辽宁','吉林','黑龙江','上海','江苏','浙江','安徽','福建','江西','山东','河南','湖北','湖南','广东','广西','海南','重庆','四川','贵州','云南','西藏','陕西','甘肃','青海','宁夏','新疆','香港','澳门','台湾'];

var PROVINCE_CODES: Array<{text: string; value: string}> = [
  {text:'北京市',value:'110000000000'},{text:'天津市',value:'120000000000'},{text:'河北省',value:'130000000000'},
  {text:'山西省',value:'140000000000'},{text:'内蒙古自治区',value:'150000000000'},{text:'辽宁省',value:'210000000000'},
  {text:'吉林省',value:'220000000000'},{text:'黑龙江省',value:'230000000000'},{text:'上海市',value:'310000000000'},
  {text:'江苏省',value:'320000000000'},{text:'浙江省',value:'330000000000'},{text:'安徽省',value:'340000000000'},
  {text:'福建省',value:'350000000000'},{text:'江西省',value:'360000000000'},{text:'山东省',value:'370000000000'},
  {text:'河南省',value:'410000000000'},{text:'湖北省',value:'420000000000'},{text:'湖南省',value:'430000000000'},
  {text:'广东省',value:'440000000000'},{text:'广西壮族自治区',value:'450000000000'},{text:'海南省',value:'460000000000'},
  {text:'重庆市',value:'500000000000'},{text:'四川省',value:'510000000000'},{text:'贵州省',value:'520000000000'},
  {text:'云南省',value:'530000000000'},{text:'西藏自治区',value:'540000000000'},{text:'陕西省',value:'610000000000'},
  {text:'甘肃省',value:'620000000000'},{text:'青海省',value:'630000000000'},{text:'宁夏回族自治区',value:'640000000000'},
  {text:'新疆维吾尔自治区',value:'650000000000'},{text:'香港特别行政区',value:'810000000000'},
  {text:'澳门特别行政区',value:'820000000000'},{text:'台湾省',value:'710000000000'},
];

function gp(ctx: Record<string, unknown>): import('../types').Page {
  var p = ctx.page as import('../types').Page | undefined;
  if (!p) throw new Error('需要浏览器页面，请使用 --cdp 9221');
  return p;
}

async function ensureOnSite(page: import('../types').Page): Promise<void> {
  if (page.url().indexOf('data.stats.gov.cn') >= 0) return;
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2000);
}

async function apiCall(page: import('../types').Page, path: string, body?: unknown): Promise<unknown> {
  await ensureOnSite(page);
  return page.evaluate(function(args: {apiBase: string; path: string; body?: string}) {
    var url = args.apiBase + args.path;
    var opts: RequestInit = { method: 'GET', credentials: 'include' };
    if (args.body) {
      opts.method = 'POST';
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = args.body;
    }
    return fetch(url, opts).then(function(r) { return r.json(); });
  }, { apiBase: API_BASE, path: path, body: body ? JSON.stringify(body) : undefined });
}

async function getTreeNodes(page: import('../types').Page, pid: string): Promise<TreeNode[]> {
  var data = await apiCall(page, '/new/queryIndexTreeAsync?pid=' + pid + '&code=6') as any;
  var raw = (data && data.data) || [];
  return raw.map(function(n: any) { return { id: n._id || n.id, name: n._name || n.name, children: [] }; });
}

async function findIndicatorId(page: import('../types').Page, name: string): Promise<{cid: string; indicatorId: string} | null> {
  var rootNodes = await getTreeNodes(page, '');
  for (var i = 0; i < rootNodes.length; i++) {
    var childNodes = await getTreeNodes(page, rootNodes[i].id);
    for (var j = 0; j < childNodes.length; j++) {
      if (childNodes[j].name === name || childNodes[j].name.indexOf(name) >= 0) {
        var indicators = await apiCall(page, '/new/queryIndicatorsByCid?cid=' + childNodes[j].id + '&dt=&name=') as any;
        var indList = (indicators && indicators.data && indicators.data.list) || [];
        if (indList.length > 0) {
          return { cid: childNodes[j].id, indicatorId: indList[0].ek_dp || indList[0]._id || indList[0].id };
        }
      }
      var grandChildren = await getTreeNodes(page, childNodes[j].id);
      for (var k = 0; k < grandChildren.length; k++) {
        if (grandChildren[k].name === name || grandChildren[k].name.indexOf(name) >= 0) {
          var indicators2 = await apiCall(page, '/new/queryIndicatorsByCid?cid=' + grandChildren[k].id + '&dt=&name=') as any;
          var indList2 = (indicators2 && indicators2.data && indicators2.data.list) || [];
          if (indList2.length > 0) {
            return { cid: grandChildren[k].id, indicatorId: indList2[0].ek_dp || indList2[0]._id || indList2[0].id };
          }
        }
      }
    }
  }
  return null;
}

function toN(s: string): number | null {
  var c = String(s).replace(/,/g, '').replace(/，/g, '').trim();
  if (c === '' || c === '—' || c === '-' || c === 'null' || c === 'undefined') return null;
  var n = Number(c);
  return isNaN(n) ? null : n;
}

async function fetchAllProvinces(page: import('../types').Page, indicatorName: string): Promise<ProvinceRow[]> {
  var found = await findIndicatorId(page, indicatorName);
  if (!found) throw new Error('未找到指标: ' + indicatorName);

  var body = {
    cid: found.cid,
    indicatorIds: [found.indicatorId],
    daCatalogId: '',
    das: PROVINCE_CODES,
    showType: '1',
    dts: '',
    rootId: ROOT_CID,
  };

  var result = await apiCall(page, '/getEsDataByCidAndDt', body) as any;
  if (!result || !result.data) return [];

  var rows: ProvinceRow[] = [];
  var entries = result.data;
  if (Array.isArray(entries)) {
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var provName = entry.name || entry.areaName || '';
      var matched = false;
      for (var p = 0; p < PK.length; p++) {
        if (provName.indexOf(PK[p]) >= 0) { matched = true; break; }
      }
      if (!matched) continue;
      var years: Record<string, number> = {};
      if (entry.data && typeof entry.data === 'object') {
        var keys = Object.keys(entry.data);
        for (var k = 0; k < keys.length; k++) {
          var val = toN(String(entry.data[keys[k]]));
          if (val !== null) years[keys[k]] = val;
        }
      } else if (entry.values && typeof entry.values === 'object') {
        var keys2 = Object.keys(entry.values);
        for (var m = 0; m < keys2.length; m++) {
          var val2 = toN(String(entry.values[keys2[m]]));
          if (val2 !== null) years[keys2[m]] = val2;
        }
      }
      if (Object.keys(years).length > 0) {
        rows.push({ province: provName, years: years });
      }
    }
  }
  return rows;
}

function toCsv(prov: ProvinceRow[]): string {
  var ay: Record<string, boolean> = {};
  prov.forEach(function(p) { Object.keys(p.years).forEach(function(y) { ay[y] = true; }); });
  var sy = Object.keys(ay).sort();
  return [['省份'].concat(sy).join(',')].concat(prov.map(function(p) {
    return [p.province].concat(sy.map(function(y) { return p.years[y] ? String(p.years[y]) : ''; })).join(',');
  })).join('\n');
}

export default function(xcli: XCLIAPI): void {
  var stats = xcli.createSite({ name: 'stats', url: 'https://data.stats.gov.cn/', description: '国家统计局 - 分省年度经济数据（新站 API 模式，数据查询接口待官方上线）', requiresLogin: false });

  stats.command('indicators', {
    description: '列出分省年度数据所有可用指标',
    loginRequired: 'none',
    scope: 'browser',
    parameters: z.object({}),
    examples: [{ cmd: 'xbrowser stats indicators', description: '列出所有经济指标' }],
    result: z.array(z.object({ name: z.string(), children: z.array(z.string()) })),
    handler: async function(_p, ctx) {
      var page = gp(ctx as Record<string, unknown>);
      var rootNodes = await getTreeNodes(page, '');
      var result: Array<{name: string; children: string[]}> = [];
      for (var i = 0; i < rootNodes.length; i++) {
        var childNodes = await getTreeNodes(page, rootNodes[i].id);
        for (var j = 0; j < childNodes.length; j++) {
          result.push({ name: childNodes[j].name, children: [] });
        }
      }
      return ok(result, ['共 ' + result.length + ' 个指标节点']);
    },
  });

  stats.command('gdp', {
    description: '获取各省地区生产总值（GDP）',
    loginRequired: 'none',
    scope: 'browser',
    parameters: z.object({
      format: z.enum(['json', 'csv']).optional().default('json').describe('输出格式'),
    }),
    examples: [
      { cmd: 'xbrowser stats gdp', description: '获取各省 GDP' },
      { cmd: 'xbrowser stats gdp --format csv', description: 'CSV 格式输出' },
    ],
    result: z.array(z.object({ province: z.string(), years: z.record(z.number()) })),
    handler: async function(params, ctx) {
      var page = gp(ctx as Record<string, unknown>);
      var p = params as { format: string };
      var prov = await fetchAllProvinces(page, '地区生产总值');
      if (prov.length === 0) return fail('未提取到省份数据');
      if (p.format === 'csv') return ok(toCsv(prov) as unknown as ProvinceRow[], ['CSV，' + prov.length + ' 省份']);
      await ctx.storage.set('stats_gdp', prov);
      return ok(prov, ['共 ' + prov.length + ' 个省份']);
    },
  });

  stats.command('retail', {
    description: '获取各省社会消费品零售总额',
    loginRequired: 'none',
    scope: 'browser',
    parameters: z.object({
      format: z.enum(['json', 'csv']).optional().default('json').describe('输出格式'),
    }),
    examples: [{ cmd: 'xbrowser stats retail', description: '获取各省社消零售总额' }],
    result: z.array(z.object({ province: z.string(), years: z.record(z.number()) })),
    handler: async function(params, ctx) {
      var page = gp(ctx as Record<string, unknown>);
      var p = params as { format: string };
      var prov = await fetchAllProvinces(page, '社会消费品零售总额');
      if (prov.length === 0) return fail('未提取到省份数据');
      if (p.format === 'csv') return ok(toCsv(prov) as unknown as ProvinceRow[], ['CSV，' + prov.length + ' 省份']);
      await ctx.storage.set('stats_retail', prov);
      return ok(prov, ['共 ' + prov.length + ' 个省份']);
    },
  });

  stats.command('query', {
    description: '通用指标查询（输入指标名称查询各省数据）',
    loginRequired: 'none',
    scope: 'browser',
    parameters: z.object({
      indicator: z.string().describe('指标名称'),
    }),
    examples: [{ cmd: 'xbrowser stats query --indicator "总人口"', description: '查询各省人口' }],
    result: z.array(z.object({ province: z.string(), years: z.record(z.number()) })),
    handler: async function(params, ctx) {
      var page = gp(ctx as Record<string, unknown>);
      var p = params as { indicator: string };
      var prov = await fetchAllProvinces(page, p.indicator);
      if (prov.length === 0) return fail('未提取到省份数据');
      return ok(prov, [p.indicator + '，' + prov.length + ' 省份']);
    },
  });

  stats.command('report', {
    description: '生成 HTML 可视化报告',
    loginRequired: 'none',
    scope: 'cli',
    parameters: z.object({
      output: z.string().optional().default('./stats-report.html').describe('输出路径'),
      title: z.string().optional().default('全国各省市经济数据报告').describe('标题'),
    }),
    examples: [{ cmd: 'xbrowser stats report', description: '生成报告' }],
    result: z.object({ path: z.string(), size: z.number() }),
    handler: async function(params, ctx) {
      var fs = await import('fs');
      var pm = await import('path');
      var p = params as { output: string; title: string };
      var gdp = await ctx.storage.get('stats_gdp') as ProvinceRow[] | null;
      var ret = await ctx.storage.get('stats_retail') as ProvinceRow[] | null;
      if (!gdp && !ret) return fail('无缓存数据，请先运行 stats gdp 或 stats retail');
      var html = genHTML(p.title, gdp, ret);
      var op = pm.resolve(p.output);
      var d = pm.dirname(op);
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(op, html, 'utf-8');
      return ok({path: op, size: Buffer.byteLength(html)}, ['报告: ' + op]);
    },
  });

  stats.command('export', {
    description: '导出缓存数据为 JSON/CSV',
    loginRequired: 'none',
    scope: 'cli',
    parameters: z.object({
      format: z.enum(['json', 'csv']).optional().default('json').describe('格式'),
      output: z.string().optional().describe('输出路径'),
      indicator: z.enum(['gdp', 'retail', 'all']).optional().default('all').describe('指标'),
    }),
    examples: [{ cmd: 'xbrowser stats export', description: '导出数据' }],
    result: z.union([
      z.object({ path: z.string() }),
      z.record(z.unknown()),
    ]),
    handler: async function(params, ctx) {
      var fs = await import('fs');
      var pm = await import('path');
      var p = params as { format: string; output: string | undefined; indicator: string };
      var ds: Record<string, ProvinceRow[] | null> = { gdp: await ctx.storage.get('stats_gdp') as ProvinceRow[] | null, retail: await ctx.storage.get('stats_retail') as ProvinceRow[] | null };
      var keys = p.indicator === 'all' ? ['gdp', 'retail'] : [p.indicator];
      var results: Record<string, unknown> = {};
      for (var i = 0; i < keys.length; i++) {
        var d = ds[keys[i]]; if (!d || d.length === 0) continue;
        results[keys[i]] = p.format === 'csv' ? toCsv(d) : d;
      }
      if (Object.keys(results).length === 0) return fail('无缓存数据');
      if (p.output) { var op = pm.resolve(p.output); fs.writeFileSync(op, JSON.stringify(results, null, 2), 'utf-8'); return ok({path: op}, ['导出: ' + op]); }
      return ok(results, [p.format.toUpperCase()]);
    },
  });
}

function genHTML(title: string, gdp: ProvinceRow[] | null, ret: ProvinceRow[] | null): string {
  var gj = JSON.stringify(gdp || []); var rj = JSON.stringify(ret || []);
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>' + title + '</title><script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"><\/script><style>*{margin:0;padding:0;box-sizing:border-box}:root{--bg:#0a0e17;--card:#111827;--border:#1e293b;--text:#e2e8f0;--dim:#94a3b8}body{font-family:-apple-system,"PingFang SC",sans-serif;background:var(--bg);color:var(--text);line-height:1.6}.hd{padding:60px 40px;text-align:center}.hd h1{font-size:2.2em;background:linear-gradient(135deg,#3b82f6,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent}.s{max-width:1400px;margin:0 auto 32px;padding:0 40px}.st{font-size:1.3em;font-weight:600;margin-bottom:16px}.cc{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:20px;margin-bottom:20px}.ct{width:100%;height:520px}.ft{text-align:center;padding:32px;color:#64748b;font-size:.85em;border-top:1px solid var(--border);margin-top:32px}.ft a{color:#3b82f6}</style></head><body><header class="hd"><h1>' + title + '</h1><p style="color:var(--dim)">国家统计局 data.stats.gov.cn</p></header><div class="s"><div class="st">GDP 排名</div><div class="cc"><div id="c1" class="ct"></div></div></div><div class="s"><div class="st">GDP 趋势 Top10</div><div class="cc"><div id="c2" class="ct"></div></div></div>' + (ret ? '<div class="s"><div class="st">社消零售总额</div><div class="cc"><div id="c3" class="ct"></div></div></div>' : '') + '<footer class="ft"><p>数据来源：<a href="https://data.stats.gov.cn/" target="_blank">国家统计局</a></p></footer><script>var GDP=' + gj + ',RETAIL=' + rj + ',C=["#3b82f6","#8b5cf6","#06b6d4","#f59e0b","#ef4444","#22c55e","#ec4899","#f97316","#14b8a6","#6366f1"];function ly(d){if(!d||!d[0])return"";var y=Object.keys(d[0].years).sort();return y[y.length-1]}if(GDP&&GDP.length>0){var e1=echarts.init(document.getElementById("c1")),l=ly(GDP),s=GDP.slice().sort(function(a,b){return(a.years[l]||0)-(b.years[l]||0)});e1.setOption({tooltip:{trigger:"axis",axisPointer:{type:"shadow"}},grid:{left:120,right:40,top:20,bottom:20},xAxis:{type:"value"},yAxis:{type:"category",data:s.map(function(p){return p.province})},series:[{type:"bar",data:s.map(function(p){return p.years[l]||0}),itemStyle:{color:new echarts.graphic.LinearGradient(0,0,1,0,[{offset:0,color:"#3b82f6"},{offset:1,color:"#8b5cf6"}])}}]});var e2=echarts.init(document.getElementById("c2")),t10=GDP.slice(0,10),yrs=Object.keys(t10[0].years).sort();e2.setOption({tooltip:{trigger:"axis"},legend:{data:t10.map(function(p){return p.province}),textStyle:{color:"#94a3b8"}},grid:{left:60,right:20,top:40,bottom:20},xAxis:{type:"category",data:yrs,axisLabel:{color:"#94a3b8"}},yAxis:{type:"value",axisLabel:{color:"#94a3b8"}},series:t10.map(function(p,i){return{name:p.province,type:"line",data:yrs.map(function(y){return p.years[y]||0}),lineStyle:{width:2},itemStyle:{color:C[i%C.length]},smooth:true}})})}if(RETAIL&&RETAIL.length>0){var e3=echarts.init(document.getElementById("c3")),l2=ly(RETAIL),s2=RETAIL.slice().sort(function(a,b){return(a.years[l2]||0)-(b.years[l2]||0)});e3.setOption({tooltip:{trigger:"axis",axisPointer:{type:"shadow"}},grid:{left:120,right:40,top:20,bottom:20},xAxis:{type:"value"},yAxis:{type:"category",data:s2.map(function(p){return p.province})},series:[{type:"bar",data:s2.map(function(p){return p.years[l2]||0}),itemStyle:{color:new echarts.graphic.LinearGradient(0,0,1,0,[{offset:0,color:"#06b6d4"},{offset:1,color:"#22c55e"}])}}]})}window.addEventListener("resize",function(){e1&&e1.resize();e2&&e2.resize();e3&&e3.resize()})<\/script></body></html>';
}
