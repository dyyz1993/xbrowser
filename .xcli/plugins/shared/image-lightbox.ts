/**
 * Shared utilities for capturing and downloading HD images from doubao's
 * image-generation flow.
 *
 * Two complementary strategies are exported:
 *
 *  1. **Passive capture (PRIMARY)** — `installImageCapture(page)` installs
 *     a network listener BEFORE the generation request is submitted, then
 *     `downloadCapturedImages()` downloads the captured HD URLs. This is
 *     the recorder pattern: the listener is up from the start, so every
 *     `rc_gen_image` response — both the HD (`image_pre_watermark_1_5b`)
 *     and the thumbnail (`downsize_watermark`) variant — is captured.
 *     Used by the doubao `image` command.
 *
 *  2. **Lightbox click (FALLBACK)** — `extractAllHDImages()` opens the
 *     lightbox with a REAL mouse click (doubao's CDP firewall rejects
 *     synthetic `el.click()`), clicks through thumbnails, and captures
 *     the HD URLs that the lightbox triggers. Used as a fallback when
 *     the passive capture finds nothing (e.g. generation responses were
 *     already cached from a prior run).
 *
 * doubao URLs are SIGNED (`x-signature` query param covers the full path
 * including the `~tplv-` transform), so URL-rewrite tricks don't work —
 * only the captured-from-network HD URLs are valid.
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
 * A handle to an installed network capture session.
 * - `install()` MUST be called BEFORE the generation request is submitted.
 * - `stop()` uninstalls the listener.
 * - `get()` returns `{ hd, thumb }` URLs captured so far (deduped, in arrival order).
 *
 * This mirrors how the recorder works: the listener is up from the moment
 * the session starts, so no response can slip through.
 */
export interface ImageCaptureSession {
  stop(): void;
  get(): { hd: string[]; thumb: string[] };
}

/**
 * Install a passive network listener that records every `rc_gen_image`
 * response URL. MUST be called BEFORE the action that triggers image
 * generation (i.e. before `submitMessage()`), otherwise the generation
 * responses will already be cached and won't be re-requested.
 *
 * Classification:
 *   - HD:    URL contains `image_pre_watermark_1_5b`
 *   - thumb: URL contains `downsize_watermark` / `img_pre_mark` (anything else)
 */
export function installImageCapture(page: Page): ImageCaptureSession {
  const hd: string[] = [];
  const thumb: string[] = [];
  const seen = new Set<string>();

  const handler = (resp: unknown): void => {
    const r = resp as { url?: () => string };
    const url = typeof r.url === 'function' ? r.url() : '';
    if (!url || !url.includes('rc_gen_image')) return;
    if (seen.has(url)) return;
    seen.add(url);
    // Match by PREFIX, not exact version — doubao bumps the version
    // suffix (e.g. image_pre_watermark_1_5b -> _1_6b over time).
    if (url.includes('image_pre_watermark')) {
      hd.push(url);
    } else if (url.includes('downsize_watermark') || url.includes('img_pre_mark')) {
      thumb.push(url);
    } else {
      // Unknown transform variant — treat as thumbnail candidate
      thumb.push(url);
    }
  };

  page.on('response', handler);

  return {
    stop(): void { page.off('response', handler); },
    get(): { hd: string[]; thumb: string[] } {
      return { hd: [...hd], thumb: [...thumb] };
    },
  };
}

/**
 * Download a set of captured HD/thumb URLs. Prefers HD; falls back to the
 * matching thumbnail when HD download fails or is too small (<200KB).
 *
 * Pairs are matched by the object key in the path
 * (e.g. `rc_gen_image/52f5150c...`), since HD and thumb share that key
 * but differ in the `~tplv-` transform suffix.
 *
 * @returns one download per unique image (HD preferred).
 */
