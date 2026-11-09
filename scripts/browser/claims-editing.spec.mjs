import { test,expect,staffing,policy } from './claims-editor-fixture.mjs';

test('article focus search, cancellation, save and automatic reset persist without moving other articles',async({page,editorState})=>{
  await page.goto('/feed?article=policy');
  await page.getByTestId('button-focus-policy').click();
  await page.getByTestId('input-search-focus').fill('Pentagon');
  await expect(page.getByTestId('select-existing-focus').locator('option')).toHaveCount(2);
  await page.getByTestId('select-existing-focus').selectOption(staffing.topic);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  expect(editorState.writes).toHaveLength(0);
  await page.getByTestId('button-focus-policy').click();
  await page.getByTestId('select-existing-focus').selectOption(staffing.topic);
  await page.getByTestId('button-save-focus').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('button-focus-policy')).toContainText(staffing.title);
  await page.reload();
  await page.getByTestId('button-focus-policy').click();
  await expect(page.getByTestId('text-current-focus')).toContainText(staffing.title);
  await page.getByTestId('button-clear-focus').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(editorState.records.find(r=>r.id==='policy').focusOverride).toBeNull();
  expect(editorState.records.find(r=>r.id==='staff-new').focusOverride).toBeUndefined();
});

test('shared group edits require scope confirmation and reset independently of article choices',async({page,editorState})=>{
  await page.goto('/claims');
  await page.getByTestId(`button-edit-group-${staffing.topic}`).click();
  await expect(page.getByTestId('text-group-scope')).toContainText('2 reporting articles');
  await page.getByTestId('input-group-label').fill('Leadership accountability');
  await page.getByTestId('select-group-category').selectOption(policy.category);
  await page.getByTestId('input-group-reason').fill('Group reviewed by the analyst');
  await expect(page.getByTestId('button-save-group')).toBeDisabled();
  await page.getByTestId('checkbox-confirm-group').check();
  await page.getByTestId('button-save-group').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId(`button-topic-${policy.category}-${staffing.topic}`)).toContainText('Leadership accountability');
  await page.reload();
  await page.getByTestId(`button-edit-group-${staffing.topic}`).click();
  await expect(page.getByTestId('input-group-label')).toHaveValue('Leadership accountability');
  await page.getByTestId('input-group-reason').fill('Restore the original shared label');
  await page.getByTestId('checkbox-confirm-group').check();
  await page.getByTestId('button-reset-group').click();
  await expect(page.getByTestId(`button-topic-${staffing.category}-${staffing.topic}`)).toContainText(staffing.title);
  expect(editorState.writes).toHaveLength(2);
});

test('claim edits preserve publisher quotation and keep typed input on a stale-save error',async({page,editorState})=>{
  await page.goto('/claims?claim=shared');
  await page.getByTestId('button-edit-claim').click();
  await page.getByTestId('input-claim-title').fill('Analyst-corrected claim wording');
  await page.getByTestId('input-claim-summary').fill('Reviewed analyst notes');
  await page.getByTestId('input-claim-reason').fill('Correct wording without changing evidence');
  await page.route('**/api/tripwire/claims/shared/correction',route=>route.fulfill({status:409,json:{error:'Claim changed elsewhere'}}));
  await page.getByTestId('button-submit').click();
  await expect(page.getByRole('alert')).toContainText('Claim changed elsewhere');
  await expect(page.getByTestId('input-claim-title')).toHaveValue('Analyst-corrected claim wording');
  expect(editorState.writes).toHaveLength(0);
  await page.unroute('**/api/tripwire/claims/shared/correction');
  await page.getByTestId('button-cancel').click();
  await page.getByTestId('button-edit-claim').click();
  await page.getByTestId('input-claim-title').fill('Analyst-corrected claim wording');
  await page.getByTestId('input-claim-reason').fill('Correct wording without changing evidence');
  await page.getByTestId('button-submit').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('detail-claim-shared')).toContainText('Analyst-corrected claim wording');
  await expect(page.getByTestId('detail-claim-shared')).toContainText('A retained quotation that must never change.');
  await page.reload();
  await expect(page.getByTestId('detail-claim-shared')).toContainText('Analyst-corrected claim wording');
});

test('passage association corrections exclude and restore without altering the retained quote',async({page,editorState})=>{
  await page.goto('/claims?claim=shared');
  await page.getByTestId('button-correct-link-observation-policy').click();
  await page.getByTestId('select-link-claim').selectOption('');
  await page.getByTestId('input-link-reason').fill('The passage does not support this claim');
  await page.getByTestId('button-save-link').click();
  await expect(page.getByTestId('text-historical-link-observation-policy')).toBeVisible();
  await expect(page.getByTestId('provenance-history-notice')).toContainText('1 historical passage');
  await expect(page.getByTestId('detail-claim-shared')).toContainText('A retained quotation that must never change.');
  await page.reload();
  await page.getByTestId('button-correct-link-observation-policy').click();
  await page.getByTestId('select-link-claim').selectOption('shared');
  await page.getByTestId('input-link-reason').fill('Restore the original association after review');
  await page.getByTestId('button-save-link').click();
  await expect(page.getByTestId('text-historical-link-observation-policy')).toHaveCount(0);
  await expect(page.getByTestId('provenance-history-notice')).toHaveCount(0);
  expect(editorState.links).toHaveLength(2);
  await expect(page.getByTestId('detail-claim-shared')).toContainText('A retained quotation that must never change.');
});
