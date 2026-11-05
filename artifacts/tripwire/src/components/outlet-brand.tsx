import { useState } from 'react';
import { cn } from '@/lib/utils';

const brands: Record<string, { wordmark: string; mark?: string; wide?: boolean }> = {
  axios: { wordmark: 'axios' },
  'the washington post': { wordmark: 'washington-post', wide: true },
  'the wall street journal': { wordmark: 'wall-street-journal', mark: 'wall-street-journal-mark' },
  'the atlantic': { wordmark: 'atlantic', mark: 'atlantic-mark' },
  'the new york times': { wordmark: 'new-york-times', mark: 'new-york-times-mark' },
  'washington examiner': { wordmark: 'washington-examiner', mark: 'washington-examiner-mark' },
  cnn: { wordmark: 'cnn' },
  cbs: { wordmark: 'cbs', mark: 'cbs-mark' },
  reuters: { wordmark: 'reuters', mark: 'reuters-mark' },
  abc: { wordmark: 'abc', mark: 'abc-mark' },
};

/** Supplied brand assets, cropped to their artwork without changing proportions. */
export function OutletBrand({ name, variant = 'compact', className }: {
  name: string; variant?: 'compact' | 'wordmark'; className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const brand = brands[name.trim().toLowerCase()];
  if (!brand || failed) return <span className={cn('font-semibold', className)}>{name}</span>;
  const compact = variant === 'compact';
  const asset = compact && brand.mark ? brand.mark : brand.wordmark;
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 align-middle', className)} title={name}>
      <span className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-sm bg-white',
        !compact ? 'h-10 w-40 px-2 py-1.5'
          : brand.mark ? 'h-7 w-7 p-0.5'
          : brand.wide ? 'h-6 w-28 px-1'
          : brand.wordmark === 'cnn' ? 'h-6 w-12 px-1'
          : 'h-6 w-16 px-1',
      )}>
        <img
          src={`${import.meta.env.BASE_URL}outlet-logos/${asset}.png`}
          alt={compact && brand.mark ? '' : name}
          className="h-full w-full object-contain"
          onError={() => setFailed(true)}
          decoding="async"
        />
      </span>
      {compact && brand.mark && <span className="font-semibold uppercase tracking-wide">{name}</span>}
    </span>
  );
}
