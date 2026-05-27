export type PromoPlatform = 'devto' | 'medium' | 'csdn' | 'juejin' | 'quora';

export interface PromoConfig {
  platform: PromoPlatform;
  file: string;
  tags?: string;
  title?: string;
  search?: string;
  cdpEndpoint?: string;
  session?: string;
}

export interface PromoResult {
  success: boolean;
  url?: string;
  error?: string;
  platform: PromoPlatform;
}
