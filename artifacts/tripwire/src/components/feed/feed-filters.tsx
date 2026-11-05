import { SlidersHorizontal } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { emptyFeedFilters, filterSelectionCount, type FeedFilterKey, type FeedFilters } from '@/lib/feed-filters';
import { cn } from '@/lib/utils';

export function FeedFilterMenu({ value, onChange, topics, outlets, reporting, sentiment, focus }: {
  value: FeedFilters; onChange: (filters: FeedFilters) => void;
  topics: string[]; outlets: string[]; reporting: readonly string[]; sentiment: readonly string[]; focus: readonly string[];
}) {
  const count = filterSelectionCount(value);
  const categories: { key: FeedFilterKey; label: string; options: readonly string[] }[] = [
    { key: 'impact', label: 'Impact', options: ['critical', 'high', 'low'] },
    { key: 'topic', label: 'Topic', options: topics },
    { key: 'outlet', label: 'Outlet', options: outlets },
    { key: 'reporting', label: 'Reporting', options: reporting },
    { key: 'sentiment', label: 'Sentiment', options: sentiment },
    { key: 'focus', label: 'Focus', options: focus },
  ];
  return <Popover>
    <PopoverTrigger asChild>
      <button className={cn('inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-input bg-card px-3 text-xs shadow-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2', count > 0 && 'border-foreground')} data-testid="button-feed-filters">
        <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
        {count > 0 && <span className="rounded bg-foreground px-1.5 py-0.5 font-mono text-[10px] text-background" aria-label={`${count} selections`}>{count}</span>}
      </button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-[min(720px,calc(100vw-24px))] overflow-hidden p-0" aria-label="Feed filters" data-testid="panel-feed-filters">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Filters</h2>
        <button onClick={() => onChange(emptyFeedFilters())} disabled={!count} className="text-xs underline underline-offset-4 disabled:opacity-40" data-testid="button-reset-feed-filters">Reset</button>
      </div>
      <div className="grid max-h-[min(65dvh,520px)] grid-cols-1 gap-3 overflow-y-auto p-4 min-[420px]:grid-cols-2 md:grid-cols-3">
        {categories.map(category => <fieldset key={category.key} className="min-w-0 rounded-lg border border-border p-3" data-testid={`filter-category-${category.key}`}>
          <legend className="px-1 text-xs font-semibold">{category.label}</legend>
          <div className="mb-2 flex items-center gap-3 text-[11px] text-neutral-600">
            <button type="button" onClick={() => onChange({ ...value, [category.key]: [...category.options] })} disabled={!category.options.length} className="hover:text-foreground disabled:opacity-40" data-testid={`filter-select-all-${category.key}`}>Select all</button>
            <button type="button" onClick={() => onChange({ ...value, [category.key]: [] })} disabled={!value[category.key].length} className="hover:text-foreground disabled:opacity-40" data-testid={`filter-clear-${category.key}`}>Clear</button>
          </div>
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {category.options.map(option => <label key={option} className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-xs hover:bg-muted">
              <input type="checkbox" checked={value[category.key].includes(option)}
                onChange={event => onChange({ ...value, [category.key]: event.target.checked ? [...value[category.key], option] : value[category.key].filter(item => item !== option) })}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-black"
                data-testid={`filter-option-${category.key}-${option}`} />
              <span className={category.key === 'impact' ? 'uppercase' : 'capitalize'}>{option.replaceAll('-', ' ')}</span>
            </label>)}
          </div>
        </fieldset>)}
      </div>
    </PopoverContent>
  </Popover>;
}
