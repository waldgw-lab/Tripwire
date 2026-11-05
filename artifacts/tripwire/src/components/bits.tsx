import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { LogIn } from 'lucide-react';
import { cn } from '@/lib/utils';
import { reportingTone, sentimentTone } from '@/lib/workspace';

export function PageHead({ title, count, children }: { title: string; count?: number; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-5 pb-4 pt-6 md:px-8">
      <h1 className="font-serif text-3xl leading-none tracking-tight" data-testid="text-page-title">
        {title}
        {count !== undefined && <span className="ml-2 align-top font-mono text-xs text-muted-foreground">{count}</span>}
      </h1>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function ReportingChip({ value }: { value?: string }) {
  const v = value ?? 'unassessed';
  return (
    <span className={cn('inline-flex h-5 items-center rounded-sm px-1.5 font-mono text-[10px] uppercase tracking-wider', reportingTone[v])}>
      {v.replace('-', ' ')}
    </span>
  );
}

export function SentimentMark({ value, focus }: { value?: string; focus?: string }) {
  const v = value ?? 'unassessed';
  if (v === 'unassessed' && !focus) return null;
  return (
    <span className="font-mono text-[10px] uppercase tracking-wider">
      {v !== 'unassessed' && <span className={sentimentTone[v]}>{v}</span>}
      {focus && <span className="text-muted-foreground">{v !== 'unassessed' ? ' / ' : ''}{focus}</span>}
    </span>
  );
}

export function SignInAction({ label = 'Sign in', className }: { label?: string; className?: string }) {
  return (
    <Link
      href="/sign-in"
      data-testid="link-sign-in"
      className={cn('inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-card px-3 text-xs font-medium hover:border-accent hover:text-accent', className)}
    >
      <LogIn className="h-3.5 w-3.5" /> {label}
    </Link>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="tw-grid-bg m-5 flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-input px-6 py-16 text-center md:m-8">
      <p className="font-serif text-xl">{title}</p>
      {children}
    </div>
  );
}

export function RowsSkeleton({ n = 6 }: { n?: number }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="space-y-2 px-5 py-4 md:px-8">
          <div className="h-3 w-40 animate-pulse rounded bg-muted" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Empty title="Workspace could not load">
      <button onClick={onRetry} data-testid="button-retry" className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground">
        Retry
      </button>
    </Empty>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{children}</span>;
}
