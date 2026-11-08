import { SecondaryCategoryTags } from './category-tags';

export function FocusContext({ summary }: { summary?: {
  secondaryCategories?: { id: string; label: string; description?: string }[];
  developments?: string[];
  relatedSubjects?: string[];
} }) {
  return <div className="my-2 space-y-1.5 text-[11px] text-muted-foreground" data-testid="focus-context">
    <SecondaryCategoryTags categories={summary?.secondaryCategories} />
    {!!summary?.developments?.length && <p><span className="font-medium text-foreground">Developments: </span>{summary.developments.join(' · ')}</p>}
    {!!summary?.relatedSubjects?.length && <p><span className="font-medium text-foreground">Related subjects: </span>{summary.relatedSubjects.join(' · ')}</p>}
  </div>;
}
