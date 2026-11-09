import { useState } from 'react';
import { useCorrectClaimLink, type ReportingClaim } from '@workspace/api-client-react';
import { byKind, errText, newRequestId, useInvalidateClaims, useWorkspace } from '@/lib/workspace';

export function ClaimLinkCorrection({ observation, editable }: { observation: ReportingClaim; editable: boolean }) {
  const [open, setOpen] = useState(false);
  const latest = observation.linkHistory?.at(-1);
  return <div className="mt-2 text-xs" data-testid={`link-correction-${observation.id}`}>
    {observation.linkExcluded && <p className="text-muted-foreground" data-testid={`text-historical-link-${observation.id}`}>Historical association — not counted as active coverage for this claim.</p>}
    {latest && <p className="text-muted-foreground">Analyst association correction: {latest.rationale}</p>}
    {editable && !open && <button type="button" className="mt-1 underline" onClick={() => setOpen(true)} data-testid={`button-correct-link-${observation.id}`}>Correct claim association</button>}
    {open && <LinkForm key={observation.id} observation={observation} onDone={() => setOpen(false)} />}
    {!!observation.linkHistory?.length && <details className="mt-1"><summary className="cursor-pointer">Association history</summary><ul className="mt-1 space-y-1">{observation.linkHistory.map(h => <li key={h.id}>{h.targetClaimId ? `Linked to claim ${h.targetClaimId}` : 'Excluded from active claim coverage'} · {h.rationale}</li>)}</ul></details>}
  </div>;
}

function LinkForm({ observation, onDone }: { observation: ReportingClaim; onDone: () => void }) {
  const { data } = useWorkspace();
  const claims = byKind(data?.records, 'claim');
  const latest = observation.linkHistory?.at(-1);
  const [baseCorrection] = useState(observation.linkCorrectionId ?? null);
  const changed = baseCorrection !== (observation.linkCorrectionId ?? null);
  const [target, setTarget] = useState(latest ? latest.targetClaimId ?? '' : observation.claimId);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const m = useCorrectClaimLink();
  const invalidate = useInvalidateClaims();
  const submit = async () => {
    setError('');
    try {
      await m.mutateAsync({ data: { observationId: observation.id, targetClaimId: target || null,
        supersedesId: baseCorrection, rationale: reason.trim(), requestId: newRequestId() } });
      await invalidate(); onDone();
    } catch (e) { setError(errText(e)); await invalidate(); }
  };
  return <div className="mt-2 space-y-2 rounded border border-border p-3" data-testid={`form-link-${observation.id}`}>
    <p className="text-muted-foreground">Changes only which claim this exact article passage supports. Original quotation, capture, offsets and previous associations remain available. Exclusion is not a judgment that the passage is false.</p>
    <label className="block">Current claim
      <select className="mt-1 w-full rounded border border-input bg-background p-2" value={target} onChange={e => setTarget(e.target.value)} data-testid="select-link-claim">
        <option value="">Exclude from active claim coverage</option>
        {claims.map(c => <option key={c.id} value={c.id}>{c.title}{c.id === observation.originalClaimId ? ' · original claim' : ''}</option>)}
      </select>
    </label>
    <label className="block">Reason<textarea className="mt-1 w-full rounded border border-input bg-background p-2" rows={2} maxLength={4000} value={reason} onChange={e => setReason(e.target.value)} data-testid="input-link-reason" /></label>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {changed && <p role="alert" className="text-destructive">This association changed elsewhere. Cancel and reopen to review the current link.</p>}
    <div className="flex justify-end gap-3"><button type="button" onClick={onDone} disabled={m.isPending}>Cancel</button>
      <button type="button" onClick={() => void submit()} disabled={m.isPending || changed || reason.trim().length < 5} className="rounded bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50" data-testid="button-save-link">{m.isPending ? 'Saving…' : 'Save association correction'}</button></div>
  </div>;
}
