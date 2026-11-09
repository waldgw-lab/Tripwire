import { test as base, expect } from '@playwright/test';
import { fixtureData, staffing, policy } from './claims-fixture.mjs';

const focus = h => ({ categoryId:h.category, topicId:h.topic, topicTitle:h.title });
const original = id => focus(id.startsWith('staff-') ? staffing : policy);
export const test = base.extend({
  editorState: async ({},use) => use({ writes:[], ...fixtureData(), groups:{}, links:[], token:0 }),
  page: async ({ page,context,baseURL,editorState:s },use) => {
    const unexpected=[], errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const article = id => s.records.find(r=>r.id===id);
    const home = id => { const h=article(id).focusOverride??original(id); return s.groups[h.topicId]??h; };
    const members = id => s.records.filter(r=>r.kind==='article'&&r.id!=='unlinked'&&(r.focusOverride??original(r.id)).topicId===id);
    const detail = id => {
      const articles=members(id), h=articles[0]?.focusOverride??original(articles[0]?.id??'staff-new');
      return {effective:s.groups[id]??h,automatic:h,mode:s.groups[id]?'manual':'auto',token:String(s.token),
        count:articles.length,articles:articles.map(a=>({id:a.id,title:a.title})),history:s.history??[]};
    };
    const summaries = () => s.summaries.map(x=>{
      let ids=[...x.articleIds];
      if(s.links.length){
        ids=ids.filter(id=>id!=='policy');
        if(s.links.at(-1).targetClaimId===x.claimId)ids.push('policy');
      }
      const buckets=new Map();
      for(const id of ids){const h=home(id),key=`${h.categoryId}:${h.topicId}`,p=buckets.get(key)??{...h,primaryCategory:s.categories.find(c=>c.id===h.categoryId)?.label??h.categoryId,articleIds:[],ongoing:false};p.articleIds.push(id);buckets.set(key,p);}
      const placements=[...buckets.values()];
      return {...x,...placements[0],articleIds:ids,placements,attributions:ids.length};
    });
    const observation = () => ({
      id:'observation-policy',claimId:s.links.length?s.links.at(-1).targetClaimId??'shared':'shared',originalClaimId:'shared',
      linkCorrectionId:s.links.at(-1)?.id??null,linkHistory:s.links,familyId:'family-shared',proposition:'Congress is considering an investigation.',
      articleId:'policy',title:article('policy').title,outlet:'Reuters',url:'https://example.invalid/policy',supplied:false,
      sourceIds:[],reviews:[],excerpt:'A retained quotation that must never change.',start:0,end:43,captureId:'capture-policy',
      evidenceId:'evidence-policy',evidenceScope:'selected',direction:'unassessed',
    });
    await context.route('**/*',async route=>{
      const r=route.request(),u=new URL(r.url()),p=u.pathname;
      if(u.origin!==new URL(baseURL).origin)return route.abort();
      if(!p.startsWith('/api/'))return route.continue();
      const send=json=>route.fulfill({json});
      if(r.method()==='GET'){
        if(p==='/api/tripwire/workspace')return send({records:s.records,stats:{articles:4,claims:3,journalists:0,watches:0,flagged:0}});
        if(p==='/api/tripwire/claim-categories')return send(s.categories);
        if(p==='/api/tripwire/provenance/summaries')return send(summaries());
        if(p==='/api/tripwire/claims/processing')return send({pending:0,failed:0,recent:[],policy:'local'});
        if(p==='/api/tripwire/developments')return send({items:[],total:0,offset:0});
        if(p==='/api/tripwire/provenance'){
          const o=observation(),selected=u.searchParams.get('claimId'),latest=s.links.at(-1);
          return send({claims:selected&&selected!=='shared'&&selected!==o.claimId?[]:[{...o,linkExcluded:!s.links.at(-1)?.targetClaimId&&s.links.length>0||!!selected&&selected!==o.claimId}],
            sources:[],matches:[],context:[],counts:{articles:latest&&(latest.targetClaimId===null||selected&&selected!==latest.targetClaimId)?0:1,
              occurrences:0,historicalPassages:latest&&(latest.targetClaimId===null||selected&&selected!==latest.targetClaimId)?1:0,
              minimumAnonymousHumans:null,independentPaths:null},total:1,offset:0});
        }
        if(p==='/api/tripwire/focus-groups'){
          const q=(u.searchParams.get('q')??'').toLowerCase();
          return send({groups:[staffing,policy].map(h=>s.groups[h.topic]??focus(h)).filter(h=>h.topicTitle.toLowerCase().includes(q)),hasMore:false,offset:0});
        }
        const groupPage=p.match(/\/focus-groups\/([^/]+)\/articles$/);
        if(groupPage){
          const id=decodeURIComponent(groupPage[1]),d=detail(id),offset=Number(u.searchParams.get('offset')??0);
          return send({token:d.token,count:d.count,articles:d.articles.slice(offset,offset+50),offset,hasMore:offset+50<d.count});
        }
        if(p.startsWith('/api/tripwire/focus-groups/'))return send(detail(decodeURIComponent(p.split('/').at(-1))));
        const f=p.match(/\/records\/([^/]+)\/focus$/);
        if(f)return send({effective:home(f[1]),automatic:s.groups[original(f[1]).topicId]??original(f[1]),mode:article(f[1]).focusOverride?'manual':'auto',revision:article(f[1]).focusRevision??0,groups:[]});
      }
      if(r.method()==='GET'){unexpected.push(`GET ${p}`);return route.abort('blockedbyclient');}
      const body=r.postDataJSON();
      const batch=p.match(/\/focus-groups\/([^/]+)\/article-corrections$/);
      if(r.method()==='POST'&&batch){
        const id=decodeURIComponent(batch[1]);
        if(body.expectedToken!==String(s.token))return route.fulfill({status:409,json:{error:'Group changed; nothing saved'}});
        expect(body.articleIds.length).toBeGreaterThan(0);expect(body.articleIds.length).toBeLessThanOrEqual(100);
        expect(body.reason.trim().length).toBeGreaterThanOrEqual(5);
        expect(body.articleIds.every(a=>members(id).some(r=>r.id===a))).toBe(true);
        const dest=body.mode==='auto'?null:{categoryId:body.categoryId,topicId:body.topicId??'analyst-browser-batch',topicTitle:body.topicTitle};
        for(const articleId of body.articleIds){const a=article(articleId);a.focusOverride=dest;a.focusRevision=(a.focusRevision??0)+1;}
        s.token++;s.writes.push(p);return send({updated:body.articleIds.length,articleIds:body.articleIds,focus:dest});
      }
      const patch=p.match(/\/records\/([^/]+)\/focus$/);
      if(r.method()==='PATCH'&&patch){
        const a=article(patch[1]);
        expect(body.expectedRevision).toBe(a.focusRevision??0);
        a.focusOverride=body.mode==='auto'?null:{categoryId:body.categoryId,topicId:body.topicId??'analyst-browser',topicTitle:body.topicTitle};
        a.focusRevision=(a.focusRevision??0)+1;s.token++;s.writes.push(p);return send(a);
      }
      if(r.method()==='PATCH'&&p.startsWith('/api/tripwire/focus-groups/')){
        expect(body.confirmed).toBe(true);expect(body.expectedToken).toBe(String(s.token));expect(body.reason.length).toBeGreaterThanOrEqual(5);
        const id=decodeURIComponent(p.split('/').at(-1)),before=detail(id);
        s.groups[id]=body.mode==='auto'?null:{categoryId:body.categoryId,topicId:id,topicTitle:body.topicTitle};
        s.token++;s.history=[{id:String(s.token),timestamp:'2026-11-09T15:00:00Z',reason:body.reason,mode:body.mode,before:before.effective,after:detail(id).effective},...(s.history??[])];
        s.writes.push(p);return send(detail(id));
      }
      const claim=p.match(/\/claims\/([^/]+)\/correction$/);
      if(r.method()==='PATCH'&&claim){
        const c=article(claim[1]);expect(body.expectedRevision).toBe(c.claimRevision??0);expect(body.rationale.length).toBeGreaterThanOrEqual(5);
        Object.assign(c,body.record,{claimRevision:(c.claimRevision??0)+1});s.writes.push(p);return send(c);
      }
      if(r.method()==='POST'&&p==='/api/tripwire/provenance/link-corrections'){
        expect(body.supersedesId).toBe(s.links.at(-1)?.id??null);expect(body.rationale.length).toBeGreaterThanOrEqual(5);
        const correction={...body,id:`correction-${s.links.length+1}`,createdAt:'2026-11-09T15:00:00Z'};
        s.links.push(correction);s.writes.push(p);return send(correction);
      }
      unexpected.push(`${r.method()} ${p}`);return route.abort('blockedbyclient');
    });
    await use(page);
    expect(unexpected).toEqual([]);expect(errors).toEqual([]);
  },
});
export { expect, staffing, policy };
