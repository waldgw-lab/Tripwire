import type { ReactNode } from 'react';
import { Link } from 'wouter';
import type { TrackedRecord } from '@workspace/api-client-react';
import { ArrowUpRight, ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { OutletBrand } from '@/components/outlet-brand';
import { publicationET } from '@/lib/article-signals';
import { articleCredits, creditLabel, nameKey, type CoverageItem, type JournalistCoverage } from '@/lib/media-coverage';

export function Disclosure({ open, onToggle, label, id, children, className }: {
  open: boolean; onToggle: () => void; label: string; id: string; children: ReactNode; className?: string;
}) {
  return <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id} aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
    className={cn('flex min-w-0 items-center gap-2 rounded-sm text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground', className)}>
    {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
    {children}
  </button>;
}

const domId = (s: string) => 'nm-' + s.replace(/[^a-z0-9]+/gi, '-');

function CoverageRow({ item, profile, showOutlet, openKey, isOpen, toggle }: {
  item: CoverageItem; profile: JournalistCoverage; showOutlet: boolean; openKey: string; isOpen: (k: string) => boolean; toggle: (k: string) => void;
}) {
  const a = item.article;
  const open = isOpen(openKey);
  const when = publicationET(a.publishedAt);
  const roles = [...new Set(item.credits.map(c => c.role))];
  const all = articleCredits(a);
  const raw = a.byline || (a.journalists ?? []).join(', ');
  const others = all.filter(c => !item.credits.some(m => nameKey(m.name) === nameKey(c.name)));
  return <li className="px-3 py-2" data-testid={`row-coverage-${profile.key}-${a.id}`}>
    <Disclosure open={open} onToggle={() => toggle(openKey)} label={a.title} id={domId(openKey)} className="w-full items-start">
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">{a.title}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className={cn(roles.includes('author') ? 'text-foreground' : '')}>{roles.join(' / ')}</span>
          <span>{when.label}</span>
          {showOutlet && a.outlet && <span className="normal-case tracking-normal">{a.outlet}</span>}
          {!!others?.length && <span className="normal-case tracking-normal">with {others.map(creditLabel).join(', ')}</span>}
        </div>
      </div>
    </Disclosure>
    {open && <div id={domId(openKey)} className="ml-5 mt-2 space-y-2 border-l border-border pl-3 text-sm">
      <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1 font-mono text-[11px]">
        <dt className="text-muted-foreground">Published</dt><dd>{when.label}</dd>
        <dt className="text-muted-foreground">Credits</dt>
        <dd>{all.map((c, i) => <span key={i}>{i > 0 && ', '}<span className={nameKey(c.name) === nameKey(profile.name) || item.credits.some(m => nameKey(m.name) === nameKey(c.name)) ? 'text-foreground' : 'text-muted-foreground'}>{creditLabel(c)}</span>{c.attribution && <span className="text-muted-foreground"> "{c.attribution}"</span>}</span>)}</dd>
        {raw && <><dt className="text-muted-foreground">Byline</dt><dd className="text-muted-foreground">{raw}</dd></>}
      </dl>
      {a.fullText?.trim() ? <div className="max-h-80 overflow-y-auto whitespace-pre-line font-serif text-[15px] leading-relaxed">{a.fullText}</div>
        : a.summary?.trim() ? <p className="font-serif text-[15px] leading-relaxed">{a.summary}</p>
        : <p className="font-mono text-[11px] text-muted-foreground">No text retained.</p>}
      <div className="flex flex-wrap items-center gap-4">
        <Link href={`/?article=${encodeURIComponent(a.id)}`} className="font-mono text-[11px] underline" data-testid={`link-reader-${a.id}`}>Open reader and source lineage</Link>
        {a.url && <a href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[11px] hover:underline" data-testid={`link-source-${a.id}`}>Source <ArrowUpRight className="h-3 w-3" /></a>}
      </div>
    </div>}
  </li>;
}

export function JournalistRow({ profile, outlet, scope, isOpen, toggle, signedIn, onEdit, onDelete, showOutlets }: {
  profile: JournalistCoverage; outlet?: string; scope: string; isOpen: (k: string) => boolean; toggle: (k: string) => void;
  signedIn: boolean; onEdit: (w: TrackedRecord) => void; onDelete: (w: TrackedRecord) => void; showOutlets?: boolean;
}) {
  const w = profile.watch;
  const items = outlet ? profile.coverage.filter(i => nameKey(i.article.outlet ?? '') === nameKey(outlet)) : profile.coverage;
  const key = `${scope}|j:${profile.key}`;
  const open = isOpen(key);
  return <li className={cn('group', w?.enabled === false && 'opacity-50')} data-testid={`row-journalist-${profile.key}`}>
    <div className="flex items-center gap-3 px-3 py-2 text-sm">
      <Disclosure open={open} onToggle={() => toggle(key)} label={profile.name} id={domId(key)} className="flex-1">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', w ? 'bg-foreground' : 'border border-muted-foreground')} />
        <span className="min-w-0">
          <span className={cn('block truncate', w ? 'font-medium' : 'text-muted-foreground')} data-testid={`text-journalist-${profile.key}`}>{profile.name}</span>
          {!!profile.aliases.length && <span className="block truncate font-mono text-[10px] text-muted-foreground">{profile.aliases.join(' · ')}</span>}
        </span>
        {!w && <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">byline</span>}
      </Disclosure>
      {showOutlets && <span className="hidden max-w-[220px] truncate text-xs text-muted-foreground sm:inline">
        {profile.outlets.length ? profile.outlets.map((o, i) => <span key={o}>{i > 0 && ', '}<OutletBrand name={o} /></span>) : '—'}
      </span>}
      <span className="w-10 text-right font-mono text-xs" data-testid={`text-items-${profile.key}`}>{items.length}</span>
      <div className="flex w-14 justify-end">
        {signedIn && w && <div className="flex opacity-100 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
          <button type="button" aria-label={`Edit ${profile.name}`} onClick={() => onEdit(w)} className="p-1 text-muted-foreground hover:text-foreground" data-testid={`button-edit-watch-${w.id}`}><Pencil className="h-3.5 w-3.5" /></button>
          <button type="button" aria-label={`Delete ${profile.name}`} onClick={() => onDelete(w)} className="p-1 text-muted-foreground hover:text-destructive" data-testid={`button-delete-watch-${w.id}`}><Trash2 className="h-3.5 w-3.5" /></button>
        </div>}
      </div>
    </div>
    {open && <div id={domId(key)} className="border-t border-border bg-background/40 pl-6">
      {items.length ? <ul className="divide-y divide-border">{items.map(item =>
        <CoverageRow key={item.article.id} item={item} profile={profile} showOutlet={!outlet} openKey={`${key}|a:${item.article.id}`} isOpen={isOpen} toggle={toggle} />)}</ul>
        : <p className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground">No coverage recorded{outlet ? ` at ${outlet}` : ''}.</p>}
    </div>}
  </li>;
}
