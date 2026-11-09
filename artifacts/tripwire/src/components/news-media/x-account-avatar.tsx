import { useState } from 'react';
import type { XAccount } from '@workspace/api-client-react';
import { OutletBrand } from '@/components/outlet-brand';

/** A failed external image must never leave an empty/broken account icon. */
export function XAccountAvatar({ account }: { account: XAccount }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const src = account.profileImageUrl;
  const name = account.name || account.handle;
  const initials = name.trim().split(/\s+/).filter(Boolean).map(part => part[0]).filter(Boolean);
  const label = initials.length > 1 ? `${initials[0]}${initials.at(-1)}` : name.slice(0, 2);
  return <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary" data-testid={`avatar-x-${account.id}`}>
    {src && failedUrl !== src
      ? <img key={src} src={src} alt={`${name} profile`} title={name} className="h-full w-full object-cover"
          loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(src)} />
      : account.accountType === 'reporter'
        ? <span title={`${name} · photo unavailable`} aria-label={`${name} initials`} className="font-mono text-[11px] font-medium uppercase">{label}</span>
        : <OutletBrand name={account.outlet} variant="square" className="h-8 w-8" />}
  </span>;
}
