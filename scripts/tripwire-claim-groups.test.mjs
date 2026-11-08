import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexClaimsByArticle,groupClaimsByArticle,matchesClaimFilter,compareClaims,pickDefault,groupKey,linkageAvailable,claimFilterCount,defaultClaimFeedFilter} from '../artifacts/tripwire/src/lib/claim-group-core.ts';

const S=[
 {claimId:'c1',attributions:2,firstDate:'2025-01-02',lastDate:'2025-03-01',categoryId:'leadership',topicId:'hegseth-miller',articleIds:['a1','a2']},
 {claimId:'c2',attributions:1,firstDate:'2025-02-01',lastDate:'2025-02-05',categoryId:'leadership',topicId:'hegseth-wiles',articleIds:['a3'],ongoing:true},
 {claimId:'c3',attributions:1,firstDate:null,lastDate:null,categoryId:'budget',topicId:'hegseth-miller',articleIds:['a4']},
 {claimId:'c4',attributions:0,firstDate:null,lastDate:null,categoryId:'leadership',topicId:'hegseth-miller',articleIds:[]},
];
const byId=new Map(S.map(s=>[s.claimId,s]));
const idx=indexClaimsByArticle(S);
const f=(o)=>({...defaultClaimFeedFilter(),...o});
const m=(a,o)=>matchesClaimFilter(a,f(o),idx,byId);

test('multiple topics OR together',()=>{
 const t=[groupKey(S[0]),groupKey(S[1])];
 assert.deepEqual(['a1','a3','a4','a5'].filter(a=>m(a,{topics:t})),['a1','a3']);
});
test('category and topic intersect on the same claim',()=>{
 assert.equal(m('a4',{categories:['leadership'],topics:[groupKey(S[2])]}),false);
 assert.equal(m('a1',{categories:['leadership'],topics:[groupKey(S[0])]}),true);
 assert.equal(m('a4',{categories:['budget'],topics:[groupKey(S[2])]}),true);
});
test('with/without modes',()=>{
 assert.equal(m('a1',{mode:'with'}),true);
 assert.equal(m('zz',{mode:'with'}),false);
 assert.equal(m('zz',{mode:'without'}),true);
 assert.equal(m('a1',{mode:'without'}),false);
 assert.equal(claimFilterCount(f({mode:'without'})),1);
});
test('no inferred links across shared topic',()=>{
 assert.deepEqual(idx.get('a1'),['c1']);
 assert.equal(idx.has('c4'),false);
 assert.equal([...idx.values()].flat().includes('c4'),false);
 assert.equal(linkageAvailable([{claimId:'x',attributions:0,firstDate:null,lastDate:null}]),false);
 assert.equal(linkageAvailable(S),true);
});
test('unknown dates sort last for newest and oldest; linked sort by count',()=>{
 const cl=S.map(s=>({id:s.claimId,title:s.claimId}));
 const sort=k=>[...cl].sort((a,b)=>compareClaims(a,b,k,byId)).map(c=>c.id);
 assert.deepEqual(sort('newest'),['c1','c2','c3','c4']);
 assert.deepEqual(sort('oldest'),['c1','c2','c3','c4']);
 assert.deepEqual(sort('linked'),['c1','c2','c3','c4']);
 assert.equal(pickDefault([cl[0],cl[1]],byId).id,'c2');
 assert.equal(pickDefault([cl[0]],byId).id,'c1');
});
test('many claims in one article count as one reporting article, not multiple reports',()=>{
 const claims=[{id:'one'},{id:'two'},{id:'three'}];
 const summaries=new Map(claims.map(c=>[c.id,{claimId:c.id,articleIds:['a','a'],attributions:7,firstDate:null,lastDate:null}]));
 const grouped=groupClaimsByArticle([...claims,claims[0]],summaries);
 assert.equal(grouped.articleCount,1);
 assert.deepEqual(grouped.articles[0].claims,claims);
 assert.equal(grouped.complete,true);
 assert.deepEqual(grouped.unattributed,[]);
});
test('shared claims remain under only their exact source articles, with a distinct article union',()=>{
 const claims=S.map(s=>({id:s.claimId}));
 const g=groupClaimsByArticle(claims,byId);
 assert.equal(g.articleCount,4);
 assert.deepEqual(g.articles.map(a=>[a.articleId,a.claims.map(c=>c.id)]),[
  ['a1',['c1']],['a2',['c1']],['a3',['c2']],['a4',['c3']],
 ]);
 assert.deepEqual(g.unattributed,[{id:'c4'}]);
 assert.equal(g.complete,true);
 // A category total is a union, not the sum of topic counts.
 const shared=new Map([['x',{claimId:'x',articleIds:['a1']}],['y',{claimId:'y',articleIds:['a1']}]]);
 assert.equal(groupClaimsByArticle([{id:'x'},{id:'y'}],shared).articleCount,1);
});
test('missing linkage is unknown rather than a fabricated article or a verified zero',()=>{
 const g=groupClaimsByArticle([{id:'x'},{id:'y'}],new Map([['x',{claimId:'x',attributions:5,articleIds:['a'] }]]));
 assert.equal(g.articleCount,1);
 assert.equal(g.complete,false);
 assert.deepEqual(g.unattributed,[{id:'y'}]);
 assert.equal(groupClaimsByArticle([],new Map()).complete,true);
});
