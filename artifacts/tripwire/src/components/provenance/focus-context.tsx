import { SecondaryCategoryTags } from './category-tags';
import { Disclosure } from './provenance-panel';

type Ctx = {
  secondaryCategories?: { id: string; label: string; description?: string }[];
  developments?: string[];
  relatedSubjects?: string[];
};

/** Aggregates context across every relevant summary (exact unions, first-seen order). */
export function mergeContext(list: (Ctx | undefined)[]): Ctx {
  const dev = new Set<string>(), rel = new Set<string>(), cats = new Map<string, { id: string; label: string; description?: string }>();
  for (const s of list) {
    s?.developments?.forEach(d => dev.add(d));
    s?.relatedSubjects?.forEach(r => rel.add(r));
    s?.secondaryCategories?.forEach(c => { if (!cats.has(c.id)) cats.set(c.id, c); });
  }
  return { developments: [...dev], relatedSubjects: [...rel], secondaryCategories: [...cats.values()] };
}

export function FocusContext({ summary, summaries }: { summary?: Ctx; summaries?: (Ctx | undefined)[] }) {
  const c = summaries ? mergeContext(summaries) : mergeContext([summary]);
  const extra = (c.secondaryCategories?.length ?? 0) + (c.relatedSubjects?.length ?? 0);
  return <div className="my-2 space-y-1.5 text-[11px] text-muted-foreground" data-testid="focus-context">
    {!!c.developments?.length && <p data-testid="text-focus-developments"><span className="font-medium text-foreground">Developments: </span>{c.developments.join(' · ')}</p>}
    {extra > 0 && <Disclosure label="Topic tags and related subjects" count={extra} testId="details-focus-tags" className="max-w-3xl">
      <SecondaryCategoryTags categories={c.secondaryCategories} />
      {!!c.relatedSubjects?.length && <p data-testid="text-related-subjects"><span className="font-medium text-foreground">Related subjects: </span>{c.relatedSubjects.join(' · ')}</p>}
    </Disclosure>}
  </div>;
}
