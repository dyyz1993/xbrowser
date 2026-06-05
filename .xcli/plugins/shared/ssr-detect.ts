export interface SsrDetectionResult {
  detected: boolean;
  framework?: string;
  variable?: string;
  dataKeys?: string[];
  tip?: string;
}

const SSR_VARIABLE_TO_FRAMEWORK: Record<string, string> = {
  __NEXT_DATA__: 'Next.js',
  __NUXT__: 'Nuxt.js',
  RENDER_DATA: 'Douyin/ByteDance',
  __INITIAL_STATE__: 'Generic SSR',
  __APP_DATA__: 'Generic SSR',
  __PRELOADED_STATE__: 'Generic SSR',
  __DATA__: 'Generic SSR',
  __SSR_DATA__: 'Generic SSR',
  __remixContext: 'Remix',
  __vite_ssr_data__: 'Vite SSR',
};

const SSR_VARIABLES = Object.keys(SSR_VARIABLE_TO_FRAMEWORK);

export async function detectSsr(page: import('../types').Page): Promise<SsrDetectionResult | undefined> {
  try {
    const result = await page.evaluate((vars) => {
      for (const varName of vars) {
        const value = (window as unknown as Record<string, unknown>)[varName];
        if (value != null && typeof value === 'object') {
          const keys = Object.keys(value as Record<string, unknown>).slice(0, 10);
          return { variable: varName, keys };
        }
      }
      return null;
    }, SSR_VARIABLES);

    if (!result) return undefined;

    const framework = SSR_VARIABLE_TO_FRAMEWORK[result.variable] ?? 'Unknown';
    const variable = result.variable;
    return {
      detected: true,
      framework,
      variable,
      dataKeys: result.keys,
      tip: `检测到 ${framework} SSR 页面，数据在 ${variable} 中，可直接提取`,
    };
  } catch {
    return undefined;
  }
}