export function downloadCapturedImages(
  captured: { hd: string[]; thumb: string[] },
  prefix: string,
  tips: string[],
): HDImageDownload[] {
  // Build a map: objectKey -> { hd?, thumb? }
  const keyOf = (url: string): string =>
    (url.match(/rc_gen_image\/([a-f0-9]+)/i)?.[1]) || url;
  const byKey = new Map<string, { hd?: string; thumb?: string }>();
  for (const u of captured.hd) {
    const k = keyOf(u);
    const entry = byKey.get(k) || {};
    entry.hd = u;
    byKey.set(k, entry);
  }
  for (const u of captured.thumb) {
    const k = keyOf(u);
    const entry = byKey.get(k) || {};
    if (!entry.thumb) entry.thumb = u;
    byKey.set(k, entry);
  }

  const entries = [...byKey.values()];
  if (entries.length === 0) return [];

  const downloadDir = path.join(os.homedir(), '.xbrowser', 'downloads');
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

  const results: HDImageDownload[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const hdUrl = e.hd;
    const thumbUrl = e.thumb || e.hd!;
    const localPath = path.join(downloadDir, `${prefix}_${Date.now()}_${i}.png`);

    // Try HD first
    let done = false;
    if (hdUrl && hdUrl !== thumbUrl) {
      try {
        execSync(`curl -sLf -o '${localPath}' '${hdUrl}'`, { timeout: 120000 });
        const stat = fs.statSync(localPath);
        if (stat.size > 200 * 1024) {
          results.push({ url: thumbUrl, hdUrl, localPath, size: stat.size, isHD: true });
          tips.push(`📁 [${i + 1}/${entries.length}] HD ${(stat.size / 1024 / 1024).toFixed(1)}MB`);
          done = true;
        } else {
          fs.unlinkSync(localPath);
        }
      } catch {
        if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
      }
    }
    // Fallback to thumbnail
    if (!done && thumbUrl) {
      try {
        execSync(`curl -sLf -o '${localPath}' '${thumbUrl}'`, { timeout: 120000 });
        const stat = fs.statSync(localPath);
        if (stat.size < 1024) { fs.unlinkSync(localPath); throw new Error('文件过小'); }
        results.push({ url: thumbUrl, hdUrl: thumbUrl, localPath, size: stat.size, isHD: false });
        tips.push(`📁 [${i + 1}/${entries.length}] 缩略图 ${(stat.size / 1024).toFixed(0)}KB`);
      } catch (err) {
        tips.push(`⚠️ [${i + 1}/${entries.length}] 下载失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return results;
}

/**
 * Rewrite a doubao/ByteDance ImageX URL from a thumbnail transform to the
 * HD transform. The ImageX transform syntax is:
 *
 *   <base>~tplv-<op>.<op>.<op>...<fmt>[!<more_ops>][?query]
 *
 * where the LAST `.`-separated segment of the opchain is the output
 * format (e.g. `webp`, `png`, `jpeg`). HD variants use the
 * `image_pre_watermark_1_5b` template.
 *
 * Examples:
 *   .../xxx~tplv-downsize_watermark.img_pre_mark.webp
 *     → .../xxx~tplv-image_pre_watermark_1_5b.image_pre_watermark_1_5b.webp
 *   .../xxx~tplv-some.transform.png?x=1
 *     → .../xxx~tplv-image_pre_watermark_1_5b.image_pre_watermark_1_5b.png?x=1
 *
 * If the URL has no `~tplv-` transform, returns null (cannot rewrite).
 */
export function rewriteToHD(url: string): string | null {
  // Already HD
  if (url.includes('image_pre_watermark')) return url;
  const idx = url.indexOf('~tplv-');
  if (idx < 0) return null;

  // Find end of the transform opchain segment.
  // It ends at the first of: '!' (next op group), '?' (query), or '/' (path).
  let end = url.length;
  const bangIdx = url.indexOf('!', idx);
  const qIdx = url.indexOf('?', idx);
  const sIdx = url.indexOf('/', idx + 6);
  if (bangIdx > 0) end = Math.min(end, bangIdx);
  if (qIdx > 0) end = Math.min(end, qIdx);
  if (sIdx > 0) end = Math.min(end, sIdx);

  const before = url.substring(0, idx);
  const opchain = url.substring(idx, end);
  const after = url.substring(end);

  // Split opchain by '.', preserve last segment as format extension
  // (e.g. "webp", "png", "jpeg"). Skip the leading "~tplv-" prefix when
  // finding the format dot — that segment is the template name.
  const opParts = opchain.split('.');   // ["~tplv-downsize_watermark","img_pre_mark","webp"]
  let fmt = '';
  if (opParts.length >= 3) {
    // Last segment looks like a format extension (short, no underscores)
    const last = opParts[opParts.length - 1]!;
    if (/^(webp|png|jpe?g|gif|bmp|heic)$/i.test(last)) {
      fmt = '.' + last;
      opParts.pop();
    }
  }

  return `${before}~tplv-image_pre_watermark_1_5b.image_pre_watermark_1_5b${fmt}${after}`;
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

  // ────────────────────────────────────────────────────────────────
  //  STRATEGY A: Network capture via REAL mouse click lightbox
  // ────────────────────────────────────────────────────────────────
  const capturedHD: string[] = [];
  const seen = new Set<string>();
  const captureHandler = (resp: unknown): void => {
    const r = resp as { url?: () => string };
    const url = typeof r.url === 'function' ? r.url() : '';
    if (!url || !url.includes('rc_gen_image')) return;
    if (seen.has(url)) return;
    seen.add(url);
    // HD version has image_pre_watermark (version suffix may bump)
    if (url.includes('image_pre_watermark')) {
      capturedHD.push(url);
    }
  };
  page.on('response', captureHandler);

  try {
    // 2) Open lightbox with REAL mouse click (not el.click()).
    //    doubao's CDP firewall rejects synthetic clicks (isTrusted=false),
    //    so we must use Input.dispatchMouseEvent via page.mouse.click.
    //
    //    Match by URL *prefix* (the object key in the ImageX path) rather
    //    than exact equality — the page's <img src> and our captured
    //    `imageUrls` may differ in transform/query suffix but share the
    //    same object path (e.g. .../rc_gen_image/52f5150c...).
    const firstBox = await page.evaluate((urls: string[]) => {
      // Extract object keys (the stable part of the path) from each URL
      const keys = urls.map(u => {
        const m = u.match(/rc_gen_image\/([a-f0-9]+)/i);
        return m ? m[1] : u.split('~')[0].split('/').pop() || '';
      }).filter(Boolean);
      const imgs = document.querySelectorAll<HTMLImageElement>('img');
      for (const img of Array.from(imgs)) {
        const src = img.src || img.currentSrc || '';
        for (const k of keys) {
          if (k && src.includes(k)) {
            const r = img.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2, found: true };
          }
        }
      }
      return { x: 0, y: 0, found: false };
    }, imageUrls).catch(() => ({ x: 0, y: 0, found: false })) as { x: number; y: number; found: boolean };

    if (firstBox.found) {
      await page.mouse.click(firstBox.x, firstBox.y);
    } else {
      tips.push('⚠️ 无法打开灯箱（未找到匹配的图片元素）');
    }
    await page.waitForTimeout(2500);

    // 3) + 4) REAL mouse click each subsequent thumbnail to trigger HD loads
    for (let i = 1; i < imageUrls.length; i++) {
      const thumbUrl = imageUrls[i]!;
      const thumbKey = (thumbUrl.match(/rc_gen_image\/([a-f0-9]+)/i)?.[1]) || '';
      const box = await page.evaluate((key: string) => {
        const all = document.querySelectorAll<HTMLImageElement>('img');
        for (const img of Array.from(all)) {
          const src = img.src || img.currentSrc || '';
          if (key && src.includes(key)) {
            const r = img.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2, found: true };
          }
        }
        // Fallback: try parent of thumbnail class
        const all2 = document.querySelectorAll<HTMLElement>('[class*="thumb"], [class*="thumbnail"]');
        for (const t of Array.from(all2)) {
          const im = t.querySelector<HTMLImageElement>('img');
          const src = im?.src || im?.currentSrc || '';
          if (im && key && src.includes(key)) {
            const r = t.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2, found: true };
          }
        }
        return { x: 0, y: 0, found: false };
      }, thumbKey).catch(() => ({ x: 0, y: 0, found: false })) as { x: number; y: number; found: boolean };

      if (box.found) {
        await page.mouse.click(box.x, box.y);
      }
      await page.waitForTimeout(1500);
    }

    // Close lightbox (Escape) to clean up
    await page.keyboard.press('Escape').catch(() => { /* ignore */ });
  } finally {
    page.off('response', captureHandler);
  }

  tips.push(`📸 灯箱捕获: ${capturedHD.length} 张 HD (期望 ${imageUrls.length} 张)`);

  // ────────────────────────────────────────────────────────────────
  //  STRATEGY B: URL rewrite fallback
  //  If the lightbox didn't yield enough HD URLs (firewall blocked it,
  //  or thumbnails don't load HD when clicked), rewrite each missing
  //  index's thumbnail URL to the HD transform.
  //
  //  NOTE: doubao URLs are signed (`x-signature` query param covers the
  //  full path including the `~tplv-` transform). Changing the transform
  //  invalidates the signature → HTTP 403. URL rewrite therefore only
  //  works for UNSIGNED imagex URLs. For signed doubao URLs, the network
  //  capture is the only reliable path; on failure we fall back to the
  //  original thumbnail (still usable, just lower res).
  // ────────────────────────────────────────────────────────────────
  const hdByUrl: string[] = [];
  let rewrittenCount = 0;
  for (let i = 0; i < imageUrls.length; i++) {
    if (capturedHD[i]) {
      hdByUrl.push(capturedHD[i]);
      continue;
    }
    // Only attempt rewrite if the URL is NOT signed (no x-signature param).
    // Signed doubao URLs will 403 on transform changes.
    const isSigned = imageUrls[i]!.includes('x-signature=');
    if (!isSigned) {
      const rewritten = rewriteToHD(imageUrls[i]!);
      if (rewritten) {
        hdByUrl.push(rewritten);
        rewrittenCount++;
        continue;
      }
    }
    // Last resort: use the original thumbnail URL
    hdByUrl.push(imageUrls[i]!);
  }
  if (rewrittenCount > 0) {
    tips.push(`🔄 URL 重写兜底: ${rewrittenCount} 张（缩略图 → HD transform）`);
  }

  // ────────────────────────────────────────────────────────────────
  //  Download each — HD first, fall back to thumbnail on failure
  // ────────────────────────────────────────────────────────────────
  const downloadDir = path.join(os.homedir(), '.xbrowser', 'downloads');
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

  const results: HDImageDownload[] = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const origUrl = imageUrls[i]!;
    const hdUrl = hdByUrl[i] ?? origUrl;
    const isHD = hdUrl.includes('image_pre_watermark');

    const ext = '.png';
    const localPath = path.join(downloadDir, `${prefix}_${Date.now()}_${i}${ext}`);

    // Try HD first
    let downloaded = false;
    if (isHD && hdUrl !== origUrl) {
      try {
        execSync(`curl -sLf -o '${localPath}' '${hdUrl}'`, { timeout: 120000 });
        const stat = fs.statSync(localPath);
        // Sanity: HD should be larger than a thumbnail (>200KB)
        if (stat.size > 200 * 1024) {
          results.push({ url: origUrl, hdUrl, localPath, size: stat.size, isHD: true });
          tips.push(`📁 [${i + 1}/${imageUrls.length}] ${localPath} (HD, ${(stat.size / 1024).toFixed(1)}KB)`);
          downloaded = true;
        } else {
          // Probably returned a transformed-but-not-HD variant, fall through
          fs.unlinkSync(localPath);
        }
      } catch {
        if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
      }
    }

    // Fallback: download thumbnail
    if (!downloaded) {
      try {
        execSync(`curl -sLf -o '${localPath}' '${origUrl}'`, { timeout: 120000 });
        const stat = fs.statSync(localPath);
        if (stat.size < 1024) {
          fs.unlinkSync(localPath);
          throw new Error('下载文件过小');
        }
        results.push({ url: origUrl, hdUrl: origUrl, localPath, size: stat.size, isHD: false });
        tips.push(`📁 [${i + 1}/${imageUrls.length}] ${localPath} (缩略图, ${(stat.size / 1024).toFixed(1)}KB)`);
      } catch (err) {
        tips.push(`⚠️ [${i + 1}/${imageUrls.length}] 下载失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return results;
}
