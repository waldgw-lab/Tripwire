import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessArticle, inferTopic, subjectText } from '../artifacts/api-server/src/lib/tripwire-impact-policy.ts';
import { mentionedEntities } from '../artifacts/api-server/src/lib/tripwire-signals.ts';
test('domain ambiguity, artificial intelligence and unsupported topic stay separate', () => {
  for (const title of ['A president of basketball operations', 'Labor strikes enter second week', 'Memory inhibition strikes unexpectedly', 'Artificial intelligence advances']) {
    assert.equal(inferTopic(title, ''), 'Unclassified', title);
  }
  assert.equal(inferTopic('U.S. military carries out limited strikes on Iran’s Qeshm Island', ''), 'Military Operations');
  assert.equal(inferTopic('CIA intelligence findings on Iran', ''), 'Intelligence');
  assert.equal(inferTopic('NATO strike planning', ''), 'Military Operations');
});
test('credits, navigation and generic roles do not establish watch subjects', () => {
  const watches = [{ title: 'Donald Trump', aliases: ['Trump'], position: 'president', watchType: 'position' }];
  assert.deepEqual(mentionedEntities('Photo credit: Harry Trump / Getty\nA president of basketball operations made a trade.', watches), []);
  assert.deepEqual(mentionedEntities('Main subject.\nRelated Articles\nTrump orders a strike', watches), []);
  assert.deepEqual(mentionedEntities('President Trump discussed Pentagon policy.', watches), ['Donald Trump']);
});
test('circled unrelated genres and personal health are negative calibration examples', () => {
  for (const article of [
    { title: 'Can LeBron James Chase Away Philadelphia’s Demons?', fullText: 'The NBA basketball star joined the Sixers. A president of basketball operations was fired. '.repeat(4) },
    { title: 'Photos of the Week', fullText: 'Photo credit: Harry Trump / Getty\nA labor strike in Europe. '.repeat(10) },
    { title: 'An Absolute Beauty', fullText: 'Pity the book reviewer. This hockey novel is set in 1951. '.repeat(10) },
    { title: 'What I Lost to Shock Therapy', fullText: 'My electroconvulsive therapy and memory inhibition strikes. '.repeat(10) },
  ]) {
    const result = assessArticle(article);
    assert.equal(result.impact, 'low', article.title);
    assert.equal(result.relevance, 'unrelated', article.title);
    assert.equal(result.topic, 'Unclassified', article.title);
  }
});
test('low sample consequential positives require neither a named watch nor sensational framing', () => {
  for (const title of [
    'NATO strike planning', 'Procurement constraints on Israel aid', 'U.S. strikes Iranian targets',
    'Iran sent nuclear proposal to the US via Qatar', 'Intelligence findings reveal Iranian military capabilities',
    'States secure voting after federal pullback', 'U.S. approves sale of Patriot interceptors',
    'National Guard patrol expansion', 'A Chinese bank facilitates Iranian weapons funding',
    'Pentagon advisers discuss leadership succession', 'Fired general accused of being source for Wall Street Journal, NYT',
  ]) {
    const result = assessArticle({ title });
    assert.ok(['high', 'critical'].includes(result.impact), title);
    assert.equal(result.confidence, 'limited');
  }
});
test('originality, incidental names and ceremonial updates are not critical', () => {
  assert.equal(assessArticle({title: 'Trump will attend Army-Navy football game', fullText:'The event takes place next month. Hegseth was fired years earlier.'}).impact, 'low');
  assert.equal(assessArticle({title:'Trump speaks at a ceremony', reportingType:'original'}).impact, 'low');
  assert.equal(assessArticle({title:'LIV Golf funding and the war',fullText:'Saudi funding and Iran policy discussed by golfers.'}).impact, 'low');
  assert.notEqual(assessArticle({title:'LIV Golf funding and the war',fullText:'Saudi funding and Iran policy discussed by golfers.'}).relevance, 'unrelated');
  assert.equal(assessArticle({title:'Advisers discuss Hegseth removal'}).impact, 'critical');
  assert.equal(assessArticle({title:'Defiant Hegseth responds to calls for his removal',fullText:'Pentagon advisers discuss Hegseth removal.'}).impact, 'high');
});
