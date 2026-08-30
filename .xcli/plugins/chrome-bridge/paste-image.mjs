#!/usr/bin/env node
/**
 * chrome-bridge paste-image — 零痕迹粘贴（S117）
 *
 * 流程：OS 剪贴板写入图片 → AppleScript 激活 Chrome 并发真实 Cmd+V 键击。
 * 浏览器收到的是 OS 级可信输入（isTrusted=true）+ 真实剪贴板内容 ——
 * 与人工操作完全无差别。
 * 用法：node paste-image.mjs <image-path> [tabTitleKeyword]
 */
import { execSync } from 'child_process';

const imgPath = process.argv[2];
const titleKw = process.argv[3] || '';
if (!imgPath) { console.error('usage: paste-image.mjs <image-path> [tab-title-keyword]'); process.exit(1); }

// 1) 写 OS 剪贴板（PNG 数据）
execSync(`osascript -e 'set the clipboard to (read (POSIX file "${imgPath}") as «class PNGf»)'`);

// 2) 激活 Chrome 并聚焦目标 tab（若有关键词则用 Chrome AppleScript 切 tab）
if (titleKw) {
  execSync(`osascript -e '
tell application "Google Chrome"
  activate
  repeat with w in windows
    set i to 0
    repeat with t in tabs of w
      set i to i + 1
      if title of t contains "${titleKw}" then
        set active tab index of w to i
        return
      end if
    end repeat
  end repeat
end tell'`);
} else {
  execSync(`osascript -e 'tell application "Google Chrome" to activate'`);
}
execSync('sleep 1');

// 3) 真实 Cmd+V 键击（System Events = OS 级可信输入）
execSync(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`);
console.log('paste-image: clipboard set + Cmd+V sent (trusted OS input)');
