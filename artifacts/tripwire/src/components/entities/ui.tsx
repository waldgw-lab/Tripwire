import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const Mono = ({ children, className }: { children: ReactNode; className?: string }) =>
  <span className={cn('font-mono text-[10px] uppercase tracking-wider text-muted-foreground', className)}>{children}</span>;

const STATE_TONE: Record<string, string> = {
  Active: 'bg-primary text-primary-foreground',
  Watch: 'border border-foreground text-foreground',
  Discovered: 'border border-dashed border-muted-foreground text-muted-foreground',
  Archived: 'bg-muted text-muted-foreground line-through',
  Immediate: 'bg-red-700 text-white',
  Review: 'bg-amber-500/90 text-black',
  Collection: 'bg-muted text-muted-foreground',
};
export function Tag({ value, className }: { value: string; className?: string }) {
  return <span className={cn('inline-flex h-5 items-center rounded-sm px-1.5 font-mono text-[10px] uppercase tracking-wider', STATE_TONE[value] ?? 'bg-secondary text-secondary-foreground', className)} data-testid={`tag-${value}`}>{value}</span>;
}

export function ErrorLine({ error }: { error?: string }) {
  return error ? <p role="alert" className="rounded-md border border-red-700/40 bg-red-50 px-2.5 py-1.5 text-xs text-red-800" data-testid="text-action-error">{error}</p> : null;
}

export function Section({ title, count, children, action }: { title: string; count?: number; children: ReactNode; action?: ReactNode }) {
  return <section className="mt-6">
    <div className="mb-2 flex items-center justify-between gap-2 border-b border-border pb-1">
      <h3 className="font-display text-lg font-semibold uppercase tracking-wide">{title}{count != null && <span className="ml-2 font-mono text-xs text-muted-foreground">{count}</span>}</h3>
      {action}
    </div>
    {children}
  </section>;
}

export const inputCls = 'h-8 w-full rounded-md border border-input bg-background px-2 text-sm';
export const btnCls = 'inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs hover:border-foreground disabled:opacity-50';
export const primaryCls = 'inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50';
