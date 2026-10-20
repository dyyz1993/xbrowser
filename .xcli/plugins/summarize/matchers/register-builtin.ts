/**
 * 内置匹配器自注册（设计 §5）。
 *
 * 注册顺序 = 优先级 = 信号强度（最独特的信号排最前）：
 *   login（password 极强）> upload（filechooser 明确）> search（中等）> logout（文案强）
 *
 * form-submit/navigate/menu-interact 在 register-more.ts 追加（Task 6）。
 * 导入本模块即触发自注册（副作用）。
 */
import { registerMatcher } from './index.js';
import { loginMatcher } from './login.js';
import { uploadMatcher } from './upload.js';
import { searchMatcher } from './search.js';
import { logoutMatcher } from './logout.js';

registerMatcher(loginMatcher);
registerMatcher(uploadMatcher);
registerMatcher(searchMatcher);
registerMatcher(logoutMatcher);
