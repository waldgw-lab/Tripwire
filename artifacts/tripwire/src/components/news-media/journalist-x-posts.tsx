import { Link } from 'wouter';
import type { TrackedRecord, XAccount } from '@workspace/api-client-react';
import { publicationET } from '@/lib/article-signals';

/** Social activity stays separate from article credits and counts. */
export function JournalistXPosts({ accounts, posts }: { accounts: XAccount[]; posts: TrackedRecord[] }) {
  if (!accounts.length && !posts.length) return null;
  return <section className="border-t border-border px-3 py-3" aria-label="Journalist X posts" data-testid="section-journalist-x-posts">
    <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
      <h3 className="font-medium">X POSTS · {posts.length}</h3>
      {accounts.map(a => <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="underline">@{a.handle}</a>)}
      <Link href="/outlets?tab=x-feeds" className="text-muted-foreground underline">Tracking settings and status</Link>
    </div>
    <p className="mt-1 text-[11px] text-muted-foreground">Account activity, not article credits or independent confirmation.</p>
    {posts.length ? <ul className="mt-2 divide-y divide-border">{posts.map(post => <li key={post.id} className="py-2" data-testid={`profile-x-post-${post.id}`}>
      <div className="mb-1 flex flex-wrap gap-x-3 font-mono text-[10px] text-muted-foreground">
        <span>{publicationET(post.publishedAt).label}</span><span>@{post.xPost?.handle ?? accounts.find(a => a.id === post.xPost?.watchId)?.handle ?? accounts[0]?.handle}</span>
        <span>{post.xPost?.references.some(r => r.type === 'retweeted') ? 'Repost' : post.xPost?.references.some(r => r.type === 'quoted') ? 'Quote post' : post.xPost?.references.some(r => r.type === 'replied_to') ? 'Reply' : 'Post'}</span>
      </div>
      <p className="whitespace-pre-line text-sm leading-relaxed">{post.fullText ?? post.summary ?? post.title}</p>
      <div className="mt-2 flex flex-wrap gap-4 font-mono text-[11px]">
        <Link href={`/?article=${encodeURIComponent(post.id)}`} className="underline">Open reader and Claims context</Link>
        {post.url && <a href={post.url} target="_blank" rel="noreferrer" className="text-muted-foreground underline">Original X post</a>}
      </div>
    </li>)}</ul> : <p className="mt-2 text-xs text-muted-foreground">No X posts collected yet. Check the X Feeds tab for access and account status.</p>}
  </section>;
}
