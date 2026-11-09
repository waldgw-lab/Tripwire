import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retainedComparison } from '../artifacts/tripwire/src/lib/retained-comparison.ts';

test('comparison preserves original UTF-16 offsets and finds relocated selected wording', () => {
  const quote = 'Officials denied that the fictional northern command endangered troops.';
  const original = `😀 Original introduction.\n${quote}\nEarlier background.`;
  const start = original.indexOf(quote);
  const selected = `A longer cleaned introduction with a different offset.\n${quote}\nCurrent context.`;
  const result = retainedComparison(original, selected, quote, start, start + quote.length);
  assert.equal(result.valid, true);
  assert.equal(result.original.quote, quote);
  assert.equal(result.selected.quote, quote);
  assert.equal(result.selectedStart, selected.indexOf(quote));
  assert.notEqual(result.selectedStart, start);
});
test('absence and invalid original quotations remain distinct', () => {
  const quote = 'Original exact quotation.';
  const absent = retainedComparison(quote, 'A different retained copy.', quote, 0, quote.length);
  assert.equal(absent.valid, true);
  assert.equal(absent.selected, null);
  for (const [start, end] of [[-1, 20], [1, quote.length], [0, 500], [0.5, 10]])
    assert.equal(retainedComparison(quote, quote, quote, start, end).valid, false);
});
