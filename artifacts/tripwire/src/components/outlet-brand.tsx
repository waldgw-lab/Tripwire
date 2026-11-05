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
  name: string; variant?: 'compact' | 'wordmark' | 'square'; className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const key = name.trim().toLowerCase();
  const brand = brands[key];
  if (variant === 'square') {
    const isX = key === 'x';
    const initials = isX ? 'X' : key.includes('daily mail') ? 'DM' : key.startsWith('nbc') ? 'NBC'
      : name.replace(/^the\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 3).map((w) => w[0]).join('').toUpperCase() || '?';
    const img = brand && !failed ? (brand.mark ?? brand.wordmark) : null;
    return (
      <span title={name} role="img" aria-label={name}
        className={cn('flex aspect-square h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white', isX && 'bg-foreground text-background', className)}>
        {img ? (
          <img src={`${import.meta.env.BASE_URL}outlet-logos/${img}.png`} alt="" className={cn('max-h-full max-w-full object-contain', brand!.mark ? 'h-full w-full' : 'h-full w-full p-0.5')} onError={() => setFailed(true)} decoding="async" />
        ) : (
          <span className={cn('font-display font-bold leading-none tracking-tight', isX ? 'text-lg' : initials.length > 2 ? 'text-[11px]' : 'text-sm')}>{initials}</span>
        )}
      </span>
    );
  }
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
