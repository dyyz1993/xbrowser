import { ok, fail } from '@dyyz1993/xcli-core';

/**
 * xbrowser 插件：座椅CMF评论查询
 * 查询指定车型的座椅颜色/材质/触感相关评论
 */

import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { z } from 'zod/v4';

// 车型配置
const CARS = [
  { id: '7935', name: '日产N7' },
  { id: '8291', name: '岚图泰山' },
  { id: '6925', name: '飞凡F7' },
  { id: '4176', name: '捷尼赛思G80' },
  { id: '59', name: '奔驰S级' },
  { id: '146', name: '奥迪A8L' },
  { id: '6846', name: '极氪009' },
  { id: '75', name: '宝马5系' },
  { id: '86', name: '奥迪A6L' },
  { id: '3619', name: '雷克萨斯ES' },
  { id: '1669', name: '凯迪拉克CT6' },
  { id: '403', name: '雷克萨斯LS' },
  { id: '2205', name: '沃尔沃S90' },
  { id: '3281', name: '保时捷Panamera' },
  { id: '623', name: '理想L7' },
  { id: '624', name: '理想L9' },
  { id: '4088', name: '蔚来ES6' },
  { id: '4087', name: '蔚来ET7' },
  { id: '4255', name: '小鹏P7' },
  { id: '6282', name: '问界M9' },
  { id: '6301', name: '问界S9' },
  { id: '174', name: '宝马X3' },
  { id: '1815', name: '宝马X5' },
  { id: '1670', name: '奔驰GLC' },
  { id: '1723', name: '奔驰GLE' },
  { id: '3274', name: '保时捷Cayenne' },
  { id: '383', name: '沃尔沃XC90' },
  { id: '77', name: '宝马3系' },
  { id: '88', name: '奥迪A4L' },
  { id: '164', name: '奔驰C级' },
  { id: '3957', name: '奔驰GLB' },
  { id: '4217', name: '凯迪拉克CT5' },
  { id: '61', name: '大众迈腾' },
  { id: '615', name: '比亚迪汉' },
  { id: '5185', name: '比亚迪海豹' },
  { id: '6642', name: '小米SU7' },
  { id: '6772', name: '极氪001' },
  { id: '4198', name: '特斯拉Model 3' },
  { id: '395', name: '别克GL8' },
  { id: '4290', name: '腾势D9' },
  { id: '4253', name: '岚图梦想家' },
  { id: '4219', name: '魏牌高山' }
];

