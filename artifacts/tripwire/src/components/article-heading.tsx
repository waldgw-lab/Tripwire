import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { ExternalLink } from 'lucide-react';
import { OutletBrand } from '@/components/outlet-brand';

/** Feed-style article identity, also used by Claims coverage and focus overviews. */
export function ArticleHeading({ outlet, title, date, href, url, sourceTestId, children }: {
  outlet: string; title: string; date: string; href?: string; url?: string;
  sourceTestId?: string; children?: ReactNode;
}) {
  return <div className="flex min-w-0 items-start gap-3 sm:gap-4">
    <OutletBrand name={outlet} variant="square" className="mt-0.5 h-14 w-14 rounded-xl shadow-sm sm:h-16 sm:w-16" />
    <div className="min-w-0 flex-1">
      <div className="mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[10px] text-muted-foreground">
        <time>{date}</time><span aria-hidden>·</span>
        <span className="font-sans text-[11px] font-semibold uppercase text-foreground">{outlet}</span>
        {children}
      </div>
      {href ? <Link href={href} className="block text-[17px] font-medium leading-snug hover:underline sm:text-lg" data-testid={`${sourceTestId}-feed`}>{title}</Link>
        : <p className="text-[17px] font-medium leading-snug sm:text-lg">{title}</p>}
    </div>
    {url && <a href={url} target="_blank" rel="noreferrer" aria-label="Open publisher article in a new tab" title="Open publisher article"
      data-testid={sourceTestId} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground">
      <ExternalLink className="h-4 w-4" />
    </a>}
  </div>;
}
