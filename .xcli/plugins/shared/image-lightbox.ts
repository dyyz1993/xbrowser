/**
 * Shared utility for extracting HD images from a lightbox-based gallery
 * (currently only used by the doubao plugin's image-generation flow).
 *
 * Flow:
 *   1. Subscribe to all response events BEFORE clicking anything
 *   2. Click the first main image to open the lightbox — the browser
 *      auto-loads the HD for image 0, which our capture handler records
 *   3. Enumerate thumbnails in the lightbox
 *   4. Click each subsequent thumbnail to trigger HD loads
 *   5. Map captured HD URLs (in order) to the original image indices
 *   6. Download each HD via in-page fetch (bypasses CORS via cookies/referer),
 *      falling back to curl-downloading the thumbnail if HD is unavailable
 *
 * Reusable by:
 *   - doubao image-generation (extract after generation completes)
 *
 * Note: doubao extract-images uses a simpler passive network-capture
 * approach and does not need this lightbox helper.
 */

import type { Page } from '../types.js';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

export interface HDImageDownload {
  url: string;       // original thumbnail URL (for index mapping)
  hdUrl: string;     // captured HD URL (may equal url if no HD)
  localPath: string; // path on disk
  size: number;      // bytes
  isHD: boolean;
}

/**
 * Click through the lightbox to trigger HD loads, capture them, and download.
 *
 * @param page Playwright page (assumed to be on a doubao chat page with images)
 * @param imageUrls ordered list of thumbnail URLs (one per image, in display order)
 * @param prefix filename prefix for downloads
 * @param tips shared tips array to append progress info
 */
export async function extractAllHDImages(
  page: Page,
  imageUrls: string[],
  prefix: string,
  tips: string[],
): Promise<HDImageDownload[]> {
  if (imageUrls.length === 0) return [];

  // 1) Subscribe to network responses BEFORE clicking
  const capturedHD: string[] = [];
  const seen = new Set<string>();
  const captureHandler = (resp: unknown): void => {
    const r = resp as { url?: () => string };
    const url = typeof r.url === 'function' ? r.url() : '';
    if (!url || !url.includes('rc_gen_image')) return;
    if (seen.has(url)) return;
    seen.add(url);
    // HD version has image_pre_watermark_1_5b
    if (url.includes('image_pre_watermark_1_5b')) {
      capturedHD.push(url);
    }
  };
  page.on('response', captureHandler);

  try {
    // 2) Click first image to open lightbox — browser auto-loads HD for image 0
    const firstClicked = await page.evaluate((urls: string[]) => {
      const imgs = document.querySelectorAll<HTMLImageElement>('img');
      for (const img of Array.from(imgs)) {
        if (urls.includes(img.src)) {
          (img as HTMLElement).click();
          return true;
        }
      }
      return false;
    }, imageUrls).catch(() => false);

    if (!firstClicked) {
      tips.push('⚠️ 无法打开灯箱（未找到匹配的图片元素）');
    }

    await page.waitForTimeout(2500);

    // 3) + 4) Click each subsequent thumbnail to trigger HD loads
    for (let i = 1; i < imageUrls.length; i++) {
      const thumbUrl = imageUrls[i]!;
      await page.evaluate((u: string) => {
        // Find thumbnail in lightbox (usually in a side strip)
        const all = document.querySelectorAll<HTMLImageElement>('img');
        for (const img of Array.from(all)) {
          if (img.src === u) {
            (img as HTMLElement).click();
            return;
          }
        }
        // Fallback: try parent click
        const all2 = document.querySelectorAll<HTMLElement>('[class*="thumb"], [class*="thumbnail"]');
        for (const t of Array.from(all2)) {
          const im = t.querySelector<HTMLImageElement>('img');
          if (im && im.src === u) {
            (t as HTMLElement).click();
            return;
          }
        }
      }, thumbUrl).catch(() => { /* ignore */ });
      await page.waitForTimeout(1500);
    }

    // Close lightbox (Escape) to clean up
    await page.keyboard.press('Escape').catch(() => { /* ignore */ });
  } finally {
    page.off('response', captureHandler);
  }

  tips.push(`📸 灯箱捕获: ${capturedHD.length} 张 HD (期望 ${imageUrls.length} 张)`);

  // 5) Map captured HD URLs to original image indices (in arrival order)
  // 6) Download each — HD first, fall back to thumbnail
  const downloadDir = path.join(os.homedir(), '.xbrowser', 'downloads');
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

  const results: HDImageDownload[] = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const origUrl = imageUrls[i]!;
    const hdUrl = capturedHD[i] ?? origUrl;
    const isHD = capturedHD[i] !== undefined;
    const urlToDownload = hdUrl;

    const ext = '.png';
    const localPath = path.join(downloadDir, `${prefix}_${Date.now()}_${i}${ext}`);
    try {
      execSync(`curl -sLf -o '${localPath}' '${urlToDownload}'`, { timeout: 120000 });
      const stat = fs.statSync(localPath);
      if (stat.size < 1024) {
        fs.unlinkSync(localPath);
        throw new Error('下载文件过小');
      }
      results.push({ url: origUrl, hdUrl, localPath, size: stat.size, isHD });
      tips.push(`📁 [${i + 1}/${imageUrls.length}] ${localPath} (${isHD ? 'HD' : '缩略图'}, ${(stat.size / 1024).toFixed(1)}KB)`);
    } catch (err) {
      tips.push(`⚠️ [${i + 1}/${imageUrls.length}] 下载失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return results;
}
