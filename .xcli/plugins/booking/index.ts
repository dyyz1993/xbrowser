import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  xcli.createSite({
    name: 'booking',
    url: 'https://www.booking.com',
    description: 'Booking.com - 酒店预订',
    requiresLogin: false,
  });

  // TODO: Implement commands per opencli adapter
  // site.command('xxx', { ... });
}
