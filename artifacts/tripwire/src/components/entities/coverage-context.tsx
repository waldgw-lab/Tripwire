import type { RegistryEntity } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';
import { linkStanding, useAllEntities } from '@/lib/coverage-tree';
import { Mono, Section } from './ui';

export const toneCls = { legacy: 'border-dashed border-muted-foreground text-muted-foreground', current: 'border-foreground text-foreground', caution: 'border-amber-600 text-amber-800' } as const;

export function CoverageContextSection({ e }: { e: RegistryEntity }) {
  const all = useAllEntities();
  const name = (id: string) => all.data?.find(x => x.id === id)?.name ?? id;
  const c = e.coverageContext; const links = e.roleLinks ?? [];
  if (!c && !links.length) return null;
  return <Section title="Coverage context" count={links.length || undefined}>
    {c && <div className="rounded-md border border-border bg-muted/40 p-2.5 text-xs" data-testid="text-coverage-context">
      <Mono>Original watch · tier {c.tier ?? 3} · read-only</Mono>
      <p className="mt-1 font-semibold">{c.title}</p>
      {(c.position || c.individual) && <p>{c.position ?? 'Position not specified'}{c.individual ? ` · named: ${c.individual} (legacy, unverified)` : ''}</p>}
      {c.organization && <p className="text-muted-foreground">Organization: {c.organization}</p>}
      {c.summary && <p className="mt-1 leading-relaxed text-muted-foreground">{c.summary}</p>}
    </div>}
    {links.length > 0 && <ul className="mt-2 space-y-1.5">{links.map((l, i) => { const s = linkStanding(l); return <li key={`${l.positionId}-${l.assertionId ?? i}`} className={cn('rounded-md border px-2.5 py-1.5 text-xs', toneCls[s.tone])} data-testid={`row-role-link-${i}`}>
      <span className="font-semibold">{name(l.positionId)}</span> <span className="font-mono text-[10px] uppercase">{s.label}</span>
    </li>; })}</ul>}
  </Section>;
}
