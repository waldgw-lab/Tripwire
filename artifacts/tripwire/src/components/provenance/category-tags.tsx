/** These are topic context, not extra primary placements or evidence decisions. */
export function SecondaryCategoryTags({ categories }: {
  categories?: { id: string; label: string; description?: string }[];
}) {
  if (!categories?.length) return null;
  return (
    <div className="my-2 flex flex-wrap items-center gap-1 text-[11px]" data-testid="secondary-category-tags">
      <span className="mr-1 text-muted-foreground">Secondary topic tags</span>
      {categories.map(c => <span key={c.id} title={c.description}
        className="rounded-sm border border-border bg-card/60 px-1.5 py-0.5">{c.label}</span>)}
    </div>
  );
}
