// Synthetic HTML for pure parsing and isolated-schema tests only.
export const publicUser = (handle = 'BarakRavid', id = '1') => ({
  __typename: 'User', id: Buffer.from(`User:${id}`).toString('base64'), rest_id: id,
  core: { screen_name: handle, name: 'Fixture reporter' }, privacy: { protected: false },
  avatar: { image_url: 'https://pbs.twimg.com/profile_images/1/fixture.jpg' },
});
export const publicPost = (id = '1001', handle = 'BarakRavid', userId = '1', extra = {}) => ({
  __typename: 'Tweet', rest_id: id,
  core: { user_results: { result: publicUser(handle, userId) } },
  details: { full_text: `Isolated sample ${id}`, created_at_ms: Date.parse('2026-11-09T12:34:56Z') },
  ...extra,
});
export const publicEntry = (post) => ({
  entry_id: `tweet-${post.rest_id}`, content: { content: { tweet_results: { result: post } } },
});
export function publicHtml(handle = 'BarakRavid', userId = '1', posts = [publicPost()], moreInstructions = [], user = publicUser(handle, userId)) {
  const value = (result) => `kind:"Result.Ok",value:${JSON.stringify(JSON.stringify({ data: { user_result_by_screen_name: { result } } }))}`;
  const timeline = { id: Buffer.from(`User:${userId}`).toString('base64'), profile_user_originals_timeline: {
    timeline: { instructions: [
      { __typename: 'TimelineAddEntries', entries: posts.map(publicEntry) }, ...moreInstructions,
    ] },
  } };
  return `<html><script>({${value(user)}})</script><script>({${value(timeline)}})</script></html>`;
}
