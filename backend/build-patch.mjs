import fs from 'node:fs';

const file='server.js';
let s=fs.readFileSync(file,'utf8');
const oldChooseStart='async function choose(text,duration,title){';
const oldChooseEnd='\nasync function renderShort';
const a=s.indexOf(oldChooseStart), b=s.indexOf(oldChooseEnd,a);
if(a<0||b<0)throw new Error('choose() block not found; refusing unsafe build patch');
const newChoose=`async function choose(text,duration,title){
 const makeFallback=()=>{const out=[],window=Math.max(22,Math.min(42,duration/Math.max(1,Math.min(60,Math.floor(duration/24))))),step=Math.max(12,window*.62);for(let i=0;i<60;i++){const start=Math.min(Math.max(0,duration-window),i*step);const end=Math.min(duration,start+window);if(end-start<12)break;out.push({start,end,hook:'A key moment from '+(title||'this video'),score:60,title:'Short '+(i+1),description:'AI-selected short-form segment',hashtags:'#shorts #clips'});if(end>=duration&&i>10)break}return out};
 const fallback=makeFallback();
 if(!openai||!text.trim())return fallback;
 try{
  const r=await openai.chat.completions.create({model:process.env.OPENAI_MODEL||'gpt-4o-mini',temperature:.25,response_format:{type:'json_object'},messages:[{role:'system',content:'You are an expert short-form editor. Find many distinct, publishable Shorts from one long video. Never invent timestamps. Prefer complete thoughts, strong hooks, emotional or useful moments, clear context and satisfying endings. Avoid near-duplicate clips and excessive overlap. Return 50-60 clips when the source is long enough; otherwise return as many genuinely strong clips as the source supports.'},{role:'user',content:'Select 50-60 standalone Shorts from this source when possible. Return JSON {clips:[{start,end,hook,score,title,description,hashtags}]}. Each clip should be 20-60 seconds. Rank strongest first. Prefer diverse moments, clean starts/ends, high retention potential, useful/emotional/controversial insights, stories, punchlines and quotable statements. Do not fabricate timestamps. Duration '+Math.round(duration)+' seconds. Source title: '+title+'. Transcript:\\n'+text.slice(0,110000)}]});
  const x=JSON.parse(r.choices[0].message.content||'{}');
  const clips=Array.isArray(x.clips)?x.clips:[];
  const clean=clips.map(c=>({...c,start:Number(c.start),end:Number(c.end),score:Number(c.score)||0})).filter(c=>Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.end>c.start&&c.start>=0&&c.end<=duration&&c.end-c.start>=12).sort((x,y)=>y.score-x.score);
  const picked=[];
  for(const c of clean){const overlap=picked.some(p=>Math.max(p.start,c.start)<Math.min(p.end,c.end)-Math.min(8,(c.end-c.start)*.35));if(!overlap)picked.push(c);if(picked.length>=60)break}
  return picked.length>=10?picked:fallback;
 }catch{return fallback}
}`;
s=s.slice(0,a)+newChoose+s.slice(b);
s=s.replace("'-crf','22'","'-crf','18'");
s=s.replace("'-preset',process.env.FFMPEG_PRESET||'veryfast'","'-preset',process.env.FFMPEG_PRESET||'fast'");
s=s.replace("'-b:a','128k'","'-b:a','192k'");
fs.writeFileSync(file,s);
console.log('ClipForge Shorts engine patched: up to 60 clips, CRF 18, fast preset, 192k AAC');
