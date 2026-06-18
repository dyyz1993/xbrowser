/**
 * 追加注册 form-submit/menu-interact/navigate（Task 6）。
 * navigate 是兜底，必须排最后（low confidence）。
 */
import { registerMatcher } from './index.js';
import { formSubmitMatcher } from './form-submit.js';
import { menuInteractMatcher } from './menu-interact.js';
import { navigateMatcher } from './navigate.js';

registerMatcher(formSubmitMatcher);
registerMatcher(menuInteractMatcher);
registerMatcher(navigateMatcher);  // 兜底，最后
