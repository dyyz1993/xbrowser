import type { PromoPlatform, PromoConfig, PromoResult } from './types.js';
import { publishToDevto } from './devto.js';
import { publishToMedium } from './medium.js';
import { publishToCsdn } from './csdn.js';
import { publishToJuejin } from './juejin.js';
import { publishToQuora } from './quora.js';

type PublishFn = (config: PromoConfig) => Promise<PromoResult>;

const PUBLISHERS: Record<PromoPlatform, PublishFn> = {
  devto: publishToDevto,
  medium: publishToMedium,
  csdn: publishToCsdn,
  juejin: publishToJuejin,
  quora: publishToQuora,
};

export async function dispatchPromo(config: PromoConfig): Promise<PromoResult> {
  const publisher = PUBLISHERS[config.platform];
  if (!publisher) {
    return {
      success: false,
      error: `Unknown platform: ${config.platform}. Supported: ${Object.keys(PUBLISHERS).join(', ')}`,
      platform: config.platform,
    };
  }
  return publisher(config);
}

export type { PromoPlatform, PromoConfig, PromoResult };
