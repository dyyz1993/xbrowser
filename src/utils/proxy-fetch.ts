let patched = false;

type UndiciDispatcher = { dispatch: unknown };
type UndiciFetch = (
  input: string | URL | Request,
  init?: RequestInit & { dispatcher?: UndiciDispatcher },
) => Promise<Response>;

export async function ensureProxyFetch(): Promise<void> {
  if (patched) return;
  patched = true;

  const proxyUrl =
    process.env.https_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy ||
    process.env.HTTP_PROXY ||
    process.env.all_proxy ||
    process.env.ALL_PROXY;

  if (!proxyUrl) return;

  try {
    // @ts-ignore undici is an optional dependency that may not be installed
    const undici: Record<string, unknown> = await import('undici');
    const EnvHttpProxyAgent = undici.EnvHttpProxyAgent as (new () => UndiciDispatcher) | undefined;
    const uFetch = undici.fetch as UndiciFetch | undefined;
    const UFormData = undici.FormData as typeof FormData | undefined;

    if (EnvHttpProxyAgent && uFetch && UFormData) {
      const agent = new EnvHttpProxyAgent();

      globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const body = init?.body;
        if (body instanceof globalThis.FormData && !(body instanceof UFormData)) {
          const ufd = new UFormData();
          (body as unknown as FormData).forEach((value: FormDataEntryValue, key: string) => {
            if (value instanceof Blob) {
              ufd.append(key, value, (value as File).name || 'file');
            } else {
              ufd.append(key, value);
            }
          });
          return uFetch(url, { ...init, body: ufd, dispatcher: agent });
        }
        return uFetch(url, { ...init, dispatcher: agent });
      }) as typeof fetch;
    }
  } catch {
    // Proxy not available
  }
}
