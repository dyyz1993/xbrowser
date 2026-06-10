/* eslint-disable @typescript-eslint/no-explicit-any */
export default function (xcli: any) {
  const site = xcli.createSite({
    name: 'test',
    url: 'https://example.com',
  });

  site.command('bad', {
    handler: async (params: any, ctx: any) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _page = (ctx as unknown as Record<string, unknown>).page;
    },
  });
}
