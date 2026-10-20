/**
 * 追加注册 form-submit/chat/menu-interact/navigate（Task 6 + chat 补丁）。
 * chat 排在 form-submit 前（chat 有发送按钮/Enter，比 form-submit 更具体）。
 * navigate 是兜底，必须排最后（medium confidence）。
 */
import { registerMatcher } from './index.js';
import { chatMatcher } from './chat.js';
import { formSubmitMatcher } from './form-submit.js';
import { menuInteractMatcher } from './menu-interact.js';
import { navigateMatcher } from './navigate.js';

registerMatcher(chatMatcher);        // AI 聊天发消息（ChatGPT/DeepSeek 等核心场景）
registerMatcher(formSubmitMatcher);
registerMatcher(menuInteractMatcher);
registerMatcher(navigateMatcher);    // 兜底，最后
