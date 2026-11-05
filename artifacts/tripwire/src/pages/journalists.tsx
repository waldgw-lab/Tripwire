import { Redirect, useSearch } from 'wouter';

/** Keep bookmarked journalist profiles working after consolidation into News Media. */
export default function JournalistsPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  params.set('tab', 'journalists');
  return <Redirect to={`/outlets?${params.toString()}`} />;
}
