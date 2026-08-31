#!/usr/bin/env python3
"""
gen-cover.py — 豆包生图失败时的自动兜底封面（S171）

从文章结构自动生成"流程图风格"封面：标题 + 章节步骤卡 + 底部标签。
深蓝科技风，PingFang 字体，1600x899（16:9）。

用法：
  python3 scripts/gen-cover.py --title "文章标题" \
    --steps '["步骤一","步骤二","步骤三"]' \
    --tag "S171 实战沉淀" --out /tmp/article-cover.png
"""
import argparse
import math
import os

from PIL import Image, ImageDraw, ImageFont

FONT_PATHS = [
    '/System/Library/Fonts/PingFang.ttc',
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
    '/System/Library/Fonts/STHeiti Light.ttc',
]


def font(sz):
    for p in FONT_PATHS:
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            continue
    return ImageFont.load_default()


def draw_cover(title, steps, tag, out):
    W, H = 1600, 899
    im = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(im)

    # 深蓝渐变背景
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)],
               fill=(int(10 + 16 * t), int(24 + 28 * t), int(52 + 42 * t)))
    # 网格
    for x in range(0, W, 80):
        d.line([(x, 0), (x, H)], fill=(26, 40, 78), width=1)
    for y in range(0, H, 80):
        d.line([(0, y), (W, y)], fill=(26, 40, 78), width=1)

    # 标题（自动缩字号防溢出）
    tsz = 72
    while tsz > 40:
        f = font(tsz)
        if d.textlength(title, font=f) <= W - 200:
            break
        tsz -= 4
    d.text(((W - d.textlength(title, font=f)) / 2, 210), title, font=f, fill=(255, 255, 255))

    # 装饰：中央循环箭头（更新/流水线意象）
    cx, cy, R = 250, 300, 110
    d.arc([cx - R, cy - R, cx + R, cy + R], start=30, end=300, fill=(80, 180, 255), width=22)
    ah = math.radians(300)
    ax, ay = cx + R * math.cos(ah), cy + R * math.sin(ah)
    d.polygon([(ax + 16, ay - 30), (ax - 36, ay + 6), (ax + 27, ay + 34)], fill=(80, 180, 255))

    # 步骤卡（自动均分行，每行最多 4 张）
    per_row = 4
    sw, sh, gap = (W - 120 - (per_row - 1) * 36) // per_row, 110, 36
    rows = math.ceil(len(steps) / per_row)
    y0 = H - 120 - rows * (sh + 30)
    for i, s in enumerate(steps):
        r, c = divmod(i, per_row)
        x = 60 + c * (sw + 36)
        y = y0 + r * (sh + 30)
        d.rounded_rectangle([x, y, x + sw, y + sh], radius=18,
                            fill=(20, 46, 90), outline=(80, 150, 240), width=3)
        d.text((x + 20, y + 14), f'{i + 1}', font=font(28), fill=(90, 190, 255))
        # 步骤文字自动缩字号
        ssz = 30
        while ssz > 18 and d.textlength(s, font=font(ssz)) > sw - 40:
            ssz -= 2
        d.text((x + 18, y + 52), s, font=font(ssz), fill=(225, 238, 252))

    # 左上标签
    if tag:
        tw = d.textlength(tag, font=font(34)) + 56
        d.rounded_rectangle([60, 56, 60 + tw, 112], radius=28,
                            outline=(90, 160, 240), width=3)
        d.text((88, 66), tag, font=font(34), fill=(150, 200, 255))

    im.save(out, 'JPEG', quality=90)
    return out, os.path.getsize(out)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--title', required=True)
    ap.add_argument('--steps', required=True, help='JSON array of step strings')
    ap.add_argument('--tag', default='')
    ap.add_argument('--out', default='/tmp/article-cover.png')
    a = ap.parse_args()

    import json
    steps = json.loads(a.steps)
    out, size = draw_cover(a.title, steps, a.tag, a.out)
    print(f'fallback cover: {out} ({size} bytes, {len(steps)} steps)')