export default function(api: XCLIAPI): void {
  const site = api.createSite({
    name: 'cmf-seats',
    url: 'https://k.m.autohome.com.cn',
    description: '座椅CMF评论查询（颜色/材质/触感）'
  });

  // 查询车型的CMF评论
  site.command('query', {
    description: '查询指定车型的座椅CMF评论',
    requiresLogin: false,
    scope: 'page',
    parameters: z.object({
      car: z.string().describe('车型名称（如：日产N7、奔驰S级、奥迪A8L）'),
      keyword: z.string().optional().describe('CMF关键词（如：座椅、真皮、舒适）'),
      limit: z.number().min(1).max(100).default(10).describe('返回结果数量限制')
    }),
    result: z.object({
      car: z.string(),
      car_id: z.string(),
      total: z.number(),
      returned: z.number(),
      keyword: z.string().nullable(),
      reviews: z.array(z.object({
          car: z.string(),
          content: z.string(),
          keywords: z.array(z.string()),
          timestamp: z.string()
        }))
    }).passthrough(),
    handler: async (params, _ctx) => {
      // 查找车型ID
      const car = CARS.find(c => c.name === params.car);
      if (!car) {
        return fail(`未找到车型 "${params.car}"`, [
          `支持的车型：${CARS.slice(0, 10).map(c => c.name).join(', ')}等${CARS.length}个车型`,
        ]) as unknown as Record<string, unknown>;
      }

      // 从已爬取的数据中查询
      try {
        const fs = await import('fs');
        const path = await import('path');
        const { fileURLToPath } = await import('url');
        
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const dataFile = path.join(__dirname, '..', '..', 'output', 'cmf_seat_reviews_batch.json');

        if (!fs.existsSync(dataFile)) {
          return fail('CMF评论数据文件不存在，请先运行批量爬取脚本') as unknown as Record<string, unknown>;
        }

        const rawData = fs.readFileSync(dataFile, 'utf-8');
        const data = JSON.parse(rawData) as { reviews: Array<Record<string, unknown>> };

        // 过滤指定车型的评论
        let reviews = data.reviews.filter((r: Record<string, unknown>) => r.car === params.car);

        // 按关键词过滤
        if (params.keyword) {
          reviews = reviews.filter((r: Record<string, unknown>) => 
            (r.content as string || '').toLowerCase().includes(params.keyword.toLowerCase()) ||
            ((r.keywords as string[]) || []).some((k: string) => k.toLowerCase().includes(params.keyword.toLowerCase()))
          );
        }

        // 限制返回数量
        const limitedReviews = reviews.slice(0, params.limit);

        return ok({
          car: params.car,
          car_id: car.id,
          total: reviews.length,
          returned: limitedReviews.length,
          keyword: params.keyword || null,
          reviews: limitedReviews.map((r: Record<string, unknown>) => ({
            car: r.car,
            content: r.content,
            keywords: r.keywords || [],
            timestamp: r.timestamp
          })),
        }, [
          `找到 ${reviews.length} 条${params.car}的CMF评论`,
          limitedReviews.length < reviews.length ? `（返回前${limitedReviews.length}条）` : '',
        ]) as unknown as Record<string, unknown>;
      } catch (error) {
        return fail(`查询失败: ${error instanceof Error ? error.message : '未知错误'}`) as unknown as Record<string, unknown>;
      }
    }
  });

  // 列出所有支持的车型
  site.command('list', {
    description: '列出所有支持的车型',
    requiresLogin: false,
    scope: 'any',
    parameters: z.object({}),
    result: z.object({
      total: z.number(),
      cars: z.array(z.object({
        id: z.string(),
        name: z.string(),
        autohome_url: z.string()
      }))
    }).passthrough(),
    handler: async (_params, _ctx) => {
      return ok({
          total: CARS.length,
          cars: CARS.map(c => ({
            id: c.id,
            name: c.name,
            autohome_url: `https://k.m.autohome.com.cn/${c.id}/`
          })),
      }, [
        `共支持 ${CARS.length} 个车型`,
        `使用 "cmf-seats query --car <车型名称>" 查询CMF评论`,
      ]) as unknown as Record<string, unknown>;
    }
  });

  // 统计CMF关键词频率
  site.command('stats', {
    description: '统计CMF关键词频率',
    requiresLogin: false,
    scope: 'page',
    parameters: z.object({
      car: z.string().optional().describe('车型名称，不指定则统计所有车型'),
      top: z.number().min(5).max(50).default(20).describe('返回Top N关键词')
    }),
    result: z.object({
      car: z.string(),
      total_reviews: z.number(),
      total_keywords: z.number(),
      top_keywords: z.array(z.object({
        keyword: z.string(),
        count: z.number()
      }))
    }).passthrough(),
    handler: async (params, _ctx) => {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const { fileURLToPath } = await import('url');

        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const dataFile = path.join(__dirname, '..', '..', 'output', 'cmf_seat_reviews_batch.json');

        if (!fs.existsSync(dataFile)) {
          return fail('CMF评论数据文件不存在，请先运行批量爬取脚本') as unknown as Record<string, unknown>;
        }

        const rawData = fs.readFileSync(dataFile, 'utf-8');
        const data = JSON.parse(rawData) as { reviews: Array<Record<string, unknown>> };

        // 过滤指定车型
        let reviews = data.reviews;
        if (params.car) {
          reviews = reviews.filter((r: Record<string, unknown>) => r.car === params.car);
        }

        // 统计关键词频率
        const keywordCounts = new Map<string, number>();
        reviews.forEach((r: Record<string, unknown>) => {
          ((r.keywords as string[]) || []).forEach((kw: string) => {
            const count = keywordCounts.get(kw) || 0;
            keywordCounts.set(kw, count + 1);
          });
        });

        // 排序
        const sortedKeywords = Array.from(keywordCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, params.top);

        return ok({
          car: params.car || 'all',
          total_reviews: reviews.length,
          total_keywords: keywordCounts.size,
          top_keywords: sortedKeywords.map(([kw, count]) => ({ keyword: kw, count })),
        }, [
          `${params.car ? params.car : '所有车型'} 共 ${reviews.length} 条评论`,
          `包含 ${keywordCounts.size} 个不同的CMF关键词`,
          `显示前 ${sortedKeywords.length} 个关键词`,
        ]) as unknown as Record<string, unknown>;
      } catch (error) {
        return fail(`统计失败: ${error instanceof Error ? error.message : '未知错误'}`) as unknown as Record<string, unknown>;
      }
    }
  });
}
