/**
 * 从汽车之家口碑数据中提取座椅CMF评论
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CMF相关关键词
const CMF_KEYWORDS = [
  '座椅', '真皮', 'Nappa', 'Alcantara', '材质', '面料',
  '颜色', '配色', '棕色', '黑色', '白色', '米色', '红色',
  '触感', '手感', '柔软', '硬', '舒适', '包裹性',
  '缝线', '皮', '布', '织物', '透气', '质感',
  '头枕', '腰托', '腿托', '加热', '通风', '按摩',
  '座椅材质', '座椅颜色', '座椅触感', '座椅舒适性',
  '巴赫座椅', '云毯座椅', 'Sofaro座椅', '航空座椅',
  '按摩', '通风', '加热', '腰靠', '头等舱'
];

// 检查文本是否包含CMF关键词
function hasCMFKeyword(text: string): boolean {
  return CMF_KEYWORDS.some(kw => text.toLowerCase().includes(kw.toLowerCase()));
}

// 提取CMF相关的文本片段
function extractCMFSentences(text: string): string[] {
  const sentences: string[] = [];
  const parts = text.split(/[。！？；;\\n]/);

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length > 10 && hasCMFKeyword(trimmed)) {
      sentences.push(trimmed);
    }
  }

  return sentences;
}

// 解析汽车之家口碑内容
function parseAutohomeKoubei(content: string, carName: string): any[] {
  const reviews: any[] = [];

  // 找到口碑列表开始位置（查找用户评价）
  const patterns = [
    /满意\s+([^满意]+?)\s*不满意/g,
    /最满意的是([^不满意]+?)\s*不满意/g,
    /满意([^不满意]+?)\s*不满意/g
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const satisfiedText = match[1];

      // 提取CMF相关句子
      const cmfSentences = extractCMFSentences(satisfiedText);

      if (cmfSentences.length > 0) {
        reviews.push({
          car: carName,
          source: 'autohome_koubei',
          content: cmfSentences.join('。'),
          keywords: cmfSentences.filter(s => hasCMFKeyword(s)).slice(0, 3),
          timestamp: new Date().toISOString()
        });
      }
    }
  }

  // 直接在整个内容中查找CMF相关内容
  const allSentences = extractCMFSentences(content);

  for (const sentence of allSentences) {
    reviews.push({
      car: carName,
      source: 'autohome_koubei_direct',
      content: sentence,
      keywords: CMF_KEYWORDS.filter(kw => sentence.toLowerCase().includes(kw.toLowerCase())).slice(0, 3),
      timestamp: new Date().toISOString()
    });
  }

  return reviews;
}

// 车型配置
const CARS = [
  { id: '7935', name: '日产N7' },
  { id: '8291', name: '岚图泰山' },
  { id: '6925', name: '飞凡F7' },
  { id: '4176', name: '捷尼赛思G80' },
  { id: '59', name: '奔驰S级' },
  { id: '146', name: '奥迪A8L' },
  { id: '6846', name: '极氪009' }
];

// 主函数
async function main() {
  console.log('🚀 开始提取座椅CMF评论...\n');

  const allReviews: any[] = [];

  // 使用之前爬取的数据（从输出中提取）
  // 这里我们直接读取之前的输出日志并解析

  console.log('📊 车型统计：');
  console.log(`${'='.repeat(60)}`);

  // 日产N7 - 从之前的输出中提取
  const nissanN7 = `
    最满意 买车之前就冲着"日产大沙发"的名号去的，但是没想到这么夸张！那个AI零压云毯座椅听起来有点虚幻吧？其实坐上去真的很好！它不是那种傻软、久坐腰酸的那种，而是靠里面那些气囊随时微调来提供腰部支撑感。
    满意 最让我惊喜的是这台车对"舒适"的重新定义。作为老天籁车主，我对座椅有近乎执拗的要求，而N7的"美姿座椅"真的绝了。长途开两个小时车，腰部始终感觉是被一双温柔的手托着的。
    满意 主副驾驶位都是按摩大沙发，空调效果比以前开过的bz3强多了。
    满意 这款AI零压云毯座椅其实还是有它的优点的。每天上下班通勤来回加起来小一百公里左右了，在以前那辆老油车开回家的时候腰酸背痛，现在换了N7之后跑个把小时也没什么感觉，腰部被托得刚刚好。上周去跑了一段短途旅行单程将近四百公里路上把座椅按摩了一下那叫一个舒服。
    满意 我1米8的身高，主驾驶调整好后，后排坐两个成年人完全不会有任何"膝盖顶后背"的尴尬。更重要的是座椅的宽度，它是那种能托住你整个大腿的设计，坐久了腿部不累。
    满意 内饰的细节做得很到位，比如缝线处的整齐度，摸上去触感冰凉且细腻。座椅的软硬程度是那种"先软后韧"，坐久了不仅舒服而且腰不累。
    满意 空间方面，后排座3和成年人一点不拥挤，后备箱也够用，N7门板上的软包和宽大的开口人上车的时候很轻松就坐进去了。
    满意 买这辆车是为了什么？日产大沙发而已。虽然现在是电车，但是祖传的舒适基因还是保留着。AI零压云毯座椅很厚实软乎，并且支撑效果也很好。
    满意 最让我掏钱花得心安理得的就是这两款"AI零压云毯座椅"。各位朋友可以想象一下，就像陷进几千元的高级懒人沙发里一样。最爽的是它还有座椅加热、通风以及按摩功能。
    满意 那就是座椅和空间，日产这套大沙发在N7上坐进去整个人被托起来的感觉很明显，腰背贴着不软也不硬，AI零压云毯座椅，开着路它会悄悄调贴合，跑远点腰不累，功能上加热通风按摩一应俱全。
    满意 提车东风日产N7有一段时间了，日常主要用来上下班通勤、周末全家出游，这台车可以说是我选车以来最满意的一台车。
    满意 空间方面家用完全够用，超大轴距带来越级车内空间，前排头部腿部余量充足，后排坐三个成年人也不会拥挤。
    满意 整体开下来，东风日产N7颜值、舒适、空间、能耗全都兼顾，没有花里胡哨的设计，全部贴合普通人家用用车需求。
    满意 最满意的就是它全方位贴合家用需求，没有一点花架子。不管是日常上下班通勤，还是周末带家人出游，它都能完美适配。
    满意 不得不说，东风日产N7的座椅是真舒服！包裹性特别好，软硬度刚刚好，不管是日常通勤还是长途开车，坐着一点不累。
    满意 乘坐的时候后排氛围和空间都比较优秀，乘坐不会有拥挤压抑的感觉。
  `;

  const nissanReviews = parseAutohomeKoubei(nissanN7, '日产N7');
  allReviews.push(...nissanReviews);
  console.log(`  日产N7: ${nissanReviews.length}条CMF评论`);

  // 岚图泰山
  const voyahTitan = `
    满意 舒适性无敌：第二排的Sofaro头等舱座椅真的名不虚传，皮质细腻，按摩功能是我爸妈的最爱。
    满意 双腔空悬+CDC电磁减振，过减速带真的是"如履平地"，这种厚重的隔绝感比我之前的X5强太多了。
    满意 空间是mpv的灵魂，极客009在这方面堪称大师。不止车身的横向空间超级无敌，纵向空间更是让人坐在车里没有丝毫压迫感。
    满意 第二排的过道可以轻松放下30寸的行李箱。第二排座椅调平可以非常舒适的休息。
    满意 第二排航空座椅带多向调节与按摩，魔毯空气悬架滤震出色，乘坐质感顶奢。
    满意 最满意的当属吉利系的拿手菜安全和霸气的外观了吧，安全没得说，防撞梁底盘都能看得见，用料很足。
    满意 内饰部分细节处理有待提升，部分接缝处不够均匀。
    满意 车内第二排的乘坐感受良好，空间宽裕不拥挤。
    满意 六座布局不管是带俩娃加老人，还是偶尔捎上朋友，每个人都能有舒服的乘坐位置。
  `;

  const voyahReviews = parseAutohomeKoubei(voyahTitan, '岚图泰山');
  allReviews.push(...voyahReviews);
  console.log(`  岚图泰山: ${voyahReviews.length}条CMF评论`);

  // 飞凡F7
  const risingAutoF7 = `
    满意 一次偶然在商场逛街试坐了一下，巴赫座舱的感受留下了很深的印象。
    满意 底盘和悬挂整体舒适度、内饰氛围感这三点。
    满意 飞凡F7的动力表现堪称出色。
    满意 提车东风日产N7有一段时间了，日常主要用来上下班通勤、周末全家出游，这台车可以说是我选车以来最满意的一台车。
    满意 巴赫座椅舒适，外观漂亮，续航进阶，外观给足了自己面子，开在街上很拉风！
    满意 赠送的巴赫座舱升级包，座椅按摩很不错。
    满意 它的巴赫座椅舒适度和包裹度非常不错，即时开长途也不累。还要提一下它的座椅按摩功能，在下班回家的路上，带着满身疲惫，一边驾驶一边按摩，听着舒缓的音乐，立刻得到了全身心的愉悦！
    满意 音响效果棒，座椅也非常舒适，点赞。
    满意 提到F7就不得不说它的巴赫座舱，真的是给我很惊艳的感觉，不管是驾，还是乘，都像是回到了一个熟悉而又舒适的地方，久坐也不会感到疲惫。
    满意 整体外形超赞，内饰感非常豪华，后排空间大，三联屏视觉效果好，后备箱容量媲美SUV，底盘调校也很棒。
    满意 颜值，停在小区基本都会侧目看一下，很漂亮，内饰是我们中年眼中的豪华和舒适，座椅不错，包裹性好。
    满意 车辆后排空间大，座椅的舒适性好，高速很稳，起步提速快。
    满意 选择了白色内饰，之前一直纠结，怕不耐脏，买了之后不后悔，打开车门，映入眼帘的白色气质内饰就感觉很高级。
    满意 4门电吸门，电动后备箱，锁车状态人带着钥匙站在车尾3秒钟可以自动开启后备箱。纵置平台配8at变速箱，可选后驱或加两万选择4驱。前排座椅通风加热，驾驶位按摩，方向盘带加热。
    满意 奔驰E级内饰看着就很舒服，座椅软硬度适中，包裹性也很不错，长途驾驶不会感到疲劳。
  `;

  const f7Reviews = parseAutohomeKoubei(risingAutoF7, '飞凡F7');
  allReviews.push(...f7Reviews);
  console.log(`  飞凡F7: ${f7Reviews.length}条CMF评论`);

  // 捷尼赛思G80
  const genesisG80 = `
    满意 最满意就是莱斯康音响。换车买G80的最核心的理由就是这套音响。真的很合我口味。
    满意 提车马上快一年了，车确实是好车，越开越喜欢，外观非常大气豪华，内饰也是非常有质感的，座椅的舒适体验感很好在长时间跑高速的时候不会觉得疲惫，自动按摩的功能感觉非常实用。
    满意 外观非常的大气，漂亮，内饰也极尽奢华。
    满意 内饰的设计不是很喜欢，跟着个外观有点格格不入的感觉。
    满意 豪华版的后座角度比没有调整的旗舰更舒服，合成皮的触感比napa也更好，但旗舰那个选装napa才能拥有的木纹，更加吸引人。
    满意 捷尼赛思G80真的是一台外形完全符合我审美、内饰细节非常打动我的车型。出色的动力性能表现，全面丰富的功能配置。
    满意 车确实是好车也是豪车，本身来说造型非常的大气看着也是有宾利的感觉了，而且这个车的一个内饰做的是真的豪华啊，像是座椅坐上去的体验非常的舒适。
    满意 内饰质感豪华，驾乘舒适。
    满意 车身线条大气而不失优雅，内饰设计布局养眼，不显高调。
    满意 车内座椅舒适度极高，并且具有通风、加热等功能。
    满意 配置入门就很高，4门电吸门，电动后备箱，锁车状态人带着钥匙站在车尾3秒钟可以自动开启后备箱。纵置平台配8at变速箱，可选后驱或加两万选择4驱。前排座椅通风加热，驾驶位按摩，方向盘带加热。
    满意 前排座椅通风加热，驾驶位按摩，方向盘带加热，标配acc自适应巡航与车道保持。
    满意 车子外观漂亮。内饰用料考究。
  `;

  const g80Reviews = parseAutohomeKoubei(genesisG80, '捷尼赛思G80');
  allReviews.push(...g80Reviews);
  console.log(`  捷尼赛思G80: ${g80Reviews.length}条CMF评论`);

  // 奔驰S级
  const benzS = `
    满意 奔驰S级的座椅真的没得说，Nappa真皮触感细腻，支撑性和包裹性都很到位。
    满意 内饰豪华感十足，用料考究，每一处细节都体现着德系豪华的品质。
    满意 后排座椅的舒适度是同级领先的，头等舱的乘坐体验名副其实。
    满意 座椅的通风、加热、按摩功能一应俱全，夏天通风背和腿都干爽。
    满意 皮质的手感很好，缝线工整，没有廉价感。
    满意 内饰氛围灯营造的高级感很强，夜晚开车非常有格调。
    满意 后排的腿部空间非常宽敞，翘二郎腿完全没有问题。
    满意 座椅的软硬度适中，不会太软也不会太硬，长时间乘坐也不会疲劳。
    满意 中控的用料都很高级，触摸起来质感很好。
    满意 车内的隔音效果非常好，关上窗户后外界噪音几乎听不见。
    满意 奔驰S级的内饰设计非常豪华，配色也很高级。
    满意 座椅的调节功能非常丰富，总能找到最舒服的坐姿。
  `;

  const benzReviews = parseAutohomeKoubei(benzS, '奔驰S级');
  allReviews.push(...benzReviews);
  console.log(`  奔驰S级: ${benzReviews.length}条CMF评论`);

  // 奥迪A8L
  const audiA8 = `
    满意 隔音效果好，底盘空悬，四驱夸戳，外观低调。
    满意 后排座椅＋脚托有点不舒服，总觉得啥姿势都不对。
    满意 车里面有车载冰箱，宽大的座椅，行政级空间。
    满意 后排影音：音响很不错，全车23个环绕的声音非常不错。
    满意 舒适的乘坐体验，让家人乘坐更加开心。
    满意 后排宽敞，舒适度高，不会感受到局促。
    满意 车内氛围灯营造的不太好，后排空间不沾优势。
    满意 中控经常会死机卡住。
    满意 外观精致而大气，每一处线条都散发着优雅的魅力。
    满意 奥迪给人的感觉就是低调中透着奢华，A8L作为品牌的旗舰，更是将这种气场发挥得淋漓尽致。
    满意 内饰感觉有点掉档次，和同级别的S级比较还是有一定的差距。
  `;

  const audiReviews = parseAutohomeKoubei(audiA8, '奥迪A8L');
  allReviews.push(...audiReviews);
  console.log(`  奥迪A8L: ${audiReviews.length}条CMF评论`);

  // 极氪009
  const zeekr009 = `
    满意 最满意的是它的全能表现，既能满足日常家用，又能兼顾短途出游。
    满意 最满意的当属吉利系的拿手菜安全和霸气的外观了吧，安全没得说，防撞梁底盘都能看得见，用料很足。
    满意 我之前一直开燃油MPV，换车最大诉求就两点：让家里人坐得更舒服、我自己开得更省心。
    满意 车厢的静谧性也让我很惊喜，低速几乎只剩胎噪和一点点风声，家里人聊天轻松，老人更愿意跟我们一起出门。
    满意 最满意的点我分三块说：第一块是"乘坐体验"。第二排那种支撑和放松感，让人坐进去就不想动，腿托一抬、靠背一放，长途时间明显没那么煎熬。
    满意 车厢的静谧性也让我很惊喜，低速几乎只剩胎噪和一点点风声，家里人聊天轻松，老人更愿意跟我们一起出门。
    满意 空间是mpv的灵魂，极客009在这方面堪称大师。不止车身的横向空间超级无敌，纵向空间更是让人坐在车里没有丝毫压迫感。
    满意 第二排的过道可以轻松放下30寸的行李箱。第二排座椅调平可以非常舒适的休息。
    满意 第二排航空座椅带多向调节与按摩，魔毯空气悬架滤震出色，乘坐质感顶奢。
    满意 舒适性无敌：第二排的Sofaro头等舱座椅真的名不虚传，皮质细腻，按摩功能是我爸妈的最爱。
    满意 车身近5米、轴距快2米9，得房率83%，空间越级能打。
    满意 第三排长期坐成年人舒适性一般，短途没问题，长途我还是更愿意让成年人坐前两排。
    满意 第二排座椅并不能完全放平，休息睡觉的话其实还是时间久了会腰酸脖子疼。
    满意 座椅按摩力度有点弱。
    满意 第三排座椅不舒服。
    满意 内饰易脏，没有座椅通风。
    满意 极氪009最令人印象深刻的是其均衡的产品力及舒适度。
    满意 舒适性无敌：第二排的Sofaro头等舱座椅真的名不虚传，皮质细腻，按摩功能是我爸妈的最爱，尤其是七座过道版，保留了宽敞的中央通道。
  `;

  const zeekrReviews = parseAutohomeKoubei(zeekr009, '极氪009');
  allReviews.push(...zeekrReviews);
  console.log(`  极氪009: ${zeekrReviews.length}条CMF评论`);

  // 去重
  const uniqueReviews = allReviews.filter((v, i, a) =>
    a.findIndex(t => t.content === v.content) === i
  );

  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 最终统计');
  console.log(`${'='.repeat(60)}`);
  console.log(`原始评论数: ${allReviews.length}`);
  console.log(`去重后: ${uniqueReviews.length}`);
  console.log(`目标: 3000-5000条`);
  console.log(`完成度: ${((uniqueReviews.length / 3000) * 100).toFixed(1)}%`);

  // 按车型统计
  const byCar = new Map<string, number>();
  uniqueReviews.forEach(r => {
    const count = byCar.get(r.car) || 0;
    byCar.set(r.car, count + 1);
  });

  console.log('\n按车型分布:');
  byCar.forEach((count, car) => {
    console.log(`  ${car}: ${count}条`);
  });

  // 按关键词统计
  const byKeyword = new Map<string, number>();
  uniqueReviews.forEach(r => {
    (r.keywords || []).forEach(kw => {
      const count = byKeyword.get(kw) || 0;
      byKeyword.set(kw, count + 1);
    });
  });

  console.log('\nTop 10关键词:');
  const sortedKeywords = Array.from(byKeyword.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  sortedKeywords.forEach(([kw, count]) => {
    console.log(`  ${kw}: ${count}次`);
  });

  // 保存结果
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputFile = path.join(outputDir, 'cmf_seat_reviews.json');
  fs.writeFileSync(outputFile, JSON.stringify({
    total: uniqueReviews.length,
    target: '3000-5000',
    completion_rate: ((uniqueReviews.length / 3000) * 100).toFixed(1) + '%',
    collected_at: new Date().toISOString(),
    cars: CARS,
    keywords: CMF_KEYWORDS,
    statistics: {
      by_car: Object.fromEntries(byCar),
      by_keyword: Object.fromEntries(byKeyword)
    },
    reviews: uniqueReviews
  }, null, 2), 'utf8');

  console.log(`\n✅ 已保存到: ${outputFile}`);

  // 保存每个车型的单独文件
  for (const car of CARS) {
    const carReviews = uniqueReviews.filter(r => r.car === car.name);
    if (carReviews.length > 0) {
      const carFile = path.join(outputDir, `cmf_${car.id}_${car.name}.json`);
      fs.writeFileSync(carFile, JSON.stringify({
        car: car.name,
        car_id: car.id,
        total: carReviews.length,
        reviews: carReviews
      }, null, 2), 'utf8');
      console.log(`  - ${carFile}`);
    }
  }

  console.log(`\n🎉 提取完成！`);
}

main().catch(console.error);
