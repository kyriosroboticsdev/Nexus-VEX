// ─── STATE ────────────────────────────────────────────────────────────────────
const S={re:'',gid:'937251908005-hvco8m4dpidqiuo09er1tec3p14426au.apps.googleusercontent.com',gat:'',eid:null,ev:null,matches:[],rankings:[],teams:{},notes:{},sel:null,timer:null,divId:undefined,preScoutMode:false,preScoutDivisions:[]};
const ls=(k,v)=>{if(v!==undefined)localStorage.setItem(k,v);else return localStorage.getItem(k)||'';};
const init=()=>{
  S.re=ls('vs_re');
  S.gid='937251908005-hvco8m4dpidqiuo09er1tec3p14426au.apps.googleusercontent.com';
  if(typeof NEXUS_CONFIG!=='undefined'&&NEXUS_CONFIG.googleClientId) S.gid=NEXUS_CONFIG.googleClientId;
  S.notesKey='vs_n';
  try{const n=ls(S.notesKey);if(n)Object.assign(S.notes,JSON.parse(n));}catch{}
};
const sn2=()=>ls(S.notesKey||'vs_n',JSON.stringify(S.notes));
const nk=(m,t)=>`${m}_${t}`;
const gn=(m,t)=>S.notes[nk(m,t)]||null;
const setN=(m,t,d)=>{S.notes[nk(m,t)]=d;sn2();};

// ─── GOOGLE AUTH ──────────────────────────────────────────────────────────────
let currentUser=null;
function initGoogleAuth(){renderAuthBar(null);}
async function signInGoogle(){
  const evIn=document.getElementById('evIn');
  const sku=(evIn&&evIn.closest('#scoutPage')?.style.display!=='none')?evIn.value:'';
  if(sku)sessionStorage.setItem('nexus_restore_sku',sku);
  const p=new URLSearchParams({client_id:S.gid,redirect_uri:'https://vexscout.vercel.app/',response_type:'token',scope:'openid email profile',prompt:'select_account'});
  const authUrl='https://accounts.google.com/o/oauth2/v2/auth?'+p.toString();
  if(IS_ELECTRON&&window.electronAPI?.googleAuth){
    try{
      const token=await window.electronAPI.googleAuth(authUrl);
      await fetchGoogleUser(token);
      const saved=sessionStorage.getItem('nexus_restore_sku');
      if(saved){sessionStorage.removeItem('nexus_restore_sku');const inp=document.getElementById('evIn');if(inp){inp.value=saved;setTimeout(()=>loadEvent(),500);}}
    }catch(e){if(e.message!=='closed')setSt('Sign-in failed: '+e.message,'idle');}
    return;
  }
  window.location.href=authUrl;
}
async function checkAuthRedirect(){
  const hash=window.location.hash;
  if(!hash.includes('access_token'))return;
  const params=new URLSearchParams(hash.slice(1));
  const token=params.get('access_token');
  window.history.replaceState(null,'',window.location.pathname);
  if(token){
    await fetchGoogleUser(token);
    const saved=sessionStorage.getItem('nexus_restore_sku');
    if(saved){sessionStorage.removeItem('nexus_restore_sku');const inp=document.getElementById('evIn');if(inp){inp.value=saved;setTimeout(()=>loadEvent(),500);}}
  }
}
async function fetchGoogleUser(token){
  try{
    const res=await fetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:'Bearer '+token}});
    const u=await res.json();
    currentUser={uid:u.sub,displayName:u.name,email:u.email,photoURL:u.picture,accessToken:token};
    S.notesKey='vs_n_'+currentUser.uid;
    try{const n=ls(S.notesKey);if(n)Object.assign(S.notes,JSON.parse(n));}catch{}
    renderAuthBar(currentUser);
    setSt('Signed in as '+currentUser.displayName,'live');
  }catch(e){setSt('Could not fetch user info: '+e.message,'idle');}
}
function signOutGoogle(){currentUser=null;S.notesKey='vs_n';renderAuthBar(null);setSt('Signed out','idle');}
function renderAuthBar(user){
  const signedInHtml=user?`<img src="${user.photoURL||''}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'"/>
      <span style="font-size:12px;color:var(--t2);max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${user.displayName||user.email}</span>
      <button class="btn-o" style="font-size:11px;padding:3px 8px;" onclick="signOutGoogle()">Sign out</button>`
    :`<button class="btn-o" onclick="signInGoogle()" style="display:flex;align-items:center;gap:5px;font-size:12px;">
      <svg width="13" height="13" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
      Sign in with Google</button>`;
  document.querySelectorAll('.auth-area').forEach(el=>el.innerHTML=signedInHtml);
  // Push auth state to the notebook iframe if it's loaded
  const nbFrame=document.getElementById('notebookFrame');
  if(nbFrame?.contentWindow)nbFrame.contentWindow.postMessage({type:'auth-update',user:user?{displayName:user.displayName,email:user.email,photoURL:user.photoURL}:null},'*');
}

// ─── API ──────────────────────────────────────────────────────────────────────
const RE='https://www.robotevents.com/api/v2';
async function rg(path,p={},retries=3){
  const u=new URL(RE+path);
  Object.entries(p).forEach(([k,v])=>u.searchParams.append(k,v));
  for(let attempt=0;attempt<=retries;attempt++){
    try{
      const r=await fetch(u.toString(),{headers:{Authorization:`Bearer ${S.re}`,Accept:'application/json'}});
      if(r.status===429){await new Promise(res=>setTimeout(res,2000*(attempt+1)));continue;}
      if(!r.ok){let msg=`API error ${r.status}`;try{const j=await r.json();msg=j.message||msg;}catch{}throw new Error(msg);}
      return r.json();
    }catch(e){
      if(e.message.startsWith('API error'))throw e;
      if(attempt===retries)throw e;
      await new Promise(res=>setTimeout(res,1000*Math.pow(2,attempt)));
    }
  }
}
async function ra(path,p={}){
  let pg=1,all=[];
  while(true){
    const d=await rg(path,{...p,page:pg,per_page:250});
    all=all.concat(d.data||[]);
    if(!d.meta||pg>=d.meta.last_page)break;
    pg++;
  }
  return all;
}

// ─── LOAD EVENT ───────────────────────────────────────────────────────────────
function xSKU(raw){const m=raw.match(/RE-[A-Z0-9]+-\d{2,4}-\d+/i);return m?m[0].toUpperCase():raw.trim().toUpperCase();}
async function loadEvent(){
  if(!S.re){openSettings();return;}
  const raw=document.getElementById('evIn').value.trim();
  if(!raw){setSt('Paste a RobotEvents event URL or SKU','idle');return;}
  const sku=xSKU(raw);
  if(!sku.startsWith('RE-')){setSt('Could not find a valid SKU. Should look like RE-VRC-25-1234.','idle');return;}
  document.getElementById('ldBtn').disabled=true;
  setSt(`Looking up ${sku}…`,'load');
  try{
    const er=await rg('/events',{'sku[]':sku,per_page:1});
    if(!er.data?.length)throw new Error(`No event found for "${sku}".`);
    const ev=er.data[0];
    const divs=ev.divisions||[];
    S.eid=ev.id;S.ev=ev;S.divId=divs.length>0?divs[0].id:false;S.matches=[];S.rankings=[];S.teams={};S.preScoutMode=false;S.preScoutDivisions=[];
    document.getElementById('evNm').textContent=ev.name;
    document.getElementById('evMt').textContent=`${ev.location?.city||''}${ev.location?.region?', '+ev.location.region:''} · ${new Date(ev.start).toLocaleDateString()}`;
    setSt('Event found — loading matches…','load');
    await refreshMatches();
    await loadRankings();
    startPoll();
    if(!S.preScoutMode)setSt(`✓ ${S.matches.length} matches loaded`,'live');
  }catch(e){setSt('Error: '+e.message,'idle');}
  document.getElementById('ldBtn').disabled=false;
}
async function refreshMatches(){
  if(!S.eid)return;
  try{
    if(S.divId){S.matches=await ra(`/events/${S.eid}/divisions/${S.divId}/matches`);}
    else{
      S.matches=[];
      if(!S.preScoutMode)await loadPreScoutTeams();
      else renderPreScoutView();
      return;
    }
    const ids=new Set();
    S.matches.forEach(m=>(m.alliances||[]).forEach(a=>(a.teams||[]).forEach(t=>ids.add(t.team.id))));
    await pfTeams([...ids]);
    if(!S.matches.length){
      if(!S.preScoutMode)await loadPreScoutTeams();
      else renderPreScoutView();
      return;
    }
    if(S.preScoutMode)S.preScoutMode=false;
    renderMList();
    if(S.sel)renderScout(S.matches.find(m=>m.id===S.sel.id)||S.sel);
  }catch(e){setSt('Match load error: '+e.message,'idle');}
}
async function pfTeams(ids){
  for(const id of ids){
    if(!S.teams[id]){
      try{S.teams[id]=await rg(`/teams/${id}`);await new Promise(r=>setTimeout(r,300));}
      catch(e){S.teams[id]={number:'?',organization:'—'};}
    }
  }
}
const tn=id=>{if(S.teams[id]?.number)return S.teams[id].number;const rk=S.rankings.find(r=>Number(r.team?.id)===Number(id));return rk?.team?.name||'?';};
const to=id=>S.teams[id]?.organization||S.teams[id]?.team_name||'';
const rl=r=>r===2?'Q':r===3?'SF':r===4?'F':'M';

function renderMList(){
  const el=document.getElementById('mList');
  if(!S.matches.length){el.innerHTML='<div class="empty">No matches found</div>';return;}
  el.innerHTML=S.matches.map((m,i)=>{
    const red=(m.alliances||[]).find(a=>a.color==='red');
    const blue=(m.alliances||[]).find(a=>a.color==='blue');
    const allIds=[...(red?.teams||[]),...(blue?.teams||[])].map(t=>t.team.id);
    const sk=allIds.some(tid=>gn(m.id,tid));const ac=S.sel?.id===m.id;
    return`<div class="mi${ac?' active':''}${sk?' scouted':''}" onclick="selMatch(${i})">
      <div class="mi-top"><span class="mi-num">${rl(m.round)}${m.matchnum}</span>
        <span class="bx ${m.scored?'b-sc':'b-up'}">${m.scored?'SCORED':'UPCOMING'}</span>
        ${sk?'<span class="bx b-sk">✓</span>':''}
      </div>
      <div class="mi-teams">
        ${(red?.teams||[]).map(t=>`<span class="tt tt-r">${tn(t.team.id)}</span>`).join('')}
        <span class="vs">vs</span>
        ${(blue?.teams||[]).map(t=>`<span class="tt tt-b">${tn(t.team.id)}</span>`).join('')}
      </div>
      ${(m.scored||(red?.score!=null&&blue?.score!=null))?`<div class="mi-sc">${red?.score??'—'} – ${blue?.score??'—'}</div>`:''}
    </div>`;
  }).join('');
}
function selMatch(i){S.sel=S.matches[i];renderMList();renderScout(S.sel);activateScoreOverlay(S.sel);}

// ─── PRE-SCOUT (NO MATCHES YET) ───────────────────────────────────────────────
async function loadPreScoutTeams(){
  S.preScoutMode=true;
  setSt('No matches yet — loading team roster…','load');
  const divs=S.ev?.divisions||[];
  try{
    if(divs.length>1){
      S.preScoutDivisions=await Promise.all(divs.map(async d=>{
        const teams=await ra(`/events/${S.eid}/divisions/${d.id}/teams`,{per_page:250});
        return{id:d.id,name:d.name,teams};
      }));
    }else{
      const teams=await ra(`/events/${S.eid}/teams`,{per_page:250});
      S.preScoutDivisions=[{id:null,name:null,teams}];
    }
    S.preScoutDivisions.forEach(div=>div.teams.forEach(t=>{if(t.id&&!S.teams[t.id])S.teams[t.id]=t;}));
    const total=S.preScoutDivisions.reduce((n,d)=>n+d.teams.length,0);
    renderPreScoutView();
    setSt(`Pre-scouting — ${total} teams registered`,'live');
  }catch(e){setSt('Team roster error: '+e.message,'idle');}
}
function renderPreScoutView(){
  const hasDivs=S.preScoutDivisions.length>1;
  const sortT=ts=>[...ts].sort((a,b)=>(a.number||'').localeCompare(b.number||'',undefined,{numeric:true}));
  const mList=document.getElementById('mList');
  mList.innerHTML=S.preScoutDivisions.map(div=>`
    ${hasDivs?`<div class="ph" style="position:sticky;top:0;z-index:1;background:var(--s2);border-bottom:1px solid var(--b1);"><span class="ph-t" style="font-size:11px;">${div.name}</span><span style="font-size:10px;color:var(--t3);margin-left:6px;">${div.teams.length} teams</span></div>`:''}
    ${sortT(div.teams).map(t=>`<div class="mi" onclick="openTeamPage(${t.id})" style="cursor:pointer;">
      <div class="mi-top"><span class="mi-num">${t.number}</span><span class="bx" style="background:rgba(168,85,247,0.1);color:var(--gold);">PRE-SCOUT</span></div>
      <div style="font-size:12px;color:var(--t2);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.organization||t.team_name||''}</div>
    </div>`).join('')}
  `).join('');
  const rkList=document.getElementById('rkList');
  rkList.innerHTML=S.preScoutDivisions.map(div=>`
    ${hasDivs?`<div style="padding:7px 12px 4px;font-family:var(--fd);font-size:10px;font-weight:700;letter-spacing:0.13em;color:var(--t3);text-transform:uppercase;background:var(--s2);border-bottom:1px solid var(--b1);">${div.name}</div>`:''}
    ${sortT(div.teams).map(t=>`<div class="rr" onclick="openTeamPage(${t.id})" style="cursor:pointer;">
      <span class="rn" style="color:var(--t3);">—</span>
      <span class="rt2">${t.number}</span>
      <span style="font-size:11px;color:var(--t3);margin-left:auto;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${(t.organization||t.team_name||'').substring(0,18)}</span>
    </div>`).join('')}
  `).join('');
}

// ─── SCOUT PANEL ──────────────────────────────────────────────────────────────
function renderScout(m){
  const red=(m.alliances||[]).find(a=>a.color==='red');
  const blue=(m.alliances||[]).find(a=>a.color==='blue');
  const rt=red?.teams||[],bt=blue?.teams||[];
  const {rP,bP}=wProb(rt,bt);
  renderRankings(new Set([...rt,...bt].map(t=>t.team.id)));
  const lb=`${rl(m.round)}${m.matchnum}`;
  document.getElementById('sArea').innerHTML=`
    <div class="nt">📹 Paste the YouTube/Twitch URL above and click <strong>Load ▶</strong> to watch inline. Use <strong>🎯 Detect</strong> to auto-detect scores from the video.</div>
    <div class="mb">
      <div class="mb-s">${rt.map(t=>`<div class="mb-tn r">${tn(t.team.id)}</div><div class="mb-org">${to(t.team.id)}</div>`).join('')}</div>
      <div class="mb-mid"><div class="mb-lbl">${lb}</div><div class="mb-sc">${red?.score??'—'} : ${blue?.score??'—'}</div></div>
      <div class="mb-s rt">${bt.map(t=>`<div class="mb-tn b">${tn(t.team.id)}</div><div class="mb-org">${to(t.team.id)}</div>`).join('')}</div>
    </div>
    <div class="pw">
      <div class="ph2"><span class="pl2">Win Prediction</span><span style="font-size:11px;color:var(--t3);">From event W/L record</span></div>
      <div class="pn"><span class="pr2">${rt.map(t=>tn(t.team.id)).join('+')} ${rP}%</span><span class="pb2">${bP}% ${bt.map(t=>tn(t.team.id)).join('+')}</span></div>
      <div class="pt"><div class="pf" style="width:${rP}%;background:linear-gradient(to right,var(--red),#d06060);"></div></div>
    </div>
    <div class="tr">${[...rt.map(t=>({t,c:'red'})),...bt.map(t=>({t,c:'blue'}))].map(({t,c})=>mkTcard(t.team.id,c)).join('')}</div>
    ${[...rt.map(t=>({t,c:'red'})),...bt.map(t=>({t,c:'blue'}))].map(({t,c})=>mkForm(m.id,t.team.id,c)).join('')}
  `;
  [...rt,...bt].forEach(t=>restoreForm(m.id,t.team.id));
}
function mkTcard(tid,color){
  const rk=S.rankings.find(r=>r.team?.id===tid);
  const wp=rk?`${rk.wins}-${rk.losses}-${rk.ties}`:'—';
  return`<div class="tc ${color}"><div class="tc-top"><div><div class="tc-n ${color}">${tn(tid)}</div><div class="tc-o">${to(tid)}</div></div><span class="rkb">R#${rk?.rank??'?'}</span></div>
    <div class="tc-st"><div class="st"><div class="stl">W/L/T</div><div class="stv">${wp}</div></div><div class="st"><div class="stl">AP</div><div class="stv">${rk?.ap??'—'}</div></div><div class="st"><div class="stl">SP</div><div class="stv">${rk?.sp??'—'}</div></div><div class="st"><div class="stl">Rank</div><div class="stv">#${rk?.rank??'?'}</div></div></div></div>`;
}
function mkForm(mid,tid,color){
  const num=tn(tid),p=`f_${mid}_${tid}`,cc=color==='red'?'#ff6b65':'#6ab3ff';
  return`<div class="sf"><div class="sf-t">Scouting: <span style="color:${cc}">${num}</span></div>
    <div class="sr"><div><div class="sl">Autonomous</div><div class="ss">Routine quality & points</div></div><div class="stars" id="${p}_a" data-val="0">${mkS(p+'_a')}</div></div>
    <div class="sr"><div><div class="sl">Driver Skill</div><div class="ss">Control, speed, precision</div></div><div class="stars" id="${p}_d" data-val="0">${mkS(p+'_d')}</div></div>
    <div class="sr"><div><div class="sl">Alliance Coordination</div><div class="ss">Teamwork with partner</div></div><div class="stars" id="${p}_c" data-val="0">${mkS(p+'_c')}</div></div>
    <div class="sr"><div class="sl">Played Defense</div><div style="display:flex;align-items:center;gap:7px;"><input type="checkbox" class="cb" id="${p}_df"/><label style="font-size:13px;cursor:pointer;" for="${p}_df">Yes</label></div></div>
    <div class="sr"><div class="sl">Consistency</div><select class="sels" id="${p}_cn"><option value="">— select —</option><option>Very consistent</option><option>Mostly consistent</option><option>Some errors</option><option>Frequent errors / penalties</option></select></div>
    <div style="margin-bottom:9px;"><div class="sl" style="margin-bottom:4px;">Observations</div><textarea class="txta" id="${p}_nt" placeholder="Strategy, robot type, weak points…"></textarea></div>
    <div><div class="sl" style="margin-bottom:5px;">Your Rating</div><div class="mr"><span class="mrn" id="${p}_rl">5</span><input type="range" min="1" max="10" value="5" step="1" id="${p}_rv" oninput="document.getElementById('${p}_rl').textContent=this.value"/><span style="font-size:11px;color:var(--t3);">/ 10</span></div></div>
    <div class="fa"><button class="btn-g" onclick="saveOnly('${mid}','${tid}')">Save Notes</button></div></div>`;
}
const mkS=g=>[1,2,3,4,5].map(n=>`<span class="star" onclick="setStar('${g}',${n})">★</span>`).join('');
function setStar(g,n){const el=document.getElementById(g);if(!el)return;el.dataset.val=n;el.querySelectorAll('.star').forEach((s,i)=>s.classList.toggle('on',i<n));}
const gStar=g=>{const el=document.getElementById(g);return el?parseInt(el.dataset.val||0):0;};
function restoreForm(mid,tid){
  const note=gn(mid,tid);if(!note)return;const p=`f_${mid}_${tid}`;
  setStar(`${p}_a`,note.auto||0);setStar(`${p}_d`,note.driver||0);setStar(`${p}_c`,note.coord||0);
  const df=document.getElementById(`${p}_df`);if(df)df.checked=note.defense||false;
  const cn=document.getElementById(`${p}_cn`);if(cn)cn.value=note.consistency||'';
  const nt=document.getElementById(`${p}_nt`);if(nt)nt.value=note.notes||'';
  const rv=document.getElementById(`${p}_rv`);const rl2=document.getElementById(`${p}_rl`);
  if(rv){rv.value=note.myRating||5;if(rl2)rl2.textContent=rv.value;}
}
function readForm(mid,tid){
  const p=`f_${mid}_${tid}`;
  return{matchId:mid,teamId:tid,teamNum:tn(tid),auto:gStar(`${p}_a`),driver:gStar(`${p}_d`),coord:gStar(`${p}_c`),
    defense:document.getElementById(`${p}_df`)?.checked||false,
    consistency:document.getElementById(`${p}_cn`)?.value||'',
    notes:document.getElementById(`${p}_nt`)?.value||'',
    myRating:parseInt(document.getElementById(`${p}_rv`)?.value||5),
    savedAt:new Date().toISOString()};
}
function saveOnly(mid,tid){const d=readForm(mid,tid);setN(mid,tid,{...gn(mid,tid)||{},...d});renderMList();setSt(`Saved notes for ${tn(tid)}`,'live');}

// ─── WIN PROBABILITY ──────────────────────────────────────────────────────────
function wProb(rt,bt){
  const s=ts=>{let t=0,n=0;for(const x of ts){const r=S.rankings.find(r=>r.team?.id===x.team.id);if(r){const tot=(r.wins||0)+(r.losses||0)+(r.ties||0);t+=tot>0?(r.wins+0.5*r.ties)/tot:0.5;n++;}}return n>0?t/n:0.5;};
  const rs=s(rt),bs=s(bt),sum=rs+bs||1;
  const rP=Math.max(5,Math.min(95,Math.round(50+(rs/sum-0.5)*70)));
  return{rP,bP:100-rP};
}

// ─── RANKINGS ─────────────────────────────────────────────────────────────────
async function loadRankings(){
  if(!S.eid||!S.divId)return;
  try{S.rankings=await ra(`/events/${S.eid}/divisions/${S.divId}/rankings`);renderRankings(new Set());}
  catch(e){console.warn('Rankings error:',e.message);}
}
function renderRankings(hl){
  const el=document.getElementById('rkList');
  if(!S.rankings.length){el.innerHTML='<div class="empty" style="padding:12px;">Rankings not available</div>';return;}
  el.innerHTML=S.rankings.map(r=>`
    <div class="rr${hl.has(r.team?.id)?' hl':''}" onclick="openTeamPage(${r.team?.id})" style="cursor:pointer;">
      <span class="rn">${r.rank}</span>
      <span class="rt2">${r.team?.name||'?'}</span>
      <span class="rw">${r.wins}-${r.losses}-${r.ties}</span>
    </div>`).join('');
}

// ─── ELECTRON DETECTION ───────────────────────────────────────────────────────
const IS_ELECTRON=!!(window.electronAPI?.isElectron);

// ─── EXPORT ───────────────────────────────────────────────────────────────────
function exportXLSX(){
  const wb=XLSX.utils.book_new();
  const aR=[['Match','Team','Alliance','Auto★','Driver★','Coord★','Defense','Consistency','My Rating','Notes','Saved']];
  S.matches.forEach(m=>{
    const lb=`${rl(m.round)}${m.matchnum}`;
    (m.alliances||[]).forEach(a=>(a.teams||[]).forEach(t=>{
      const note=gn(m.id,t.team.id);
      if(note)aR.push([lb,tn(t.team.id),a.color,note.auto,note.driver,note.coord,note.defense?'Yes':'',note.consistency,note.myRating,note.notes||'',note.savedAt||'']);
    }));
  });
  const mws=XLSX.utils.aoa_to_sheet(aR);
  XLSX.utils.book_append_sheet(wb,mws,'All Matches');
  XLSX.writeFile(wb,`VEXScout_${(S.ev?.name||'Event').replace(/[^a-zA-Z0-9_\-]/g,'_').substring(0,40)}.xlsx`);
  setSt('Downloaded .xlsx','live');
}
async function exportSheets(){
  if(!S.gid){alert('Download the .xlsx file, then import it into Google Sheets.');return;}
  const scope='https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';
  const au=new URLSearchParams({client_id:S.gid,redirect_uri:'https://vexscout.vercel.app/',response_type:'token',scope,prompt:'select_account'});
  const authUrl='https://accounts.google.com/o/oauth2/v2/auth?'+au.toString();
  try{
    const token=IS_ELECTRON&&window.electronAPI?.googleAuth
      ?await window.electronAPI.googleAuth(authUrl)
      :await new Promise((res,rej)=>{
          const aw=window.open(authUrl,'gauth',`width=500,height=600,left=${(screen.width-500)/2},top=${(screen.height-600)/2}`);
          const poll=setInterval(()=>{try{const h=aw?.location?.hash||'';if(h.includes('access_token')){const p=new URLSearchParams(h.slice(1));clearInterval(poll);aw.close();res(p.get('access_token'));}}catch{}if(aw?.closed){clearInterval(poll);rej(new Error('closed'));}},500);
        });
    S.gat=token;
    doSync();
  }catch(e){if(e.message!=='closed')setSt('Sheets auth failed: '+e.message,'idle');}
}
async function doSync(){
  setSt('Creating Google Sheet…','load');
  try{
    const cr=await fetch('https://sheets.googleapis.com/v4/spreadsheets',{method:'POST',headers:{Authorization:`Bearer ${S.gat}`,'Content-Type':'application/json'},body:JSON.stringify({properties:{title:`VEXScout — ${S.ev?.name||'Event'}`},sheets:[{properties:{title:'All Matches'}}]})});
    const sh=await cr.json();const sid=sh.spreadsheetId;
    const rows=[['Match','Team','Alliance','Auto','Driver','Coord','Defense','Consistency','My Rating','Notes']];
    S.matches.forEach(m=>{const lb=`${rl(m.round)}${m.matchnum}`;(m.alliances||[]).forEach(a=>(a.teams||[]).forEach(t=>{const note=gn(m.id,t.team.id);if(!note)return;rows.push([lb,tn(t.team.id),a.color,note.auto,note.driver,note.coord,note.defense?'Yes':'',note.consistency,note.myRating,note.notes||'']);}));});
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/All%20Matches!A1:Z${rows.length}?valueInputOption=RAW`,{method:'PUT',headers:{Authorization:`Bearer ${S.gat}`,'Content-Type':'application/json'},body:JSON.stringify({values:rows})});
    setSt('Synced!','live');window.open(`https://docs.google.com/spreadsheets/d/${sid}`,'_blank');
  }catch(e){setSt('Sheets error: '+e.message,'idle');}
}


// ─── POLL ─────────────────────────────────────────────────────────────────────
function startPoll(){
  if(S.timer)clearInterval(S.timer);
  let polling=false;
  S.timer=setInterval(async()=>{
    if(polling)return;polling=true;
    try{await refreshMatches();await loadRankings();setSt(`Updated ${new Date().toLocaleTimeString()}`,'live');}
    catch(e){console.warn('Poll error:',e.message);}
    finally{polling=false;}
  },45000);
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function setSt(msg,state){document.getElementById('stxt').textContent=msg;const d=document.getElementById('sd');d.className='sdot '+(state==='live'?'sdot-live':state==='load'?'sdot-load':'');}


// ─── MATCH JUMP ───────────────────────────────────────────────────────────────
function jumpToMatch(query){
  if(!query||query.length<2)return;
  const q=query.trim().toUpperCase();
  const idx=S.matches.findIndex(m=>`${rl(m.round)}${m.matchnum}`.toUpperCase().startsWith(q));
  const inp=document.getElementById('matchJumpInput');
  if(idx>-1){selMatch(idx);document.querySelectorAll('.mi')[idx]?.scrollIntoView({behavior:'smooth',block:'center'});if(inp)inp.style.borderColor='var(--green)';setTimeout(()=>{if(inp)inp.style.borderColor='var(--b2)';},1200);}
  else{if(inp){inp.style.borderColor='var(--red)';setTimeout(()=>inp.style.borderColor='var(--b2)',1000);}}
}

function hpSaveToken(val) {
  val = val.trim();
  S.re = val;
  ls('vs_re', val);
  AN.loaded = false;
  const status = document.getElementById('hpReStatus');
  const input  = document.getElementById('hpReToken');
  if (status) status.textContent = val ? `Token active (${val.length} chars)` : 'Required for all API features';
  if (input)  input.style.borderColor = val.length > 20 ? 'var(--green)' : 'var(--b2)';
  // Keep settings modal in sync
  const si = document.getElementById('settingsReToken');
  if (si) { si.value = val; si.style.borderColor = input?.style.borderColor || ''; }
}
function hpSaveTeam(val) {
  val = val.trim().toUpperCase();
  const oldTeam = ls('vs_myteam');
  ls('vs_myteam', val);
  AN.loaded = false;
  const input = document.getElementById('hpMyTeam');
  if (input) input.style.borderColor = val.length > 1 ? 'var(--green)' : 'var(--b2)';
  const si = document.getElementById('settingsMyTeam');
  if (si) { si.value = val; si.style.borderColor = input?.style.borderColor || ''; }
  // Sync to notebook: update stored config and push to iframe if loaded
  try {
    const nbData = JSON.parse(localStorage.getItem('nexus_nb') || '{}');
    if (!nbData.config) nbData.config = {};
    if (!nbData.config.team || nbData.config.team === oldTeam)
      nbData.config.team = val;
    localStorage.setItem('nexus_nb', JSON.stringify(nbData));
  } catch {}
  const nbFrame = document.getElementById('notebookFrame');
  if (nbFrame?.contentWindow) nbFrame.contentWindow.postMessage({ type: 'team-update', team: val }, '*');
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function openSettings(){
  const modal=document.getElementById('settingsModal');
  const reInput=document.getElementById('settingsReToken'),reStatus=document.getElementById('settingsReStatus'),googleEl=document.getElementById('settingsGoogleStatus');
  if(reInput){reInput.value=S.re||'';reInput.style.borderColor=S.re?'var(--green)':'var(--b2)';}
  if(reStatus)reStatus.textContent=S.re?`Token active (${S.re.length} chars)`:'No token set.';
  if(googleEl)googleEl.textContent=currentUser?`Signed in as ${currentUser.displayName}`:'Not signed in';
  const myTeamEl=document.getElementById('settingsMyTeam');
  if(myTeamEl){myTeamEl.value=ls('vs_myteam')||'';myTeamEl.style.borderColor=myTeamEl.value.trim().length>1?'var(--green)':'var(--b2)';}
  if(modal)modal.classList.add('open');
}
function closeSettings(){document.getElementById('settingsModal')?.classList.remove('open');}
function saveSettings(){
  const inp=document.getElementById('settingsReToken');
  if(inp?.value.trim()){S.re=inp.value.trim();ls('vs_re',S.re);}
  const myTeamEl=document.getElementById('settingsMyTeam');
  if(myTeamEl?.value.trim()){ls('vs_myteam',myTeamEl.value.trim().toUpperCase());AN.loaded=false;}
  // Sync homepage inputs
  const hpRe=document.getElementById('hpReToken');
  if(hpRe){hpRe.value=S.re;hpRe.style.borderColor=S.re?'var(--green)':'var(--b2)';}
  const hpTeam=document.getElementById('hpMyTeam');
  if(hpTeam){hpTeam.value=ls('vs_myteam');hpTeam.style.borderColor=ls('vs_myteam')?'var(--green)':'var(--b2)';}
  const hpStatus=document.getElementById('hpReStatus');
  if(hpStatus)hpStatus.textContent=S.re?`Token active (${S.re.length} chars)`:'Required for all API features';
  setTimeout(closeSettings,200);setSt('Settings saved','live');
}
document.addEventListener('click',e=>{const m=document.getElementById('settingsModal');if(m&&e.target===m)closeSettings();});

// ─── TEAM PAGE ────────────────────────────────────────────────────────────────
let tpCharts=[],currentTeamId=null;
async function openTeamPage(teamId){
  if(!teamId)return;currentTeamId=teamId;
  document.getElementById('teamPage').classList.add('open');
  document.getElementById('tpMain').innerHTML='<div class="empty" style="margin-top:60px;"><p>Loading…</p></div>';
  if(!S.teams[teamId]){try{S.teams[teamId]=await rg(`/teams/${teamId}`);}catch(e){const rk=S.rankings.find(r=>r.team?.id===teamId);S.teams[teamId]={id:teamId,number:rk?.team?.name||'?',organization:''};}}
  renderTeamPage(teamId);
}
function closeTeamPage(){document.getElementById('teamPage').classList.remove('open');tpCharts.forEach(c=>{try{c.destroy();}catch{}});tpCharts=[];currentTeamId=null;}
function openScoutPage() {
  const p = document.getElementById('scoutPage');
  if (p) p.style.display = 'flex';
  renderAuthBar(currentUser); // re-sync auth state in topbar
}
function closeScoutPage() {
  const p = document.getElementById('scoutPage');
  if (p) p.style.display = 'none';
  const hp = document.getElementById('homePage');
  if (hp) hp.style.display = 'flex';
}
function goHome() {
  closeScoutPage();
  closeAnalysis();
  closeNotebook();
  closeSTLViewer();
  closeSimulator();
  const hp = document.getElementById('homePage');
  if (hp) hp.style.display = 'flex';
}
function enterApp(section) {
  const hp = document.getElementById('homePage');
  if (hp) hp.style.display = 'none';
  if (section === 'scout')          openScoutPage();
  else if (section === 'analysis')  openAnalysis();
  else if (section === 'notebook')  openNotebook();
  else if (section === 'cad')       openSTLViewer();
  else if (section === 'simulator') openSimulator();
  else if (section === 'ide')       openIDE();
}
function openNotebook(){const p=document.getElementById('notebookPage'),f=document.getElementById('notebookFrame');if(!f.src)f.src='notebook.html';p.style.display='flex';}
function closeNotebook(){document.getElementById('notebookPage').style.display='none';const hp=document.getElementById('homePage');if(hp)hp.style.display='flex';}
function navigateTo(section) {
  if (section !== 'notebook') closeNotebook();
  closeSTLViewer();
  closeSimulator();
  closeAnalysis();
  if (typeof closeIDE === 'function') closeIDE();
  if (section === 'scout')          openScoutPage();
  else if (section === 'notebook')  openNotebook();
  else if (section === 'cad')       openSTLViewer();
  else if (section === 'simulator') openSimulator();
  else if (section === 'analysis')  openAnalysis();
  else if (section === 'ide')       openIDE();
}
function renderTeamPage(teamId){
  const rank=S.rankings.find(r=>Number(r.team?.id)===Number(teamId));
  seasonDataLoaded=false;activeTab='event';
  document.getElementById('tpEventTab').style.display='grid';document.getElementById('tpSeasonTab').style.display='none';
  document.getElementById('tabEvent').classList.add('active');document.getElementById('tabSeason').classList.remove('active');
  document.getElementById('tabSeasonBadge').textContent='—';
  document.getElementById('tpTeamNum').textContent=tn(teamId);
  document.getElementById('tpTeamOrg').textContent=to(teamId);
  const teamMatches=getTeamMatches(teamId);
  document.getElementById('tabEventBadge').textContent=`${teamMatches.filter(tm=>tm.scored).length} matches`;
  renderTPMain(teamId,teamMatches,rank);renderTPSide(teamId,teamMatches,rank);
  setTimeout(()=>restoreCVData(teamId),100);
}
function getTeamMatches(teamId){
  const tid=Number(teamId);
  return S.matches.filter(m=>(m.alliances||[]).some(a=>(a.teams||[]).some(t=>Number(t.team.id)===tid))).map(m=>{
    const myA=(m.alliances||[]).find(a=>(a.teams||[]).some(t=>Number(t.team.id)===tid));
    const oppA=(m.alliances||[]).find(a=>!(a.teams||[]).some(t=>Number(t.team.id)===tid));
    const ms=myA?.score!=null?Number(myA.score):null,os=oppA?.score!=null?Number(oppA.score):null;
    const scored=(ms!==null&&os!==null)||m.scored;
    const result=!scored?'—':ms>os?'W':ms<os?'L':'T';
    const partner=(myA?.teams||[]).find(t=>Number(t.team.id)!==tid);
    return{m,lbl:`${rl(m.round)}${m.matchnum}`,myScore:ms,oppScore:os,result,scored,myColor:myA?.color,partner,note:gn(m.id,Number(teamId))};
  });
}
function getScoredMatches(teamId){return getTeamMatches(teamId).filter(tm=>tm.scored);}
function computeMMR(teamId,matches){
  let mmr=1000;const history=[];
  matches.forEach(({myScore,oppScore,result})=>{
    const margin=Math.abs(myScore-oppScore),bonus=Math.min(20,Math.floor(margin/5));
    if(result==='W')mmr+=30+bonus;else if(result==='L')mmr-=25-Math.min(10,bonus);
    history.push(mmr);
  });
  return{mmr:Math.round(mmr),history};
}
function computeConsistency(scores){
  if(scores.length<2)return 100;
  const avg=scores.reduce((a,b)=>a+b,0)/scores.length;
  const stddev=Math.sqrt(scores.reduce((a,b)=>a+Math.pow(b-avg,2),0)/scores.length);
  return Math.max(0,Math.round(100-(stddev/Math.max(avg,1))*100));
}
function computeTrend(scores){
  if(scores.length<3)return{label:'Insufficient data',dir:0};
  const half=Math.floor(scores.length/2);
  const f=scores.slice(0,half).reduce((a,b)=>a+b,0)/half,s=scores.slice(-half).reduce((a,b)=>a+b,0)/half,delta=s-f;
  if(delta>5)return{label:'↑ Improving',dir:1,delta:Math.round(delta)};
  if(delta<-5)return{label:'↓ Declining',dir:-1,delta:Math.round(Math.abs(delta))};
  return{label:'→ Stable',dir:0,delta:0};
}
function renderTPMain(teamId,teamMatches,rank){
  const main=document.getElementById('tpMain');
  tpCharts.forEach(c=>{try{c.destroy();}catch{}});tpCharts=[];
  const scoredMatches=getScoredMatches(teamId);
  if(!teamMatches.length){
    main.innerHTML=`<div class="empty" style="margin-top:60px;"><p>No event matches found.</p>${S.preScoutMode?'<p style="margin-top:8px;font-size:12px;color:var(--t3);">Pre-scouting mode — loading season history…</p>':''}</div>`;
    if(S.preScoutMode&&!seasonDataLoaded)setTimeout(()=>switchTab('season'),80);
    return;
  }
  const scores=scoredMatches.map(tm=>tm.myScore),oppScores=scoredMatches.map(tm=>tm.oppScore),labels=scoredMatches.map(tm=>tm.lbl);
  const wins=scoredMatches.filter(tm=>tm.result==='W').length,losses=scoredMatches.filter(tm=>tm.result==='L').length,ties=scoredMatches.filter(tm=>tm.result==='T').length;
  const avgScore=scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):0;
  const peakScore=scores.length?Math.max(...scores):0,peakMatch=scoredMatches[scores.indexOf(peakScore)];
  const consistency=computeConsistency(scores),trend=computeTrend(scores),{mmr}=computeMMR(teamId,scoredMatches);
  const trendColor=trend.dir>0?'#22c55e':trend.dir<0?'#ff7b77':'var(--t2)';
  main.innerHTML=`
    <div class="tp-stats">
      <div class="tp-stat"><div class="tp-stat-lbl">Record</div><div class="tp-stat-val" style="color:#22c55e;">${wins}W</div><div class="tp-stat-sub">${losses}L · ${ties}T</div></div>
      <div class="tp-stat"><div class="tp-stat-lbl">Avg Score</div><div class="tp-stat-val" style="color:var(--gold);">${avgScore}</div><div class="tp-stat-sub">Peak: ${peakScore} (${peakMatch?.lbl||'—'})</div></div>
      <div class="tp-stat"><div class="tp-stat-lbl">Consistency</div><div class="tp-stat-val">${consistency}</div><div class="tp-stat-sub">out of 100</div></div>
      <div class="tp-stat"><div class="tp-stat-lbl">Performance</div><div class="tp-stat-val" style="color:${trendColor};font-size:18px;">${trend.label}</div><div class="tp-stat-sub">${trend.delta?(trend.dir>0?'+':'-')+trend.delta+' pts':''}</div></div>
    </div>
    <div class="tp-card"><div class="tp-card-title">Score Progression</div><div class="tp-chart-wrap"><canvas id="chartScores"></canvas></div></div>
    <div class="tp-card"><div class="tp-card-title">Performance Rating (MMR)<span style="font-size:11px;color:var(--t3);font-weight:400;font-family:var(--fb);">Starts at 1000</span></div>
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:10px;"><div><div class="tp-stat-lbl">Current MMR</div><div class="tp-stat-val" style="color:var(--gold);font-size:32px;">${mmr}</div></div><div style="flex:1;height:60px;position:relative;"><canvas id="chartMMR"></canvas></div></div></div>
    <div class="tp-card"><div class="tp-card-title">Win / Loss Streak</div><div class="momentum-row">${teamMatches.map(tm=>`<div class="mom-block mom-${tm.result.toLowerCase()}" title="${tm.lbl}: ${tm.result}">${tm.result}</div>`).join('')}</div></div>
    <div class="tp-card"><div class="tp-card-title">Ranking Points</div><div class="tp-chart-wrap" style="height:140px;"><canvas id="chartRP"></canvas></div></div>`;
  const cd={responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{backgroundColor:'#1c1c22',titleColor:'#eeeef4',bodyColor:'#8888a0',borderColor:'rgba(255,255,255,0.1)',borderWidth:1}},scales:{x:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#48485a',font:{size:11}}},y:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#48485a',font:{size:11}}}}};
  requestAnimationFrame(()=>{
    const ctxS=document.getElementById('chartScores')?.getContext('2d');
    if(ctxS)tpCharts.push(new Chart(ctxS,{type:'line',data:{labels,datasets:[{label:'My Score',data:scores,borderColor:'#a855f7',backgroundColor:'rgba(168,85,247,0.08)',tension:0.3,pointRadius:4,pointBackgroundColor:'#a855f7'},{label:'Opp',data:oppScores,borderColor:'rgba(255,255,255,0.15)',backgroundColor:'transparent',tension:0.3,pointRadius:3,borderDash:[4,4]}]},options:{...cd,plugins:{...cd.plugins,legend:{display:true,labels:{color:'#8888a0',font:{size:11}}}}}}));
    const {history:mmrH}=computeMMR(teamId,scoredMatches);
    const ctxM=document.getElementById('chartMMR')?.getContext('2d');
    if(ctxM)tpCharts.push(new Chart(ctxM,{type:'line',data:{labels,datasets:[{data:mmrH,borderColor:'#a855f7',backgroundColor:'rgba(168,85,247,0.1)',tension:0.4,pointRadius:0,fill:true}]},options:{...cd,scales:{x:{display:false},y:{display:false}},plugins:{legend:{display:false},tooltip:{enabled:false}}}}));
    let rpAcc=0;const rpData=teamMatches.map(tm=>{rpAcc+=tm.result==='W'?2:tm.result==='T'?1:0;return rpAcc;});
    const ctxRP=document.getElementById('chartRP')?.getContext('2d');
    if(ctxRP)tpCharts.push(new Chart(ctxRP,{type:'bar',data:{labels,datasets:[{data:rpData,backgroundColor:teamMatches.map(tm=>tm.result==='W'?'rgba(34,197,94,0.6)':tm.result==='L'?'rgba(232,48,42,0.4)':'rgba(136,136,160,0.3)'),borderRadius:3}]},options:{...cd,scales:{x:cd.scales.x,y:{...cd.scales.y,beginAtZero:true}}}}));
  });
}
function renderTPSide(teamId,teamMatches,rank){
  const side=document.getElementById('tpSide');
  const partnerMap={};
  teamMatches.forEach(tm=>{if(!tm.partner)return;const pid=tm.partner.team.id;if(!partnerMap[pid])partnerMap[pid]={wins:0,losses:0,ties:0,id:pid};if(tm.result==='W')partnerMap[pid].wins++;else if(tm.result==='L')partnerMap[pid].losses++;else partnerMap[pid].ties++;});
  const partners=Object.values(partnerMap).sort((a,b)=>b.wins-a.wins);
  side.innerHTML=`
    <div style="margin-bottom:14px;"><div class="ph-t" style="margin-bottom:8px;">Event Standing</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
        <div class="tp-stat"><div class="tp-stat-lbl">Rank</div><div class="tp-stat-val" style="color:var(--gold);">#${rank?.rank??'?'}</div></div>
        <div class="tp-stat"><div class="tp-stat-lbl">WP</div><div class="tp-stat-val">${rank?.wp??'—'}</div></div>
        <div class="tp-stat"><div class="tp-stat-lbl">AP</div><div class="tp-stat-val">${rank?.ap??'—'}</div></div>
        <div class="tp-stat"><div class="tp-stat-lbl">SP</div><div class="tp-stat-val">${rank?.sp??'—'}</div></div>
      </div></div>
    <div style="margin-bottom:14px;"><div class="ph-t" style="margin-bottom:8px;">Alliance Partners</div>
      ${partners.length?partners.map(p=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;background:var(--s2);border-radius:var(--r);margin-bottom:4px;cursor:pointer;" onclick="openTeamPage(${p.id})"><span style="font-family:var(--fm);font-size:12px;font-weight:600;">${tn(p.id)}</span><span style="font-size:11px;color:${p.wins>p.losses?'#22c55e':p.wins<p.losses?'#ff7b77':'var(--t2)'};">${p.wins}W-${p.losses}L-${p.ties}T</span></div>`).join(''):'<div class="empty" style="padding:10px;">No partner data</div>'}
    </div>
    <div><div class="ph-t" style="margin-bottom:8px;">Match History</div>
      ${teamMatches.map(tm=>{const scoreColor=tm.result==='W'?'#22c55e':tm.result==='L'?'#ff7b77':'var(--t2)';const resultCls=tm.result==='W'?'res-w':tm.result==='L'?'res-l':'res-t';return`<div class="tp-match-row" style="cursor:pointer;" onclick="jumpToMatchFromTeam('${tm.lbl}')"><span class="tp-match-lbl">${tm.lbl}</span><span class="tp-match-teams" style="color:${tm.myColor==='red'?'#ff7b77':'#6ab3ff'};">${tn(teamId)}+${tn(tm.partner?.team?.id||0)}</span><span class="tp-match-score" style="color:${scoreColor};">${tm.scored?`${tm.myScore}–${tm.oppScore}`:'Upcoming'}</span><span class="tp-match-result ${resultCls}">${tm.result}</span></div>`;}).join('')}
    </div>`;
}
function exportTeamData(){
  if(!currentTeamId)return;
  const teamMatches=getTeamMatches(currentTeamId),wb=XLSX.utils.book_new();
  const rows=[['Match','Result','My Score','Opp Score','Partner','Notes']];
  teamMatches.forEach(tm=>rows.push([tm.lbl,tm.result,tm.myScore,tm.oppScore,tn(tm.partner?.team?.id||0),tm.note?.notes||'']));
  const ws=XLSX.utils.aoa_to_sheet(rows);XLSX.utils.book_append_sheet(wb,ws,(S.teams[currentTeamId]?.number||'Team').substring(0,31));
  XLSX.writeFile(wb,`Nexus_${tn(currentTeamId)}_analysis.xlsx`);
}
function jumpToMatchFromTeam(lbl){closeTeamPage();setTimeout(()=>jumpToMatch(lbl),150);}

// ─── TABS ─────────────────────────────────────────────────────────────────────
let activeTab='event',seasonDataLoaded=false;
function switchTab(tab){
  activeTab=tab;
  document.getElementById('tpEventTab').style.display=tab==='event'?'grid':'none';
  document.getElementById('tpSeasonTab').style.display=tab==='season'?'grid':'none';
  document.getElementById('tabEvent').classList.toggle('active',tab==='event');
  document.getElementById('tabSeason').classList.toggle('active',tab==='season');
  if(tab==='season'&&!seasonDataLoaded&&currentTeamId)loadSeasonData(currentTeamId);
}

// ─── SEASON DATA ──────────────────────────────────────────────────────────────
let CURRENT_SEASON_ID=null;
const SEASON_CACHE_TTL=5*60*1000;
function getSeasonCache(tid,sid){try{const r=JSON.parse(sessionStorage.getItem(`nexus_season_${tid}_${sid}`)||'null');return r&&Date.now()-r.ts<SEASON_CACHE_TTL?r.data:null;}catch{return null;}}
function setSeasonCache(tid,sid,data){try{sessionStorage.setItem(`nexus_season_${tid}_${sid}`,JSON.stringify({ts:Date.now(),data}));}catch{}}
async function loadSeasonData(teamId){
  const main=document.getElementById('tpSeasonMain'),side=document.getElementById('tpSeasonSide');
  if(!CURRENT_SEASON_ID&&S.ev?.season?.id)CURRENT_SEASON_ID=S.ev.season.id;
  if(!CURRENT_SEASON_ID){try{const s=await rg('/seasons',{'program[]':1,active:true,per_page:1});CURRENT_SEASON_ID=s.data?.[0]?.id;}catch{}}
  if(!CURRENT_SEASON_ID){if(main)main.innerHTML='<div class="empty" style="margin-top:60px;"><p style="color:#ff7b77;">Could not determine season ID</p></div>';return;}
  const cached=getSeasonCache(teamId,CURRENT_SEASON_ID);
  if(cached){seasonDataLoaded=true;document.getElementById('tabSeasonBadge').textContent=`${cached.matchData.length} matches`;renderSeasonMain(teamId,cached.matchData,cached.rankData,cached.skillsData,cached.eventsData);renderSeasonSide(teamId,cached.matchData,cached.rankData,cached.skillsData,cached.eventsData);return;}
  if(main)main.innerHTML=`<div style="padding:20px;display:flex;flex-direction:column;gap:12px;"><div class="tp-stats">${['Season Record','Avg Score','Consistency','Trend'].map(l=>`<div class="tp-stat"><div class="tp-stat-lbl">${l}</div><div style="height:28px;background:var(--s4);border-radius:4px;animation:skelPulse 1.4s ease-in-out infinite;margin-top:4px;"></div></div>`).join('')}</div></div>`;
  try{
    let matchData=[],rankData=[],skillsData=[],eventsData=[];
    await Promise.all([
      ra(`/teams/${teamId}/matches`,{'season[]':CURRENT_SEASON_ID,per_page:250}).then(d=>{matchData=d;document.getElementById('tabSeasonBadge').textContent=`${d.length} matches`;}),
      ra(`/teams/${teamId}/rankings`,{'season[]':CURRENT_SEASON_ID}).then(d=>{rankData=d;}),
      ra(`/teams/${teamId}/skills`,{'season[]':CURRENT_SEASON_ID}).then(d=>{skillsData=d;}),
      ra(`/teams/${teamId}/events`,{'season[]':CURRENT_SEASON_ID}).then(d=>{eventsData=d;}),
    ]);
    seasonDataLoaded=true;
    renderSeasonMain(teamId,matchData,rankData,skillsData,eventsData);
    renderSeasonSide(teamId,matchData,rankData,skillsData,eventsData);
    setSeasonCache(teamId,CURRENT_SEASON_ID,{matchData,rankData,skillsData,eventsData});
  }catch(e){if(main)main.innerHTML=`<div class="empty" style="margin-top:60px;"><p style="color:#ff7b77;">Season error: ${e.message}</p></div>`;}
}
function computeSeasonStats(teamId,matches){
  let wins=0,losses=0,ties=0,totalScore=0,scoreCount=0;const matchesByEvent={};
  matches.forEach(m=>{
    const myA=(m.alliances||[]).find(a=>(a.teams||[]).some(t=>Number(t.team.id)===Number(teamId)));
    const oppA=(m.alliances||[]).find(a=>!(a.teams||[]).some(t=>Number(t.team.id)===Number(teamId)));
    if(!myA)return;
    const ms=myA.score!=null?Number(myA.score):null,os=oppA?.score!=null?Number(oppA.score):null;
    if(!(ms!==null&&os!==null)&&!m.scored)return;
    if(ms>os)wins++;else if(ms<os)losses++;else ties++;
    if(ms!==null){totalScore+=ms;scoreCount++;}
    const eid=m.event?.id;
    if(eid){if(!matchesByEvent[eid])matchesByEvent[eid]={event:m.event,wins:0,losses:0,ties:0,scores:[]};
      if(ms>os)matchesByEvent[eid].wins++;else if(ms<os)matchesByEvent[eid].losses++;else matchesByEvent[eid].ties++;
      if(ms!==null)matchesByEvent[eid].scores.push(ms);}
  });
  return{wins,losses,ties,avgScore:scoreCount?Math.round(totalScore/scoreCount):0,matchesByEvent:Object.values(matchesByEvent),total:wins+losses+ties};
}
function renderSeasonMain(teamId,matches,rankings,skills,events){
  const main=document.getElementById('tpSeasonMain'),stats=computeSeasonStats(teamId,matches);
  const scoredMatches=matches.filter(m=>{const my=(m.alliances||[]).find(a=>(a.teams||[]).some(t=>Number(t.team.id)===Number(teamId)));const opp=(m.alliances||[]).find(a=>!(a.teams||[]).some(t=>Number(t.team.id)===Number(teamId)));return(my?.score!=null&&opp?.score!=null)||m.scored;}).map(m=>{const my=(m.alliances||[]).find(a=>(a.teams||[]).some(t=>Number(t.team.id)===Number(teamId)));const opp=(m.alliances||[]).find(a=>!(a.teams||[]).some(t=>Number(t.team.id)===Number(teamId)));const ms=my?.score!=null?Number(my.score):0,os=opp?.score!=null?Number(opp.score):0;return{myScore:ms,oppScore:os,result:ms>os?'W':ms<os?'L':'T',eventName:m.event?.name||'?'};});
  const scores=scoredMatches.map(m=>m.myScore),consistency=computeConsistency(scores),trend=computeTrend(scores),{mmr,history:mmrHistory}=computeMMR(teamId,scoredMatches);
  const trendColor=trend.dir>0?'#22c55e':trend.dir<0?'#ff7b77':'var(--t2)';
  const driverSkill=skills.filter(s=>s.type===1).sort((a,b)=>b.score-a.score)[0],autoSkill=skills.filter(s=>s.type===0).sort((a,b)=>b.score-a.score)[0];
  const combinedSkill=driverSkill&&autoSkill?driverSkill.score+autoSkill.score:null;
  main.innerHTML=`
    <div class="tp-stats">
      <div class="tp-stat"><div class="tp-stat-lbl">Season Record</div><div class="tp-stat-val" style="color:#22c55e;">${stats.wins}W</div><div class="tp-stat-sub">${stats.losses}L·${stats.ties}T</div></div>
      <div class="tp-stat"><div class="tp-stat-lbl">Avg Score</div><div class="tp-stat-val" style="color:var(--gold);">${stats.avgScore}</div><div class="tp-stat-sub">${stats.total} matches</div></div>
      <div class="tp-stat"><div class="tp-stat-lbl">Consistency</div><div class="tp-stat-val">${consistency}</div><div class="tp-stat-sub">out of 100</div></div>
      <div class="tp-stat"><div class="tp-stat-lbl">Trend</div><div class="tp-stat-val" style="color:${trendColor};font-size:18px;">${trend.label}</div></div>
    </div>
    ${combinedSkill!==null?`<div class="tp-card"><div class="tp-card-title">Robot Skills</div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;"><div class="tp-stat"><div class="tp-stat-lbl">Combined</div><div class="tp-stat-val" style="color:var(--gold);">${combinedSkill}</div></div><div class="tp-stat"><div class="tp-stat-lbl">Driver</div><div class="tp-stat-val">${driverSkill?.score??'—'}</div></div><div class="tp-stat"><div class="tp-stat-lbl">Autonomous</div><div class="tp-stat-val">${autoSkill?.score??'—'}</div></div></div></div>`:''}
    <div class="tp-card"><div class="tp-card-title">Season Score Progression</div><div class="tp-chart-wrap"><canvas id="chartSeasonScores"></canvas></div></div>
    <div class="tp-card"><div class="tp-card-title">Season MMR</div><div style="display:flex;align-items:center;gap:16px;margin-bottom:10px;"><div><div class="tp-stat-lbl">Season MMR</div><div class="tp-stat-val" style="color:var(--gold);font-size:32px;">${mmr}</div></div><div style="flex:1;height:60px;position:relative;"><canvas id="chartSeasonMMR"></canvas></div></div></div>
    <div class="tp-card"><div class="tp-card-title">Win / Loss Streak</div><div class="momentum-row">${scoredMatches.map(m=>`<div class="mom-block mom-${m.result.toLowerCase()}">${m.result}</div>`).join('')}</div></div>`;
  requestAnimationFrame(()=>{
    const cd={responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{backgroundColor:'#1c1c22',titleColor:'#eeeef4',bodyColor:'#8888a0'}},scales:{x:{display:false},y:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#48485a',font:{size:11}}}}};
    const ctxSS=document.getElementById('chartSeasonScores')?.getContext('2d');
    if(ctxSS)tpCharts.push(new Chart(ctxSS,{type:'line',data:{labels:scoredMatches.map((_,i)=>i+1),datasets:[{label:'My Score',data:scores,borderColor:'#a855f7',backgroundColor:'rgba(168,85,247,0.08)',tension:0.3,pointRadius:2,pointBackgroundColor:'#a855f7'},{label:'Opp',data:scoredMatches.map(m=>m.oppScore),borderColor:'rgba(255,255,255,0.12)',backgroundColor:'transparent',tension:0.3,pointRadius:0,borderDash:[3,3]}]},options:{...cd,plugins:{...cd.plugins,legend:{display:true,labels:{color:'#8888a0',font:{size:11}}}}}}));
    const ctxSM=document.getElementById('chartSeasonMMR')?.getContext('2d');
    if(ctxSM)tpCharts.push(new Chart(ctxSM,{type:'line',data:{labels:mmrHistory.map((_,i)=>i),datasets:[{data:mmrHistory,borderColor:'#a855f7',backgroundColor:'rgba(168,85,247,0.1)',tension:0.4,pointRadius:0,fill:true}]},options:{responsive:true,maintainAspectRatio:false,scales:{x:{display:false},y:{display:false}},plugins:{legend:{display:false},tooltip:{enabled:false}}}}));
  });
}
function renderSeasonSide(teamId,matches,rankings,skills,events){
  const side=document.getElementById('tpSeasonSide'),stats=computeSeasonStats(teamId,matches);
  const eventResults=stats.matchesByEvent.sort((a,b)=>(b.wins/(Math.max(b.wins+b.losses+b.ties,1)))-(a.wins/(Math.max(a.wins+a.losses+a.ties,1))));
  const bestPlacement=rankings.sort((a,b)=>a.rank-b.rank)[0],topSkills=skills.filter(s=>s.type===1).sort((a,b)=>b.score-a.score)[0];
  const pc=r=>r===1?'gold':r<=3?'silver':r<=8?'bronze':'other';
  side.innerHTML=`
    <div style="margin-bottom:14px;"><div class="ph-t" style="margin-bottom:8px;">Season Highlights</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
        <div class="tp-stat"><div class="tp-stat-lbl">Events</div><div class="tp-stat-val">${events.length}</div></div>
        <div class="tp-stat"><div class="tp-stat-lbl">Best Rank</div><div class="tp-stat-val" style="color:var(--gold);">#${bestPlacement?.rank??'—'}</div></div>
        <div class="tp-stat"><div class="tp-stat-lbl">Win Rate</div><div class="tp-stat-val">${stats.total>0?Math.round(stats.wins/stats.total*100):0}%</div></div>
        <div class="tp-stat"><div class="tp-stat-lbl">Skills</div><div class="tp-stat-val">${topSkills?.score??'—'}</div></div>
      </div></div>
    <div><div class="ph-t" style="margin-bottom:8px;">Events Attended</div>
      ${eventResults.length?eventResults.map(er=>{const total=er.wins+er.losses+er.ties,wr=total>0?Math.round(er.wins/total*100):0,avgSc=er.scores.length?Math.round(er.scores.reduce((a,b)=>a+b,0)/er.scores.length):0,evRank=rankings.find(r=>r.event?.id===er.event?.id),rank=evRank?.rank;return`<div class="season-event-row"><div class="season-event-top"><div class="season-event-name">${er.event?.name||'Unknown'}</div>${rank?`<div class="season-event-place ${pc(rank)}">#${rank}</div>`:''}</div><div class="season-event-stats"><span>${er.wins}W-${er.losses}L-${er.ties}T</span><span>·</span><span>${wr}% win</span><span>·</span><span>Avg ${avgSc}</span></div><div class="season-skills-bar"><div class="season-skills-fill" style="width:${wr}%;"></div></div></div>`;}).join(''):'<div class="empty" style="padding:10px;">No event data</div>'}
    </div>`;
}

// ─── CV DATA IMPORT ───────────────────────────────────────────────────────────
let cvData=null;
function importCVData(event){
  const file=event.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const data=JSON.parse(e.target.result);
      if(!data.timeline||!data.robot_contributions)throw new Error('Not a valid Nexus CV export');
      cvData=data;if(currentTeamId){S.notes[`cv_${currentTeamId}`]=data;sn2();}
      renderCVSection(data);setSt(`CV data imported: ${data.source}`,'live');
    }catch(err){setSt('CV import error: '+err.message,'idle');}
  };
  reader.readAsText(file);event.target.value='';
}
function renderCVSection(data){
  let cvSection=document.getElementById('cvSection');
  if(!cvSection){const main=document.getElementById('tpMain');if(!main)return;const div=document.createElement('div');div.id='cvSection';main.appendChild(div);cvSection=div;}
  const wc=data.winner==='red'?'#ff6b65':data.winner==='blue'?'#6ab3ff':'var(--t2)',ac=data.auton_winner==='red'?'#ff6b65':data.auton_winner==='blue'?'#6ab3ff':'var(--t2)';
  cvSection.innerHTML=`<div class="tp-card" style="margin-top:12px;">
    <div class="tp-card-title">CV Analysis<span style="font-size:11px;color:var(--t3);font-family:var(--fb);font-weight:400;">${data.source}</span></div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;">
      <div class="tp-stat"><div class="tp-stat-lbl">Red Score</div><div class="tp-stat-val" style="color:#ff6b65;">${data.final_red_score}</div></div>
      <div class="tp-stat"><div class="tp-stat-lbl">Blue Score</div><div class="tp-stat-val" style="color:#6ab3ff;">${data.final_blue_score}</div></div>
      <div class="tp-stat"><div class="tp-stat-lbl">Winner</div><div class="tp-stat-val" style="color:${wc};font-size:16px;">${data.winner.toUpperCase()}</div></div>
      <div class="tp-stat"><div class="tp-stat-lbl">Auton</div><div class="tp-stat-val" style="color:${ac};font-size:16px;">${data.auton_winner.toUpperCase()}</div></div>
    </div>
    <div style="margin-bottom:12px;"><div style="font-family:var(--fd);font-size:11px;font-weight:700;letter-spacing:0.1em;color:var(--t3);text-transform:uppercase;margin-bottom:7px;">Robot Contributions</div>
      ${data.robot_contributions.map(r=>{const c=r.alliance==='red'?'#ff6b65':'#6ab3ff',bc=r.alliance==='red'?'var(--red)':'var(--blue)';return`<div style="margin-bottom:7px;"><div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span style="font-family:var(--fm);font-size:12px;font-weight:600;color:${c};">${r.team_number}</span><span style="font-size:12px;color:var(--t2);">${r.blocks_scored} blocks · ${r.contribution_pct}%</span></div><div style="height:5px;background:var(--s4);border-radius:3px;overflow:hidden;"><div style="width:${r.contribution_pct}%;height:100%;background:${bc};border-radius:3px;"></div></div></div>`;}).join('')}
    </div>
    <div style="font-family:var(--fd);font-size:11px;font-weight:700;letter-spacing:0.1em;color:var(--t3);text-transform:uppercase;margin-bottom:7px;">Score Timeline</div>
    <div style="position:relative;height:140px;"><canvas id="chartCV"></canvas></div>
  </div>`;
  requestAnimationFrame(()=>{
    const ctx=document.getElementById('chartCV')?.getContext('2d');if(!ctx||!window.Chart)return;
    const step=Math.max(1,Math.floor(data.timeline.length/20));
    tpCharts.push(new Chart(ctx,{type:'line',data:{labels:data.timeline.map((p,i)=>i%step===0?p.t+'s':''),datasets:[{label:'Red',data:data.timeline.map(p=>p.red),borderColor:'#ff6b65',backgroundColor:'rgba(232,48,42,0.08)',tension:0.3,pointRadius:0,fill:true},{label:'Blue',data:data.timeline.map(p=>p.blue),borderColor:'#6ab3ff',backgroundColor:'rgba(26,125,223,0.08)',tension:0.3,pointRadius:0,fill:true}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,labels:{color:'#8888a0',font:{size:11}}},tooltip:{backgroundColor:'#1c1c22',titleColor:'#eeeef4',bodyColor:'#8888a0'}},scales:{x:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#48485a',font:{size:10},maxRotation:0}},y:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#48485a',font:{size:10}},beginAtZero:true}}}}));
  });
}
function restoreCVData(teamId){const saved=S.notes[`cv_${teamId}`];if(saved){cvData=saved;renderCVSection(saved);}}

// ─── CV SCORE DETECTION OVERLAY ───────────────────────────────────────────────
const CV={zones:{redGoal:{label:'Red Goal Zone',color:'#ff6b65',dotColor:'#e8302a',drawn:false,rect:null},blueGoal:{label:'Blue Goal Zone',color:'#6ab3ff',dotColor:'#1a7ddf',drawn:false,rect:null},redBot1:{label:'Red Robot 1',color:'#ff9d9a',dotColor:'#e8302a',drawn:false,rect:null},redBot2:{label:'Red Robot 2',color:'#ffbdb9',dotColor:'#e8302a',drawn:false,rect:null},blueBot1:{label:'Blue Robot 1',color:'#90c4ff',dotColor:'#1a7ddf',drawn:false,rect:null},blueBot2:{label:'Blue Robot 2',color:'#b3d8ff',dotColor:'#1a7ddf',drawn:false,rect:null}},activeZone:'redGoal',drawing:false,drawStart:null,capturedImage:null,rafId:null,lastFrameTime:0,fps:0,redScore:0,blueScore:0,autonWinner:'TBD',autonChecked:false,detectionHistory:[]};
const ZONE_ORDER=['redGoal','blueGoal','redBot1','redBot2','blueBot1','blueBot2'];
const BLOCK_POINTS=5,AUTON_BONUS=8;
const BLOCK_HSV={hMin:75,hMax:108,sMin:70,vMin:55};

function openCVOverlay(){
  document.getElementById('cvOverlayPanel').classList.add('open');
  showCVStep('capture');
  loadCVZones();
  // In Electron with a YouTube URL loaded but no clip yet, show the workflow hint immediately.
  const localVid=document.getElementById('cvVideoPreview');
  const hasClip=localVid&&localVid.src&&localVid.readyState>=2;
  const msg=document.getElementById('cvNoVideoMsg');
  if(msg&&IS_ELECTRON&&ytCurrentUrl&&!hasClip){
    msg.style.display='block';
    msg.innerHTML='⚠️ No clip loaded yet. <strong>Close this panel</strong>, use the <strong>⬥ Start</strong> and <strong>⬥ End</strong> buttons above the video to mark the match, then click <strong>⬇ Download &amp; Analyze</strong> — the clip will load here automatically.';
  } else if(msg){
    msg.style.display='none';
  }
}
function closeCVOverlay(){stopDetection();document.getElementById('cvOverlayPanel').classList.remove('open');}
function showCVStep(step){
  document.getElementById('cvStepCapture').style.display=step==='capture'?'block':'none';
  document.getElementById('cvStepDraw').style.display=step==='draw'?'block':'none';
  document.getElementById('cvStepLive').style.display=step==='live'?'block':'none';
  document.getElementById('cvLiveBar').style.display=step==='live'?'flex':'none';
  ['1','2','3'].forEach((n,i)=>{const pip=document.getElementById('cvStep'+n);if(pip)pip.classList.toggle('active',['capture','draw','live'][i]===step);});
}
function captureFrame(){
  const localVid=document.getElementById('cvVideoPreview');
  if(localVid&&localVid.src&&localVid.readyState>=2){
    const c=document.createElement('canvas');
    c.width=localVid.videoWidth;c.height=localVid.videoHeight;
    c.getContext('2d').drawImage(localVid,0,0);
    const img=new Image();img.onload=()=>{CV.capturedImage=img;showDrawStep(img);};img.src=c.toDataURL('image/jpeg',0.95);
    return;
  }
  const msg=document.getElementById('cvNoVideoMsg');
  if(!msg)return;
  msg.style.display='block';
  if(IS_ELECTRON&&ytCurrentUrl){
    msg.innerHTML='⚠️ No clip loaded yet. <strong>Close this panel</strong>, use the <strong>⬥ Start</strong> and <strong>⬥ End</strong> buttons above the video to mark the match, then click <strong>⬇ Download &amp; Analyze</strong> — the clip will load here automatically.';
  } else {
    msg.textContent='⚠️ Load a video file using the button above, pause it at the desired frame, then capture.';
  }
}
function loadCVVideo(e){
  const file=e.target.files[0];if(!file)return;
  const vid=document.getElementById('cvVideoPreview');
  if(vid.src)URL.revokeObjectURL(vid.src);
  vid.src=URL.createObjectURL(file);
  vid.style.display='block';
  const msg=document.getElementById('cvNoVideoMsg');
  if(msg){msg.style.display='block';msg.textContent='⏸ Pause at the desired frame, then click Capture Frame.';}
  e.target.value='';
}
function loadScreenshot(e){
  const file=e.target.files[0];if(!file)return;
  const reader=new FileReader();reader.onload=ev=>{const img=new Image();img.onload=()=>{CV.capturedImage=img;showDrawStep(img);};img.src=ev.target.result;};reader.readAsDataURL(file);e.target.value='';
}
function showDrawStep(img){
  showCVStep('draw');
  const canvas=document.getElementById('cvoCanvas'),wrap=document.getElementById('cvCanvasWrap'),scale=wrap.offsetWidth/img.width;
  canvas.width=img.width;canvas.height=img.height;canvas.style.height=(img.height*scale)+'px';
  const dc=document.getElementById('cvoDrawCanvas');dc.width=img.width;dc.height=img.height;dc.style.height=(img.height*scale)+'px';
  canvas.getContext('2d').drawImage(img,0,0);
  renderZoneButtons();renderZoneList();redrawZones();setActiveZone('redGoal');
}
function renderZoneButtons(){
  const el=document.getElementById('cvZoneBtns');if(!el)return;
  el.innerHTML=ZONE_ORDER.map(k=>{const z=CV.zones[k];return`<button class="btn-o" style="${CV.activeZone===k?'border-color:'+z.color+';color:'+z.color+';':''}" onclick="setActiveZone('${k}')"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${z.drawn?'#22c55e':z.dotColor};margin-right:4px;"></span>${z.label}</button>`;}).join('');
}
function setActiveZone(key){CV.activeZone=key;document.getElementById('cvCurrentZoneName').textContent=CV.zones[key].label;renderZoneButtons();}
function renderZoneList(){
  const el=document.getElementById('cvZoneList');if(!el)return;
  el.innerHTML=ZONE_ORDER.map(k=>{const z=CV.zones[k];return`<div class="cvo-zone ${z.drawn?'drawn':''}" onclick="setActiveZone('${k}')"><div class="cvo-zone-hd"><div class="cvo-zone-color" style="background:${z.dotColor};"></div><div class="cvo-zone-name">${z.label}</div></div><div class="cvo-zone-status">${z.drawn?'✓ Zone drawn':'Click to select, then draw'}</div><div class="cvo-zone-val" id="cvZoneVal-${k}">—</div></div>`;}).join('');
}
function cvCoords(e){const canvas=document.getElementById('cvoDrawCanvas'),rect=canvas.getBoundingClientRect(),sx=canvas.width/rect.width,sy=canvas.height/rect.height;return{x:(e.clientX-rect.left)*sx,y:(e.clientY-rect.top)*sy};}
function cvStartDraw(e){CV.drawing=true;CV.drawStart=cvCoords(e);}
function cvMoveDraw(e){
  if(!CV.drawing)return;const pos=cvCoords(e);redrawZones();
  const dc=document.getElementById('cvoDrawCanvas').getContext('2d'),z=CV.zones[CV.activeZone];
  dc.strokeStyle=z.color;dc.lineWidth=2;dc.setLineDash([6,3]);
  dc.strokeRect(CV.drawStart.x,CV.drawStart.y,pos.x-CV.drawStart.x,pos.y-CV.drawStart.y);
}
function cvEndDraw(e){
  if(!CV.drawing)return;CV.drawing=false;const pos=cvCoords(e);
  const x=Math.min(CV.drawStart.x,pos.x),y=Math.min(CV.drawStart.y,pos.y),w=Math.abs(pos.x-CV.drawStart.x),h=Math.abs(pos.y-CV.drawStart.y);
  if(w>10&&h>10){CV.zones[CV.activeZone].rect={x,y,w,h};CV.zones[CV.activeZone].drawn=true;const next=ZONE_ORDER.find(k=>!CV.zones[k].drawn&&k!==CV.activeZone);if(next)setActiveZone(next);renderZoneButtons();renderZoneList();redrawZones();}
}
function redrawZones(){
  const dc=document.getElementById('cvoDrawCanvas');if(!dc)return;const ctx=dc.getContext('2d');ctx.clearRect(0,0,dc.width,dc.height);
  ZONE_ORDER.forEach(k=>{const z=CV.zones[k];if(!z.drawn||!z.rect)return;const r=z.rect;ctx.fillStyle=z.color+'22';ctx.fillRect(r.x,r.y,r.w,r.h);ctx.strokeStyle=z.color;ctx.lineWidth=k===CV.activeZone?3:1.5;ctx.setLineDash([]);ctx.strokeRect(r.x,r.y,r.w,r.h);ctx.fillStyle=z.color;ctx.font='bold 11px Barlow,sans-serif';ctx.fillText(z.label,r.x+4,r.y+14);});
}
function resetZones(){ZONE_ORDER.forEach(k=>{CV.zones[k].drawn=false;CV.zones[k].rect=null;});const dc=document.getElementById('cvoDrawCanvas');if(dc)dc.getContext('2d').clearRect(0,0,dc.width,dc.height);renderZoneButtons();renderZoneList();setActiveZone('redGoal');}
function saveCVZones(){
  const canvas=document.getElementById('cvoCanvas'),saved={};
  ZONE_ORDER.forEach(k=>{if(CV.zones[k].drawn&&CV.zones[k].rect){const r=CV.zones[k].rect;saved[k]={x:r.x/canvas.width,y:r.y/canvas.height,w:r.w/canvas.width,h:r.h/canvas.height};}});
  localStorage.setItem('nexus_cv_zones',JSON.stringify(saved));alert('Zones saved!');
}
function loadCVZones(){try{const saved=JSON.parse(localStorage.getItem('nexus_cv_zones')||'{}');Object.entries(saved).forEach(([k,rel])=>{if(CV.zones[k])CV.zones[k]._relRect=rel;});}catch{}}
function startDetection(){
  const drawn=ZONE_ORDER.filter(k=>CV.zones[k].drawn);
  if(!drawn.includes('redGoal')&&!drawn.includes('blueGoal')){alert('Draw at least Red and Blue Goal zones first.');return;}
  const live=document.getElementById('cvoLiveCanvas'),src=document.getElementById('cvoCanvas');
  live.width=src.width;live.height=src.height;live.style.height=src.style.height;
  showCVStep('live');renderLiveZones();CV.autonChecked=false;CV.autonWinner='TBD';CV.detectionHistory=[];CV.redBlocks=0;CV.blueBlocks=0;
  const localVid=document.getElementById('cvVideoPreview');
  if(localVid&&localVid.readyState>=2)localVid.play();
  let lastAnalysis=0;
  function loop(ts){
    const delta=ts-CV.lastFrameTime;if(delta>0)CV.fps=Math.round(1000/delta);CV.lastFrameTime=ts;
    document.getElementById('cvLiveFPS').textContent=CV.fps+' fps';
    redrawLiveOverlay();
    if(ts-lastAnalysis>2000){
      if(localVid&&localVid.readyState>=2){try{src.getContext('2d').drawImage(localVid,0,0,src.width,src.height);}catch(e){}}
      analyzeZones();lastAnalysis=ts;
    }
    CV.rafId=requestAnimationFrame(loop);
  }
  CV.rafId=requestAnimationFrame(loop);
}
function stopDetection(){
  if(CV.rafId){cancelAnimationFrame(CV.rafId);CV.rafId=null;}
  const localVid=document.getElementById('cvVideoPreview');
  if(localVid)localVid.pause();
}
function analyzeZones(){
  const canvas=document.getElementById('cvoCanvas'),ctx=canvas.getContext('2d'),img=CV.capturedImage;if(!img)return;
  let redBlocks=0,blueBlocks=0;
  ZONE_ORDER.forEach(k=>{
    const z=CV.zones[k];if(!z.drawn||!z.rect)return;const r=z.rect;
    const sx=Math.round(r.x),sy=Math.round(r.y),sw=Math.round(r.w),sh=Math.round(r.h);if(sw<5||sh<5)return;
    try{
      const data=ctx.getImageData(sx,sy,sw,sh).data,blockPixels=countBlockPixels(data),density=blockPixels/(sw*sh),blockCount=Math.round(density*(sw*sh)/400);
      if(k==='redGoal')redBlocks=blockCount;if(k==='blueGoal')blueBlocks=blockCount;
      const valEl=document.getElementById('cvZoneVal-'+k);
      if(valEl){if(k==='redGoal'||k==='blueGoal'){valEl.textContent=`${blockCount} block${blockCount!==1?'s':''}`;valEl.style.color=k==='redGoal'?'#ff6b65':'#6ab3ff';}else{const activity=Math.round(density*100);valEl.textContent=activity>5?`Active (${activity}%)`:'Not detected';valEl.style.color=activity>5?'#22c55e':'var(--t3)';}}
    }catch(err){const valEl=document.getElementById('cvZoneVal-'+k);if(valEl){valEl.textContent='Upload screenshot to detect';valEl.style.color='var(--gold)';}}
  });
  let redScore=redBlocks*BLOCK_POINTS,blueScore=blueBlocks*BLOCK_POINTS;
  if(!CV.autonChecked&&(redBlocks>0||blueBlocks>0)){CV.autonWinner=redBlocks>blueBlocks?'RED':blueBlocks>redBlocks?'BLUE':'TIE';CV.autonChecked=true;document.getElementById('cvAutonWinner').textContent=CV.autonWinner;}
  if(CV.autonWinner==='RED')redScore+=AUTON_BONUS;if(CV.autonWinner==='BLUE')blueScore+=AUTON_BONUS;
  CV.redScore=redScore;CV.blueScore=blueScore;CV.redBlocks=redBlocks;CV.blueBlocks=blueBlocks;
  CV.detectionHistory.push({r:redScore,b:blueScore,ts:Date.now()});if(CV.detectionHistory.length>3)CV.detectionHistory.shift();
  const avgR=Math.round(CV.detectionHistory.reduce((a,x)=>a+x.r,0)/CV.detectionHistory.length),avgB=Math.round(CV.detectionHistory.reduce((a,x)=>a+x.b,0)/CV.detectionHistory.length);
  document.getElementById('cvLiveRed').textContent=avgR;document.getElementById('cvLiveBlue').textContent=avgB;
  document.getElementById('cvLiveStatus').textContent=`Red: ${redBlocks} blocks · Blue: ${blueBlocks} blocks`;
}
function countBlockPixels(data){let count=0;for(let i=0;i<data.length;i+=4){const[h,s,v]=rgbToHsv(data[i],data[i+1],data[i+2]);if(h>=BLOCK_HSV.hMin&&h<=BLOCK_HSV.hMax&&s>=BLOCK_HSV.sMin&&v>=BLOCK_HSV.vMin)count++;}return count;}
function rgbToHsv(r,g,b){r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;let h=0,s=max?d/max:0,v=max;if(d){if(max===r)h=((g-b)/d)%6;else if(max===g)h=(b-r)/d+2;else h=(r-g)/d+4;h=Math.round(h*30);if(h<0)h+=180;}return[h,Math.round(s*255),Math.round(v*255)];}
function redrawLiveOverlay(){
  const live=document.getElementById('cvoLiveCanvas'),ctx=live.getContext('2d');if(!live||!live.width)return;
  const localVid=document.getElementById('cvVideoPreview');
  if(localVid&&localVid.readyState>=2){try{ctx.drawImage(localVid,0,0,live.width,live.height);}catch(e){if(CV.capturedImage)ctx.drawImage(CV.capturedImage,0,0);}}
  else if(CV.capturedImage){ctx.drawImage(CV.capturedImage,0,0);}
  ZONE_ORDER.forEach(k=>{const z=CV.zones[k];if(!z.drawn||!z.rect)return;const r=z.rect;ctx.fillStyle=z.color+'30';ctx.fillRect(r.x,r.y,r.w,r.h);ctx.strokeStyle=z.color;ctx.lineWidth=2;ctx.setLineDash([]);ctx.strokeRect(r.x,r.y,r.w,r.h);ctx.fillStyle=z.color;ctx.font='bold 12px Barlow,sans-serif';ctx.fillText(k==='redGoal'?`${CV.redBlocks||0}blk`:k==='blueGoal'?`${CV.blueBlocks||0}blk`:z.label.replace(' Robot',''),r.x+4,r.y+r.h-6);});
}
function drawLiveOverlay(redBlocks,blueBlocks){}
function renderLiveZones(){const el=document.getElementById('cvLiveZones');if(el)el.innerHTML=document.getElementById('cvZoneList')?.innerHTML||'';}
function pushDetectedScores(){
  const rIn=document.getElementById('inRedScore'),bIn=document.getElementById('inBlueScore');
  if(rIn)rIn.value=CV.redScore;if(bIn)bIn.value=CV.blueScore;
  if(typeof updateOverlayScore==='function')updateOverlayScore();closeCVOverlay();
}

const STLLoader = {
  parse(buffer) {
    // Detect ASCII vs binary
    const isASCII = (() => {
      const view = new DataView(buffer);
      // Binary STL: first 80 bytes are header, bytes 80-84 are triangle count
      const numTriangles = view.getUint32(80, true);
      const expectedLen = 84 + numTriangles * 50;
      if (buffer.byteLength === expectedLen) return false;
      // Check for "solid" text header (ASCII)
      const header = new TextDecoder().decode(new Uint8Array(buffer, 0, 5));
      return header.toLowerCase().startsWith('solid');
    })();
    return isASCII ? parseASCII(new TextDecoder().decode(buffer)) : parseBinary(buffer);

    function parseASCII(text) {
      const geo = new THREE.BufferGeometry();
      const verts = [], norms = [];
      const lines = text.split('\n');
      let nx=0,ny=0,nz=0;
      for (const line of lines) {
        const l = line.trim();
        if (l.startsWith('facet normal')) {
          const p = l.split(/\s+/); nx=+p[2]; ny=+p[3]; nz=+p[4];
        } else if (l.startsWith('vertex')) {
          const p = l.split(/\s+/);
          verts.push(+p[1],+p[2],+p[3]);
          norms.push(nx,ny,nz);
        }
      }
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
      geo.setAttribute('normal',   new THREE.BufferAttribute(new Float32Array(norms), 3));
      return geo;
    }

    function parseBinary(buf) {
      const geo = new THREE.BufferGeometry();
      const view = new DataView(buf);
      const n = view.getUint32(80, true);
      const verts = new Float32Array(n * 9), norms = new Float32Array(n * 9);
      let offset = 84;
      for (let i = 0; i < n; i++) {
        const nx=view.getFloat32(offset,true), ny=view.getFloat32(offset+4,true), nz=view.getFloat32(offset+8,true);
        offset += 12;
        for (let v = 0; v < 3; v++) {
          const base = i*9+v*3;
          verts[base]   = view.getFloat32(offset,true);
          verts[base+1] = view.getFloat32(offset+4,true);
          verts[base+2] = view.getFloat32(offset+8,true);
          norms[base]=nx; norms[base+1]=ny; norms[base+2]=nz;
          offset += 12;
        }
        offset += 2; // attribute byte count
      }
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      geo.setAttribute('normal',   new THREE.BufferAttribute(norms, 3));
      return geo;
    }
  }
};

// ─── STL VIEWER STATE ─────────────────────────────────────────────────────────
const STL = {
  scene: null, camera: null, renderer: null, mesh: null,
  animId: null, models: [],  // { name, path }
  activeModel: null,
  activeModelPath: null,
  mouse: { down: false, right: false, lastX: 0, lastY: 0 },
  spherical: { theta: 0.5, phi: 1.0, radius: 5 },
  target: new (typeof THREE !== 'undefined' ? THREE.Vector3 : Object)(),
  orient: { active: false },
  group: null,
  cadConfig: null,
  cadConfigVisible: false,
};

function openSTLViewer() {
  const page = document.getElementById('stlPage');
  if (!page) return;
  page.style.display = 'flex';
  if (!STL.renderer) initSTLRenderer();
  refreshSTLLibrary();
}

function closeSTLViewer() {
  document.getElementById('stlPage').style.display = 'none';
  if (STL.animId) { cancelAnimationFrame(STL.animId); STL.animId = null; }
  // Reset config panel state so reopening starts fresh
  STL.cadConfigVisible = false;
  const panel = document.getElementById('stlConfigPanel');
  if (panel) panel.style.display = 'none';
  const btn = document.getElementById('stlConfigBtn');
  if (btn) { btn.style.background = ''; btn.style.color = ''; }
  const hp = document.getElementById('homePage'); if (hp) hp.style.display = 'flex';
}

function initSTLRenderer() {
  if (typeof THREE === 'undefined') {
    console.error('Three.js not loaded — add the CDN script to index.html');
    return;
  }
  const canvas = document.getElementById('stlCanvas');
  const vp = document.getElementById('stlViewport');

  STL.scene = new THREE.Scene();
  STL.scene.background = new THREE.Color(0x0a0a10);

  STL.camera = new THREE.PerspectiveCamera(45, vp.offsetWidth / vp.offsetHeight, 0.01, 1000);
  updateSTLCamera();

  STL.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  STL.renderer.setPixelRatio(window.devicePixelRatio);
  STL.renderer.setSize(vp.offsetWidth, vp.offsetHeight);
  STL.renderer.shadowMap.enabled = true;

  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  const dir1 = new THREE.DirectionalLight(0xffffff, 0.8);
  dir1.position.set(5, 10, 7);
  dir1.castShadow = true;
  const dir2 = new THREE.DirectionalLight(0x8888ff, 0.3);
  dir2.position.set(-5, -3, -5);
  STL.scene.add(ambient, dir1, dir2);

  // Grid helper
  const grid = new THREE.GridHelper(10, 20, 0x2e2e3a, 0x1c1c22);
  STL.scene.add(grid);
  STL.target = new THREE.Vector3();

  // Mouse controls
  canvas.addEventListener('mousedown', e => {
    STL.mouse.down = true;
    STL.mouse.right = e.button === 2;
    STL.mouse.lastX = e.clientX; STL.mouse.lastY = e.clientY;
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('mouseup', () => { STL.mouse.down = false; });
  window.addEventListener('mousemove', e => {
    if (!STL.mouse.down) return;
    const dx = e.clientX - STL.mouse.lastX, dy = e.clientY - STL.mouse.lastY;
    STL.mouse.lastX = e.clientX; STL.mouse.lastY = e.clientY;
    if (STL.orient.active && STL.group && !STL.mouse.right) {
      if (e.shiftKey) {
        // Shift+drag: move model up/down
        STL.group.position.y -= dy * STL.spherical.radius * 0.0012;
        stlSaveOrientation();
      } else {
        // Reorient mode: left drag rotates the model around camera-relative axes so
        // dragging always feels correct regardless of current camera angle.
        const speed = 0.008;
        const camDir = STL.camera.position.clone().sub(STL.target).normalize();
        const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), camDir).normalize();
        STL.group.rotateOnWorldAxis(right, -dy * speed);
        STL.group.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), -dx * speed);
        stlSaveOrientation();
      }
    } else if (STL.mouse.right) {
      // Pan
      const panSpeed = STL.spherical.radius * 0.001;
      STL.target.x -= dx * panSpeed;
      STL.target.y += dy * panSpeed;
      updateSTLCamera();
    } else {
      // Orbit
      STL.spherical.theta -= dx * 0.008;
      STL.spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, STL.spherical.phi - dy * 0.008));
      updateSTLCamera();
    }
  });
  canvas.addEventListener('wheel', e => {
    STL.spherical.radius = Math.max(0.5, STL.spherical.radius * (1 + e.deltaY * 0.001));
    updateSTLCamera();
    e.preventDefault();
  }, { passive: false });

  // Resize
  new ResizeObserver(() => {
    if (!STL.renderer) return;
    STL.renderer.setSize(vp.offsetWidth, vp.offsetHeight);
    STL.camera.aspect = vp.offsetWidth / vp.offsetHeight;
    STL.camera.updateProjectionMatrix();
  }).observe(vp);

  stlRenderLoop();
}

function updateSTLCamera() {
  if (!STL.camera) return;
  const { theta, phi, radius } = STL.spherical;
  STL.camera.position.set(
    STL.target.x + radius * Math.sin(phi) * Math.sin(theta),
    STL.target.y + radius * Math.cos(phi),
    STL.target.z + radius * Math.sin(phi) * Math.cos(theta)
  );
  STL.camera.lookAt(STL.target);
}

function stlRenderLoop() {
  STL.animId = requestAnimationFrame(stlRenderLoop);
  if (STL.renderer && STL.scene && STL.camera) STL.renderer.render(STL.scene, STL.camera);
}

// ─── LIBRARY ──────────────────────────────────────────────────────────────────
async function refreshSTLLibrary() {
  if (!window.electronAPI?.stlList) return;
  STL.models = await window.electronAPI.stlList();
  renderSTLLibrary();
}

function renderSTLLibrary() {
  const el = document.getElementById('stlLibraryList');
  if (!el) return;
  if (!STL.models.length) {
    el.innerHTML = '<div class="empty" style="padding:20px 10px;font-size:12px;">No models yet.<br>Click + Import STL</div>';
    return;
  }
  el.innerHTML = STL.models.map(m => `
    <div class="stl-lib-item ${STL.activeModel===m.name?'active':''}" onclick="loadSTLModel('${m.path.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}','${m.name.replace(/'/g,"\\'")}')">
      <button class="stl-lib-item-del" onclick="event.stopPropagation();deleteSTLModel('${m.name.replace(/'/g,"\\'")}')">✕</button>
      <div class="stl-lib-item-name" title="${m.name}">${m.name}</div>
    </div>`).join('');
}

async function stlImport() {
  if (!window.electronAPI) return;
  const filePath = await window.electronAPI.openFileDialog([
    { name: '3D Models / Sim Config', extensions: ['obj', 'stl', 'json'] },
  ]);
  if (!filePath) return;

  // If the user picked a simulation.json, hand off to the simulator
  if (filePath.toLowerCase().endsWith('.json')) {
    closeSTLViewer();
    openSimulator();
    // simLoadConfig reads the file via IPC, but we already have the path — call
    // the IPC handler directly via the normal electronAPI flow so the config is
    // resolved and the OBJ is loaded into the simulator.
    if (window.electronAPI?.simLoadConfig) {
      const config = await window.electronAPI.simLoadConfig();
      if (config) {
        SIM.config = config;
        Object.keys(SIM.motors).forEach(k => delete SIM.motors[k]);
        Object.keys(SIM.pistons).forEach(k => delete SIM.pistons[k]);
        (config.motors  || []).forEach(m => { SIM.motors[m.id]  = { angle: 0, speed: 0 }; });
        (config.pistons || []).forEach(p => { SIM.pistons[p.id] = { extended: false, t: 0 }; });
        if (config.drivetrain) {
          SIM.robot.width  = config.drivetrain.robotWidth  || 15;
          SIM.robot.height = config.drivetrain.robotWidth  || 15;
        }
        if (config.objPath) await simLoadOBJ(config.objPath, config.mtlPath);
        simSetStatus('Config loaded from CAD opener');
      }
    }
    return;
  }

  stlShowLoading('Importing…');
  const result = await window.electronAPI.stlSave(filePath);
  if (result) {
    await refreshSTLLibrary();
    loadSTLModel(result.path, result.name);
  } else {
    stlHideLoading();
  }
}

async function deleteSTLModel(name) {
  if (!confirm(`Delete "${name}" from your library?`)) return;
  await window.electronAPI.stlDelete(name);
  if (STL.activeModel === name) {
    if (STL.group) { STL.scene.remove(STL.group); STL.group = null; }
    STL.activeModel = null;
    document.getElementById('stlEmpty').style.display = 'flex';
    document.getElementById('stlSnapshotBtn').style.display = 'none';
    document.getElementById('stlOrientBtn').style.display = 'none';
    if (STL.orient.active) stlToggleReorient();
  }
  await refreshSTLLibrary();
}

// ─── MODEL ORIENTATION ────────────────────────────────────────────────────────
function stlToggleReorient() {
  STL.orient.active = !STL.orient.active;
  const btn = document.getElementById('stlOrientBtn');
  const panel = document.getElementById('stlOrientPanel');
  const hint = document.getElementById('stlControlsHint');
  if (STL.orient.active) {
    btn.style.background = 'var(--gold)';
    btn.style.color = '#000';
    panel.style.display = '';
    hint.textContent = 'Drag — rotate  ·  Shift+drag — move up/down  ·  Right drag — pan  ·  Scroll — zoom';
  } else {
    btn.style.background = '';
    btn.style.color = '';
    panel.style.display = 'none';
    hint.textContent = 'Left drag — orbit  ·  Right drag — pan  ·  Scroll — zoom';
  }
}

function stlRotateModel(axis, deg) {
  if (!STL.group) return;
  const rad = deg * Math.PI / 180;
  const axes = { x: new THREE.Vector3(1,0,0), y: new THREE.Vector3(0,1,0), z: new THREE.Vector3(0,0,1) };
  STL.group.rotateOnWorldAxis(axes[axis], rad);
  stlSaveOrientation();
}

function stlMoveModel(delta) {
  if (!STL.group) return;
  STL.group.position.y += delta;
  stlSaveOrientation();
}

function stlResetOrientation() {
  if (!STL.group) return;
  STL.group.rotation.set(0, 0, 0);
  STL.group.position.set(0, 0, 0);
  stlSaveOrientation();
}

function stlSaveOrientation() {
  if (!STL.group || !STL.activeModel) return;
  const data = {
    rx: STL.group.rotation.x,
    ry: STL.group.rotation.y,
    rz: STL.group.rotation.z,
    py: STL.group.position.y,
  };
  localStorage.setItem('stl_orient_' + STL.activeModel, JSON.stringify(data));
}

function stlRestoreOrientation() {
  if (!STL.group || !STL.activeModel) return;
  try {
    const raw = localStorage.getItem('stl_orient_' + STL.activeModel);
    if (!raw) return;
    const d = JSON.parse(raw);
    STL.group.rotation.set(d.rx || 0, d.ry || 0, d.rz || 0);
    STL.group.position.y = d.py || 0;
  } catch {}
}

// ─── LOAD MODEL ───────────────────────────────────────────────────────────────
async function loadSTLModel(filePath, name) {
  if (!window.electronAPI || typeof THREE === 'undefined') return;
  stlShowLoading('Loading model…');
  STL.activeModel = name;
  renderSTLLibrary();
  try {
    const resp = await window.electronAPI.stlRead(filePath);
    if (!resp) { stlHideLoading(); return; } // user cancelled large-file warning

    const toAB = u8 => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

    // Parse into array of { geo, mat } — same approach as notebook viewer
    let primitives;
    if (resp.type === 'obj-geo') {
      // Geometry was parsed in the main process via streaming; just build BufferGeometry.
      primitives = resp.groups.map(({ positions, normals, color }) => {
        if (!positions.length) return null;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        if (normals) geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        else geo.computeVertexNormals();
        return { geo, mat: new THREE.MeshStandardMaterial({ color: new THREE.Color(color[0], color[1], color[2]), metalness: 0.15, roughness: 0.65 }) };
      }).filter(Boolean);
      if (!primitives.length) primitives = [{ geo: new THREE.BufferGeometry(), mat: new THREE.MeshStandardMaterial({ color: 0xb8b8b8 }) }];
    } else {
      const geo = STLLoader.parse(toAB(resp.data));
      geo.computeVertexNormals();
      primitives = [{ geo, mat: new THREE.MeshStandardMaterial({ color: 0xb8bec8, metalness: 0.55, roughness: 0.35 }) }];
    }

    // Compute combined bounding box for centering + scaling
    const combined = new THREE.Box3();
    primitives.forEach(({ geo }) => { geo.computeBoundingBox(); combined.union(geo.boundingBox); });
    const center = new THREE.Vector3(); combined.getCenter(center);
    const size = new THREE.Vector3(); combined.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 3 / maxDim;

    // Remove previous model
    if (STL.group) STL.scene.remove(STL.group);
    STL.group = new THREE.Group();

    // Center model at origin (all axes)
    primitives.forEach(({ geo, mat }) => {
      geo.translate(-center.x, -center.y, -center.z);
      geo.scale(scale, scale, scale);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      STL.group.add(mesh);
    });
    STL.scene.add(STL.group);

    // Camera orbits model center; radius fits the scaled model with some margin
    STL.target.set(0, 0, 0);
    STL.spherical = { theta: 0.5, phi: 1.0, radius: maxDim * scale * 1.8 };
    updateSTLCamera();
    stlRestoreOrientation();

    document.getElementById('stlEmpty').style.display = 'none';
    document.getElementById('stlSnapshotBtn').style.display = '';
    document.getElementById('stlOrientBtn').style.display = '';
    // Always leave reorient mode off between loads so the user starts fresh.
    if (STL.orient.active) stlToggleReorient();
    // Keep config in sync with the loaded model path
    STL.activeModelPath = filePath;
    if (filePath.toLowerCase().endsWith('.obj')) {
      if (!STL.cadConfig) cadInitConfig(filePath);
      else STL.cadConfig.objPath = filePath;
      if (STL.cadConfigVisible) cadRenderConfigPanel();
    }
  } catch (err) {
    alert('Failed to load model: ' + err.message);
    console.error('Model load error:', err);
  } finally {
    stlHideLoading();
  }
}

// OBJ + MTL parser for the standalone CAD viewer
function stlParseOBJ(objText, mtlText) {
  const matMap = new Map();
  if (mtlText) {
    let cur = null, kd = null;
    for (const raw of mtlText.split('\n')) {
      const t = raw.trim();
      if (t.startsWith('newmtl ')) {
        if (cur !== null) matMap.set(cur, kd || [0.8,0.8,0.8]);
        cur = t.slice(7).trim(); kd = null;
      } else if (t.startsWith('Kd ')) {
        const p = t.split(/\s+/); kd = [+p[1],+p[2],+p[3]];
      }
    }
    if (cur !== null) matMap.set(cur, kd || [0.8,0.8,0.8]);
  }
  const makeMat = name => {
    const c = matMap.get(name) || [0.72,0.74,0.78];
    return new THREE.MeshStandardMaterial({ color: new THREE.Color(c[0],c[1],c[2]), metalness: 0.15, roughness: 0.65 });
  };

  const vPos = [], vNor = [], groups = new Map();
  let curMat = '__default__';
  for (const raw of objText.split('\n')) {
    const t = raw.trim();
    if (t.startsWith('v ') && t[1]===' ') { const p=t.split(/\s+/); vPos.push(+p[1],+p[2],+p[3]); }
    else if (t.startsWith('vn ')) { const p=t.split(/\s+/); vNor.push(+p[1],+p[2],+p[3]); }
    else if (t.startsWith('usemtl ')) { curMat=t.slice(7).trim(); }
    else if (t.startsWith('f ')) {
      if (!groups.has(curMat)) groups.set(curMat,{pos:[],nor:[]});
      const g=groups.get(curMat);
      const face=t.slice(2).trim().split(/\s+/).map(tok=>{const pts=tok.split('/');return{vi:(+pts[0]-1)*3,ni:pts[2]?(+pts[2]-1)*3:-1};});
      for (let i=1;i<face.length-1;i++) for (const v of [face[0],face[i],face[i+1]]) {
        g.pos.push(vPos[v.vi],vPos[v.vi+1],vPos[v.vi+2]);
        if (v.ni>=0) g.nor.push(vNor[v.ni],vNor[v.ni+1],vNor[v.ni+2]);
      }
    }
  }
  const results = [];
  for (const [name,g] of groups) {
    if (!g.pos.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(g.pos),3));
    if (g.nor.length===g.pos.length) geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(g.nor),3));
    else geo.computeVertexNormals();
    results.push({geo, mat: makeMat(name)});
  }
  return results.length ? results : [{geo:new THREE.BufferGeometry(), mat:makeMat('__default__')}];
}

// ─── BASE64 DECODE HELPER ─────────────────────────────────────────────────────
function base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ─── SNAPSHOT ─────────────────────────────────────────────────────────────────
async function stlSnapshot() {
  if (!STL.renderer || !window.electronAPI?.snapshotSave) return;
  STL.renderer.render(STL.scene, STL.camera);
  const dataUrl = document.getElementById('stlCanvas').toDataURL('image/png');
  const saved = await window.electronAPI.snapshotSave(dataUrl);
  if (saved) setSt(`Snapshot saved: ${saved}`, 'live');
}

// ─── LOADING UI ───────────────────────────────────────────────────────────────
function stlShowLoading(msg) {
  const el = document.getElementById('stlLoading');
  const msgEl = document.getElementById('stlLoadingMsg');
  if (el) { el.style.display = 'flex'; }
  if (msgEl) msgEl.textContent = msg || 'Loading…';
  if (typeof showToast === 'function') showToast(msg || 'Loading…');
}
function stlHideLoading() {
  const el = document.getElementById('stlLoading');
  if (el) el.style.display = 'none';
  if (typeof showToast === 'function') showToast('Model ready', 'ok', 1800);
}

// ─── CAD CONFIG PANEL ─────────────────────────────────────────────────────────
function stlToggleConfigPanel() {
  STL.cadConfigVisible = !STL.cadConfigVisible;
  const panel = document.getElementById('stlConfigPanel');
  const btn   = document.getElementById('stlConfigBtn');
  if (!panel) return;
  if (STL.cadConfigVisible) {
    if (!STL.cadConfig) cadInitConfig(STL.activeModelPath || '');
    panel.style.display = 'flex';
    if (btn) { btn.style.background = 'var(--gold)'; btn.style.color = '#fff'; }
    cadRenderConfigPanel();
  } else {
    panel.style.display = 'none';
    if (btn) { btn.style.background = ''; btn.style.color = ''; }
  }
  // Resize renderer to fit the viewport after panel toggle
  requestAnimationFrame(() => {
    const vp = document.getElementById('stlViewport');
    if (STL.renderer && vp) {
      STL.renderer.setSize(vp.offsetWidth, vp.offsetHeight);
      if (STL.camera) {
        STL.camera.aspect = vp.offsetWidth / vp.offsetHeight;
        STL.camera.updateProjectionMatrix();
      }
    }
  });
}

function cadInitConfig(objPath) {
  STL.cadConfig = {
    name: STL.activeModel || 'Robot',
    objPath: objPath || '',
    drivetrain: {
      type: 'tank',
      wheelDiameter: 3.25,
      maxRPM: 450,
      trackWidth: 12,
      robotWidth: 15,
      robotLength: 15,
      gearRatio: 1.0,
    },
    motors: [],
    pistons: [],
    sensors: {
      imuPort: 10,
      odomWheelDia: 2.75,
      odomTrackWidth: 7.0,
      leftEncoderPort: 1,
      rightEncoderPort: 2,
      midEncoderPort: 3,
    },
  };
}

function cadRenderConfigPanel() {
  const c = STL.cadConfig;
  if (!c) return;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('cadCfgName',         c.name || '');
  set('cadCfgDriveType',    c.drivetrain?.type        || 'tank');
  set('cadCfgWheelDia',     c.drivetrain?.wheelDiameter ?? 3.25);
  set('cadCfgMaxRpm',       c.drivetrain?.maxRPM         ?? 450);
  set('cadCfgTrackWidth',   c.drivetrain?.trackWidth      ?? 12);
  set('cadCfgRobotWidth',   c.drivetrain?.robotWidth      ?? 15);
  set('cadCfgRobotLength',  c.drivetrain?.robotLength     ?? 15);
  set('cadCfgGearRatio',    c.drivetrain?.gearRatio       ?? 1.0);
  set('cadCfgImuPort',      c.sensors?.imuPort            ?? 10);
  set('cadCfgOdomWheelDia', c.sensors?.odomWheelDia       ?? 2.75);
  set('cadCfgOdomTrackWidth',c.sensors?.odomTrackWidth    ?? 7.0);
  set('cadCfgLeftEnc',      c.sensors?.leftEncoderPort    ?? 1);
  set('cadCfgRightEnc',     c.sensors?.rightEncoderPort   ?? 2);
  set('cadCfgMidEnc',       c.sensors?.midEncoderPort     ?? 3);

  cadRenderMotors();
  cadRenderPistons();
}

function cadRenderMotors() {
  const el = document.getElementById('cadMotorList');
  if (!el || !STL.cadConfig) return;
  const motors = STL.cadConfig.motors || [];
  if (!motors.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--t3);padding:4px 0;">No motors — click + Add</div>';
    return;
  }
  el.innerHTML = motors.map((m, i) => `
    <div style="background:var(--s3);border:1px solid var(--b1);border-radius:5px;padding:7px 8px;margin-bottom:6px;">
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:5px;">
        <input class="ann-input" placeholder="Motor ID" value="${m.id || ''}" style="flex:1;"
          oninput="STL.cadConfig.motors[${i}].id=this.value"/>
        <button class="ann-del" onclick="cadRemoveMotor(${i})">✕</button>
      </div>
      <div style="margin-bottom:4px;">
        <label style="font-size:10px;color:var(--t3);">Mesh Name (from OBJ)</label>
        <input class="ann-input" placeholder="e.g. left_wheel" value="${m.meshName || ''}" style="width:100%;margin-top:2px;"
          oninput="STL.cadConfig.motors[${i}].meshName=this.value"/>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:4px;">
        <div><label style="font-size:10px;color:var(--t3);">Port</label>
          <input type="number" class="ann-input" value="${m.port ?? ''}" placeholder="1–21" style="width:100%;margin-top:2px;"
            oninput="STL.cadConfig.motors[${i}].port=+this.value"/>
        </div>
        <div><label style="font-size:10px;color:var(--t3);">RPM</label>
          <input type="number" class="ann-input" value="${m.rpm ?? 600}" style="width:100%;margin-top:2px;"
            oninput="STL.cadConfig.motors[${i}].rpm=+this.value"/>
        </div>
        <div><label style="font-size:10px;color:var(--t3);">Axis</label>
          <select class="ann-input" style="width:100%;margin-top:2px;" oninput="STL.cadConfig.motors[${i}].axis=this.value">
            <option value="x" ${m.axis==='x'?'selected':''}>X</option>
            <option value="y" ${m.axis==='y'?'selected':''}>Y</option>
            <option value="z" ${m.axis==='z'?'selected':''}>Z</option>
          </select>
        </div>
        <div><label style="font-size:10px;color:var(--t3);">Role</label>
          <select class="ann-input" style="width:100%;margin-top:2px;" oninput="STL.cadConfig.motors[${i}].role=this.value">
            <option value="drive"    ${m.role==='drive'   ?'selected':''}>Drive</option>
            <option value="intake"   ${m.role==='intake'  ?'selected':''}>Intake</option>
            <option value="lift"     ${m.role==='lift'    ?'selected':''}>Lift</option>
            <option value="flywheel" ${m.role==='flywheel'?'selected':''}>Flywheel</option>
            <option value="other"    ${m.role==='other'   ?'selected':''}>Other</option>
          </select>
        </div>
      </div>
      <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--t2);cursor:pointer;">
        <input type="checkbox" ${m.reversed?'checked':''} onchange="STL.cadConfig.motors[${i}].reversed=this.checked"/>
        Reversed
      </label>
    </div>`).join('');
}

function cadRenderPistons() {
  const el = document.getElementById('cadPistonList');
  if (!el || !STL.cadConfig) return;
  const pistons = STL.cadConfig.pistons || [];
  if (!pistons.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--t3);padding:4px 0;">No pistons — click + Add</div>';
    return;
  }
  el.innerHTML = pistons.map((p, i) => `
    <div style="background:var(--s3);border:1px solid var(--b1);border-radius:5px;padding:7px 8px;margin-bottom:6px;">
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:5px;">
        <input class="ann-input" placeholder="Piston ID" value="${p.id || ''}" style="flex:1;"
          oninput="STL.cadConfig.pistons[${i}].id=this.value"/>
        <button class="ann-del" onclick="cadRemovePiston(${i})">✕</button>
      </div>
      <div style="margin-bottom:4px;">
        <label style="font-size:10px;color:var(--t3);">Mesh Name (from OBJ)</label>
        <input class="ann-input" placeholder="e.g. piston_arm" value="${p.meshName || ''}" style="width:100%;margin-top:2px;"
          oninput="STL.cadConfig.pistons[${i}].meshName=this.value"/>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;">
        <div><label style="font-size:10px;color:var(--t3);">Port</label>
          <input class="ann-input" value="${p.port ?? ''}" placeholder="A–H" style="width:100%;margin-top:2px;"
            oninput="STL.cadConfig.pistons[${i}].port=this.value"/>
        </div>
        <div><label style="font-size:10px;color:var(--t3);">Axis</label>
          <select class="ann-input" style="width:100%;margin-top:2px;" oninput="STL.cadConfig.pistons[${i}].axis=this.value">
            <option value="x" ${p.axis==='x'?'selected':''}>X</option>
            <option value="y" ${p.axis==='y'?'selected':''}>Y</option>
            <option value="z" ${p.axis==='z'?'selected':''}>Z</option>
          </select>
        </div>
        <div><label style="font-size:10px;color:var(--t3);">Stroke (in)</label>
          <input type="number" class="ann-input" value="${p.stroke ?? 2.5}" step="0.5" style="width:100%;margin-top:2px;"
            oninput="STL.cadConfig.pistons[${i}].stroke=+this.value"/>
        </div>
        <div><label style="font-size:10px;color:var(--t3);">Pressure (psi)</label>
          <input type="number" class="ann-input" value="${p.pressure ?? 100}" style="width:100%;margin-top:2px;"
            oninput="STL.cadConfig.pistons[${i}].pressure=+this.value"/>
        </div>
      </div>
    </div>`).join('');
}

function cadAddMotor() {
  if (!STL.cadConfig) return;
  STL.cadConfig.motors.push({ id: `motor_${STL.cadConfig.motors.length + 1}`, meshName: '', port: STL.cadConfig.motors.length + 1, rpm: 600, axis: 'x', role: 'drive', reversed: false });
  cadRenderMotors();
}

function cadRemoveMotor(i) {
  if (!STL.cadConfig) return;
  STL.cadConfig.motors.splice(i, 1);
  cadRenderMotors();
}

function cadAddPiston() {
  if (!STL.cadConfig) return;
  STL.cadConfig.pistons.push({ id: `piston_${STL.cadConfig.pistons.length + 1}`, meshName: '', port: String.fromCharCode(65 + STL.cadConfig.pistons.length), axis: 'z', stroke: 2.5, pressure: 100 });
  cadRenderPistons();
}

function cadRemovePiston(i) {
  if (!STL.cadConfig) return;
  STL.cadConfig.pistons.splice(i, 1);
  cadRenderPistons();
}

function cadSyncFromForm() {
  if (!STL.cadConfig) return;
  const v = id => { const el = document.getElementById(id); return el ? el.value : null; };
  const n = id => { const el = document.getElementById(id); return el ? +el.value : null; };
  STL.cadConfig.name = v('cadCfgName') || 'Robot';
  STL.cadConfig.drivetrain.type          = v('cadCfgDriveType') || 'tank';
  STL.cadConfig.drivetrain.wheelDiameter = n('cadCfgWheelDia')   ?? 3.25;
  STL.cadConfig.drivetrain.maxRPM        = n('cadCfgMaxRpm')     ?? 450;
  STL.cadConfig.drivetrain.trackWidth    = n('cadCfgTrackWidth') ?? 12;
  STL.cadConfig.drivetrain.robotWidth    = n('cadCfgRobotWidth') ?? 15;
  STL.cadConfig.drivetrain.robotLength   = n('cadCfgRobotLength') ?? 15;
  STL.cadConfig.drivetrain.gearRatio     = n('cadCfgGearRatio')  ?? 1.0;
  STL.cadConfig.sensors.imuPort          = n('cadCfgImuPort')    ?? 10;
  STL.cadConfig.sensors.odomWheelDia     = n('cadCfgOdomWheelDia') ?? 2.75;
  STL.cadConfig.sensors.odomTrackWidth   = n('cadCfgOdomTrackWidth') ?? 7.0;
  STL.cadConfig.sensors.leftEncoderPort  = n('cadCfgLeftEnc')    ?? 1;
  STL.cadConfig.sensors.rightEncoderPort = n('cadCfgRightEnc')   ?? 2;
  STL.cadConfig.sensors.midEncoderPort   = n('cadCfgMidEnc')     ?? 3;
}

async function cadLoadConfig() {
  if (!window.electronAPI?.simLoadConfig) return;
  const config = await window.electronAPI.simLoadConfig();
  if (!config) return;
  STL.cadConfig = {
    name: config.name || STL.activeModel || 'Robot',
    objPath: config.objPath || '',
    drivetrain: {
      type:         config.drivetrain?.type          || 'tank',
      wheelDiameter:config.drivetrain?.wheelDiameter ?? 3.25,
      maxRPM:       config.drivetrain?.cartridge     || config.drivetrain?.maxRPM || 450,
      trackWidth:   config.drivetrain?.trackWidth    ?? 12,
      robotWidth:   config.drivetrain?.robotWidth    ?? 15,
      robotLength:  config.drivetrain?.robotLength   ?? 15,
      gearRatio:    config.drivetrain?.externalGearRatio || config.drivetrain?.gearRatio || 1.0,
    },
    motors:  (config.motors  || []).map(m => ({ id: m.id, meshName: m.meshName || '', port: m.port || 1, rpm: m.rpm || parseInt(m.cartridge) || 600, axis: m.axis || 'x', role: m.role || 'drive', reversed: !!m.reversed })),
    pistons: (config.pistons || []).map(p => ({ id: p.id, meshName: p.meshName || '', port: p.port || 'A', axis: p.axis || 'z', stroke: p.stroke || 2.5, pressure: p.pressure || 100 })),
    sensors: {
      imuPort:          config.sensors?.imuPort          ?? 10,
      odomWheelDia:     config.sensors?.odomWheelDia     ?? 2.75,
      odomTrackWidth:   config.sensors?.odomTrackWidth   ?? 7.0,
      leftEncoderPort:  config.sensors?.leftEncoderPort  ?? 1,
      rightEncoderPort: config.sensors?.rightEncoderPort ?? 2,
      midEncoderPort:   config.sensors?.midEncoderPort   ?? 3,
    },
  };
  cadRenderConfigPanel();
}

async function cadSaveConfig() {
  cadSyncFromForm();
  if (!STL.cadConfig) return;
  if (window.electronAPI?.simSaveConfig) {
    const ok = await window.electronAPI.simSaveConfig(STL.cadConfig);
    if (ok) setSt('Config saved', 'live');
  } else {
    const blob = new Blob([JSON.stringify(STL.cadConfig, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (STL.cadConfig.name || 'robot') + '_config.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

// ─── ANALYSIS PAGE ────────────────────────────────────────────────────────────

const AN = {
  myTeamNum: '',     // e.g. "12345A"
  myTeamId:  null,   // RE team ID
  myRegion:  '',
  myCountry: '',
  regionOverride: '',
  seasonId:       null,
  seasonName:     '',
  seasonOverride: null, // user-supplied season ID
  myStats:   null,
  teams:     [],     // [{ team, skills, rankings, matches, computed }]
  sortBy:    'mmr',
  searchQuery: '',
  loading:   false,
  loaded:    false,
  events:    [],
  eventsLoaded: false,
  filterEventId: null,
  detailEntry:   null,
  compareTeams:  [],   // team IDs selected for comparison (max 5)
};
let anDetailCharts  = [];
let anCompareCharts = [];

function openAnalysis() {
  const page = document.getElementById('analysisPage');
  if (!page) return;
  page.style.display = 'flex';
  AN.myTeamNum = ls('vs_myteam') || '';
  if (AN.myTeamNum && !AN.loaded) loadAnalysisData(false);
  else if (!AN.myTeamNum) anRenderEmpty('Open <strong>Settings</strong> and enter your team number to load regional data.');
}
function closeAnalysis() {
  anBackToList();
  anCloseCompare();
  const page = document.getElementById('analysisPage');
  if (page) page.style.display = 'none';
  const hp = document.getElementById('homePage'); if (hp) hp.style.display = 'flex';
}

// ── helpers ──────────────────────────────────────────────────────────────────

function anSkel(w) { return `<span class="an-skel" style="width:${w}px;"></span>`; }

function anComputeMMR(teamId, apiMatches) {
  const tid = Number(teamId);
  let mmr = 1000, played = 0;
  (apiMatches || []).forEach(m => {
    if (m.round === 1) return; // skip practice matches
    const myA  = (m.alliances || []).find(a => (a.teams || []).some(t => t.team && Number(t.team.id) === tid));
    const oppA = (m.alliances || []).find(a => !(a.teams || []).some(t => t.team && Number(t.team.id) === tid));
    const ms = myA?.score  != null ? Number(myA.score)  : null;
    const os = oppA?.score != null ? Number(oppA.score) : null;
    if (ms === null || os === null) return; // unscored match
    played++;
    const margin = Math.abs(ms - os);
    const bonus  = Math.min(20, Math.floor(margin / 5));
    if (ms > os)      mmr += 30 + bonus;
    else if (ms < os) mmr -= 25 - Math.min(10, bonus);
  });
  return played > 0 ? Math.round(mmr) : null;
}

function anComputeStats(teamId, skills, rankings, matches) {
  // Handle both integer types (0/1) and string types ('programming'/'driver')
  const isDriver = s => s.type === 1 || s.type === '1' || s.type === 'driver';
  const isAuto   = s => s.type === 0 || s.type === '0' || s.type === 'programming';
  const driver   = skills.filter(isDriver).sort((a,b) => b.score-a.score)[0];
  const auto     = skills.filter(isAuto).sort((a,b) => b.score-a.score)[0];
  const combined = (driver?.score ?? 0) + (auto?.score ?? 0);

  let wins=0, losses=0, ties=0, wp=0, ap=0, sp=0;
  let ccwmSum=0, ccwmCount=0;
  let bestRank = Infinity;
  rankings.forEach(r => {
    wins    += r.wins   ?? 0;
    losses  += r.losses ?? 0;
    ties    += r.ties   ?? 0;
    wp      += r.wp     ?? 0;
    ap      += r.ap     ?? 0;
    sp      += r.sp     ?? 0;
    if (r.ccwm != null) { ccwmSum += Number(r.ccwm); ccwmCount++; }
    if (r.rank && r.rank < bestRank) bestRank = r.rank;
  });
  const total   = wins + losses + ties;
  const winRate = total > 0 ? wins / total : null;
  const ccwm    = ccwmCount > 0 ? +(ccwmSum / ccwmCount).toFixed(2) : null;
  const events  = rankings.length;
  const mmr     = anComputeMMR(teamId, matches);

  return { combined, driver: driver?.score ?? null, auto: auto?.score ?? null,
           wins, losses, ties, winRate, wp, ap, sp, ccwm,
           bestRank: isFinite(bestRank) ? bestRank : null, events, mmr };
}

function anComputeComposite(stats, maxSkills, maxWinRate) {
  // Normalized 0–100 across three metrics (weights: skills 40%, winrate 40%, events 20%)
  const sNorm = maxSkills  > 0 ? (stats.combined / maxSkills)  * 100 : 0;
  const wNorm = maxWinRate > 0 ? ((stats.winRate ?? 0) / maxWinRate) * 100 : 0;
  const eNorm = Math.min(stats.events / 6, 1) * 100; // 6 events = "full season"
  return Math.round(sNorm * 0.4 + wNorm * 0.4 + eNorm * 0.2);
}

// ── data loading ──────────────────────────────────────────────────────────────

async function loadAnalysisData(force = false) {
  AN.myTeamNum = ls('vs_myteam') || '';
  if (!AN.myTeamNum) { anRenderEmpty('Open <strong>Settings</strong> and enter your team number to load regional data.'); return; }
  if (!S.re)         { anRenderEmpty('Open <strong>Settings</strong> and enter your RobotEvents API token.'); return; }
  if (AN.loading) return;
  if (AN.loaded && !force) { anRenderTable(); return; }

  AN.loading = true;
  AN.loaded  = false;
  AN.teams   = [];
  AN.myStats = null;
  if (force) AN.seasonId = null; // force re-fetch of active season

  anRenderLoadingState();

  try {
    // 1. Resolve season ID — always fetch from API to avoid inheriting the wrong season
    //    from a previously loaded scouting event (CURRENT_SEASON_ID can be stale).
    //    A manual seasonOverride always wins.
    if (force || !AN.seasonId) {
      if (AN.seasonOverride) {
        AN.seasonId   = AN.seasonOverride;
        AN.seasonName = `Season ${AN.seasonOverride} (override)`;
      } else {
        const s = await rg('/seasons', {'program[]': 1, active: true, per_page: 1});
        AN.seasonId   = s.data?.[0]?.id   ?? null;
        AN.seasonName = s.data?.[0]?.name ?? '';
      }
    }
    if (!AN.seasonId) throw new Error('Could not determine current season.');

    // 2. Look up my team
    const teamSearch = await rg('/teams', {'number[]': AN.myTeamNum, 'program[]': 1});
    const myTeam = teamSearch.data?.[0];
    if (!myTeam) throw new Error(`Team "${AN.myTeamNum}" not found.`);
    AN.myTeamId  = myTeam.id;
    AN.myRegion  = myTeam.location?.region  || '';
    AN.myCountry = myTeam.location?.country || '';

    // Update region + season badge
    const badge = document.getElementById('anRegionBadge');
    const displayRegion = AN.regionOverride || AN.myRegion || AN.myCountry || 'Unknown Region';
    const displaySeason = AN.seasonName || (AN.seasonId ? `Season ${AN.seasonId}` : '');
    if (badge) badge.textContent = `${AN.myTeamNum} · ${displayRegion}${AN.regionOverride ? ' (override)' : ''} · ${displaySeason}`;
    // Also update season sidebar
    const sb = document.getElementById('anSeasonBadge');
    if (sb) sb.textContent = AN.seasonName ? `${AN.seasonName} (ID: ${AN.seasonId})` : AN.seasonId ? `ID: ${AN.seasonId}` : 'Unknown';

    // 3. Fetch my team's stats (skills + rankings + matches for MMR)
    const [mySkills, myRankings, myMatches] = await Promise.all([
      ra(`/teams/${AN.myTeamId}/skills`, {'season[]': AN.seasonId}).catch(()=>[]),
      ra(`/teams/${AN.myTeamId}/rankings`, {'season[]': AN.seasonId}).catch(()=>[]),
      ra(`/teams/${AN.myTeamId}/matches`,  {'season[]': AN.seasonId}).catch(()=>[]),
    ]);
    AN.myStats = anComputeStats(AN.myTeamId, mySkills, myRankings, myMatches);

    // Render my card immediately
    anRenderMyCard();

    // 4. Discover regional teams via event rosters (more reliable than /teams?region[] filter)
    const effectiveRegion  = AN.regionOverride || AN.myRegion;
    const effectiveCountry = AN.regionOverride ? '' : AN.myCountry;
    const evtParams = {'program[]': 1, 'season[]': AN.seasonId, per_page: 250};
    if (effectiveRegion)  evtParams['region']  = effectiveRegion;
    if (effectiveCountry) evtParams['country'] = effectiveCountry;
    const regionalEvents = await ra('/events', evtParams);
    if (!regionalEvents.length) throw new Error(`No events found for "${effectiveRegion || effectiveCountry}". Try the Change Region override.`);

    const teamMap = new Map();
    teamMap.set(myTeam.id, myTeam);
    const EVT_BATCH = 5;
    for (let i = 0; i < regionalEvents.length; i += EVT_BATCH) {
      await Promise.all(regionalEvents.slice(i, i + EVT_BATCH).map(async ev => {
        try {
          const evTeams = await ra(`/events/${ev.id}/teams`, {per_page: 250});
          evTeams
            .filter(t => t.grade === 'High School')
            .forEach(t => { if (!teamMap.has(t.id)) teamMap.set(t.id, t); });
        } catch {}
      }));
    }
    const allTeams = Array.from(teamMap.values());

    // Deduplicate and show skeletons
    AN.teams = allTeams.map(t => ({ team: t, skills: null, rankings: null, computed: null }));
    // Put my team first in the internal array
    const myIdx = AN.teams.findIndex(t => t.team.id === AN.myTeamId);
    if (myIdx > 0) { const [me] = AN.teams.splice(myIdx, 1); AN.teams.unshift(me); }
    else if (myIdx === -1) { AN.teams.unshift({ team: myTeam, skills: mySkills, rankings: myRankings, computed: null }); }

    // Pre-fill my own data
    const mine = AN.teams.find(t => t.team.id === AN.myTeamId);
    if (mine) { mine.skills = mySkills; mine.rankings = myRankings; mine.matches = myMatches; mine.computed = AN.myStats; }

    anRenderTable(); // show skeletons for unloaded teams

    // 5. Batch-fetch remaining teams (groups of 5, skip mine; 3 parallel calls each)
    const others = AN.teams.filter(t => t.team.id !== AN.myTeamId);
    const BATCH = 5;
    for (let i = 0; i < others.length; i += BATCH) {
      const batch = others.slice(i, i + BATCH);
      await Promise.all(batch.map(async entry => {
        try {
          const [sk, rk, mk] = await Promise.all([
            ra(`/teams/${entry.team.id}/skills`, {'season[]': AN.seasonId}).catch(()=>[]),
            ra(`/teams/${entry.team.id}/rankings`, {'season[]': AN.seasonId}).catch(()=>[]),
            ra(`/teams/${entry.team.id}/matches`,  {'season[]': AN.seasonId}).catch(()=>[]),
          ]);
          entry.skills   = sk;
          entry.rankings = rk;
          entry.matches  = mk;
          entry.computed = anComputeStats(entry.team.id, sk, rk, mk);
        } catch { entry.computed = { combined:0, winRate:null, bestRank:null, events:0, mmr:null }; }
      }));
      anRenderTable(); // refresh after each batch
    }

    AN.loaded  = true;
  } catch(e) {
    anRenderEmpty(`Error: ${e.message}`);
  } finally {
    AN.loading = false;
  }
}

// ── rendering ─────────────────────────────────────────────────────────────────

function anRenderEmpty(html) {
  const body = document.getElementById('anTableBody');
  if (body) body.innerHTML = `<tr><td colspan="8" style="padding:40px;text-align:center;color:var(--t3);font-size:13px;">${html}</td></tr>`;
  const card = document.getElementById('anMyCardContent');
  if (card && !AN.myStats) card.innerHTML = `<div style="font-size:12px;color:var(--t3);text-align:center;padding:20px 0;">${html}</div>`;
}

function anRenderLoadingState() {
  const body = document.getElementById('anTableBody');
  if (!body) return;
  body.innerHTML = Array.from({length: 12}, (_, i) => `
    <tr style="border-bottom:1px solid var(--b1);">
      <td style="padding:10px;">${anSkel(20)}</td>
      <td style="padding:10px;">${anSkel(50)}</td>
      <td style="padding:10px;">${anSkel(100)}</td>
      <td style="padding:10px;text-align:right;">${anSkel(30)}</td>
      <td style="padding:10px;text-align:right;">${anSkel(35)}</td>
      <td style="padding:10px;text-align:right;">${anSkel(25)}</td>
      <td style="padding:10px;text-align:right;">${anSkel(20)}</td>
      <td style="padding:10px;text-align:right;">${anSkel(30)}</td>
    </tr>`).join('');
}

function anRenderMyCard() {
  const el = document.getElementById('anMyCardContent');
  if (!el || !AN.myStats) return;
  const s = AN.myStats;
  const wr = s.winRate !== null ? (s.winRate * 100).toFixed(1) + '%' : '—';
  el.innerHTML = `
    <div style="font-family:var(--fd);font-size:22px;font-weight:900;color:var(--gold);">${AN.myTeamNum}</div>
    <div style="font-size:11px;color:var(--t3);margin-bottom:12px;">${AN.myRegion || AN.myCountry || ''}</div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      <div style="background:var(--s2);border-radius:6px;padding:9px 10px;">
        <div style="font-size:10px;color:var(--t3);font-family:var(--fd);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">Robot Skills</div>
        <div style="font-size:20px;font-weight:700;color:var(--gold);">${s.combined || '—'}</div>
        <div style="font-size:10px;color:var(--t3);margin-top:2px;">Driver ${s.driver ?? '—'} · Auto ${s.auto ?? '—'}</div>
      </div>
      <div style="background:var(--s2);border-radius:6px;padding:9px 10px;">
        <div style="font-size:10px;color:var(--t3);font-family:var(--fd);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">Season Record</div>
        <div style="font-size:16px;font-weight:700;"><span style="color:#22c55e;">${s.wins}W</span> <span style="color:var(--t3);">${s.losses}L ${s.ties}T</span></div>
        <div style="font-size:10px;color:var(--t3);margin-top:2px;">Win Rate ${wr}</div>
      </div>
      <div style="background:var(--s2);border-radius:6px;padding:9px 10px;">
        <div style="font-size:10px;color:var(--t3);font-family:var(--fd);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">Events</div>
        <div style="font-size:20px;font-weight:700;">${s.events}</div>
        <div style="font-size:10px;color:var(--t3);margin-top:2px;">Best rank ${s.bestRank ?? '—'}</div>
      </div>
    </div>`;
}

function anRenderTable() {
  const body = document.getElementById('anTableBody');
  const meta = document.getElementById('anTableMeta');
  if (!body) return;

  // Apply event filter and search query
  const q = (AN.searchQuery || '').trim().toLowerCase();
  const visible = AN.teams.filter(t => {
    if (t._filteredOut) return false;
    if (q) {
      const num  = (t.team.number       || '').toLowerCase();
      const org  = (t.team.organization || '').toLowerCase();
      const name = (t.team.name         || '').toLowerCase();
      if (!num.includes(q) && !org.includes(q) && !name.includes(q)) return false;
    }
    return true;
  });

  // Compute normalisation maxes across visible teams with data
  const withData = visible.filter(t => t.computed);
  const maxSkills  = Math.max(1, ...withData.map(t => t.computed.combined));
  const maxWinRate = Math.max(0.01, ...withData.map(t => t.computed.winRate ?? 0));

  // Assign composite scores (used as MMR fallback for teams with no matches)
  AN.teams.forEach(t => {
    if (t.computed) t.computed.composite = anComputeComposite(t.computed, maxSkills, maxWinRate);
  });

  // Sort visible teams
  const sorted = [...visible].sort((a, b) => {
    if (!a.computed && !b.computed) return 0;
    if (!a.computed) return 1;
    if (!b.computed) return -1;
    const key = AN.sortBy;
    if (key === 'mmr') {
      // Teams with real MMR rank above teams without; use composite as tie-breaker
      const aV = a.computed.mmr ?? (a.computed.composite * 0.5);
      const bV = b.computed.mmr ?? (b.computed.composite * 0.5);
      return bV - aV;
    }
    if (key === 'skills')  return (b.computed.combined ?? 0) - (a.computed.combined ?? 0);
    if (key === 'winrate') return (b.computed.winRate  ?? -1) - (a.computed.winRate  ?? -1);
    if (key === 'events')  return (b.computed.events   ?? 0) - (a.computed.events    ?? 0);
    return 0;
  });


  let rank = 0;
  body.innerHTML = sorted.map(entry => {
    const isMine = entry.team.id === AN.myTeamId;
    const t = entry.team;
    const c = entry.computed;
    rank++;

    const skillsCell   = c ? (c.combined || '—') : anSkel(30);
    const wrCell       = c ? (c.winRate !== null ? (c.winRate*100).toFixed(1)+'%' : '—') : anSkel(35);
    const bestRankCell = c ? (c.bestRank ?? '—') : anSkel(25);
    const eventsCell   = c ? c.events : anSkel(20);
    const mmrCell      = c ? (c.mmr ?? '<span style="color:var(--t3);font-size:10px;">—</span>') : anSkel(30);

    return `<tr class="${isMine ? 'an-row-mine' : ''}" style="border-bottom:1px solid var(--b1);cursor:pointer;" onclick="anShowTeamDetail(${t.id})">
      <td style="padding:9px 10px;color:var(--t3);font-family:var(--fm);">${rank}</td>
      <td style="padding:9px 10px;font-weight:600;color:${isMine ? 'var(--gold)' : 'var(--t1)'};">${t.number || t.name || '?'}</td>
      <td style="padding:9px 10px;color:var(--t2);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.organization || '—'}</td>
      <td style="padding:9px 10px;text-align:right;font-family:var(--fm);color:var(--gold);">${skillsCell}</td>
      <td style="padding:9px 10px;text-align:right;font-family:var(--fm);">${wrCell}</td>
      <td style="padding:9px 10px;text-align:right;font-family:var(--fm);">${bestRankCell}</td>
      <td style="padding:9px 10px;text-align:right;font-family:var(--fm);">${eventsCell}</td>
      <td style="padding:9px 10px;text-align:right;font-family:var(--fm);color:${c?.mmr ? 'var(--gold)' : 'var(--t1)'};">${mmrCell}</td>
    </tr>`;
  }).join('');

  const loaded = AN.teams.filter(t => t.computed).length;
  const total  = AN.teams.length;
  if (meta) {
    if (loaded < total) {
      meta.textContent = `Loading ${loaded}/${total}…`;
    } else {
      const region = AN.myRegion || AN.myCountry || 'Region';
      const filterNote = AN.filterEventId !== null ? ` · ${visible.length}/${total} in event` : '';
      const searchNote = q ? ` · ${visible.length} matching` : '';
      meta.textContent = `${total} teams · ${region}${filterNote}${searchNote}`;
    }
  }
}

function anSearch(val) {
  AN.searchQuery = val;
  anRenderTable();
}

function anExportCSV() {
  if (!AN.loaded) { alert('Wait for data to finish loading.'); return; }
  const q = (AN.searchQuery || '').trim().toLowerCase();
  const rows = [['Rank','Team','Organization','Skills','Win%','Best Rank','Events','MMR']];
  let rank = 0;
  const visible = AN.teams
    .filter(t => {
      if (t._filteredOut || !t.computed) return false;
      if (q) {
        const num  = (t.team.number       || '').toLowerCase();
        const org  = (t.team.organization || '').toLowerCase();
        const name = (t.team.name         || '').toLowerCase();
        if (!num.includes(q) && !org.includes(q) && !name.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aV = a.computed.mmr ?? (a.computed.composite * 0.5);
      const bV = b.computed.mmr ?? (b.computed.composite * 0.5);
      return bV - aV;
    });

  visible.forEach(entry => {
    rank++;
    const c = entry.computed;
    const t = entry.team;
    rows.push([
      rank,
      t.number || t.name || '',
      t.organization || '',
      c.combined || 0,
      c.winRate !== null ? (c.winRate * 100).toFixed(1) : '',
      c.bestRank ?? '',
      c.events,
      c.mmr ?? '',
    ]);
  });

  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const region = (AN.myRegion || AN.myCountry || 'region').replace(/\s+/g, '_');
  a.download = `nexus_${region}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function anSetSort(key) {
  AN.sortBy = key;
  document.querySelectorAll('.an-sort-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('anSort_' + key);
  if (btn) btn.classList.add('active');
  anRenderTable();
}

// ── Team notes ────────────────────────────────────────────────────────────────
function anGetNote(teamId) { return localStorage.getItem(`an_note_${teamId}`) || ''; }
function anSaveNote(teamId, text) { localStorage.setItem(`an_note_${teamId}`, text); }

// ── Sidebar: Head-to-Head ─────────────────────────────────────────────────────

function anH2HPreview(val) {
  const hint = document.getElementById('anH2HHint');
  if (!hint) return;
  const num = val.trim().toUpperCase();
  if (!num) { hint.textContent = ''; return; }
  const found = AN.teams.find(t => (t.team.number || '').toUpperCase() === num);
  hint.textContent = found ? found.team.organization || found.team.name || '' : 'Team not found in region';
  hint.style.color = found ? 'var(--t2)' : 'var(--t3)';
}

// ── Team detail (full-screen) ──────────────────────────────────────────────────

function anShowTeamDetail(teamId) {
  const entry = AN.teams.find(t => t.team.id === teamId);
  if (!entry) return;
  AN.detailEntry = entry;

  // Destroy any previous detail charts
  anDetailCharts.forEach(c => { try { c.destroy(); } catch {} });
  anDetailCharts = [];

  // Show overlay + back button
  const dv = document.getElementById('anDetailView');
  if (dv) dv.style.display = 'flex';
  document.getElementById('anBackBtn').style.display  = '';
  document.getElementById('anBackSep').style.display  = '';

  // Reset center tab to charts for each new team
  const dc = document.getElementById('anDetailCenter');
  if (dc) dc.dataset.tab = 'charts';
  anRenderDetailLeft(entry);
  anRenderDetailCenter(entry, 'charts');
  anRenderDetailRight();
}

function anBackToList() {
  anDetailCharts.forEach(c => { try { c.destroy(); } catch {} });
  anDetailCharts = [];
  AN.detailEntry = null;
  const dv = document.getElementById('anDetailView');
  if (dv) dv.style.display = 'none';
  document.getElementById('anBackBtn').style.display = 'none';
  document.getElementById('anBackSep').style.display = 'none';
}

function anGetRankings(entry) {
  const id  = entry.team.id;
  const all = AN.teams.filter(t => t.computed);
  const pos = arr => arr.findIndex(t => t.team.id === id) + 1;
  const byMMR     = [...all].sort((a,b) => (b.computed.mmr     ?? 0)  - (a.computed.mmr     ?? 0));
  const bySkills  = [...all].sort((a,b) => (b.computed.combined?? 0)  - (a.computed.combined?? 0));
  const byWinRate = [...all].sort((a,b) => (b.computed.winRate  ?? -1) - (a.computed.winRate  ?? -1));
  const byEvents  = [...all].sort((a,b) => (b.computed.events   ?? 0)  - (a.computed.events   ?? 0));
  return { mmr: pos(byMMR), skills: pos(bySkills), winrate: pos(byWinRate), events: pos(byEvents), total: all.length };
}

function anGetMatchData(entry) {
  const tid = Number(entry.team.id);

  // Group matches by event
  const eventMap = new Map();
  (entry.matches || []).filter(m => m.round !== 1).forEach(m => {
    const eid = m.event?.id ?? 0;
    if (!eventMap.has(eid)) eventMap.set(eid, { id: eid, name: m.event?.name || 'Unknown Event', start: m.event?.start || '', matches: [] });
    eventMap.get(eid).matches.push(m);
  });

  // Sort events chronologically — use Date.parse so "2025-11-02T..." sorts correctly;
  // fall back to event ID (lower = older) when start is missing or unparseable.
  const ROUND_ORDER = { 1:0, 2:1, 3:2, 6:3 }; // practice, qual, SF, F
  const sortedEvents = [...eventMap.values()].sort((a, b) => {
    const aT = a.start ? Date.parse(a.start) : NaN;
    const bT = b.start ? Date.parse(b.start) : NaN;
    if (!isNaN(aT) && !isNaN(bT) && aT !== bT) return aT - bT;
    return (a.id || 0) - (b.id || 0); // older events have lower IDs
  });

  // Shorten event name to ≤14 chars: strip common prefixes then truncate
  const shortEvt = name => {
    const stripped = name
      .replace(/^VEX\s+Robotics\s+/i, '')
      .replace(/^VRC\s+/i, '')
      .replace(/\s+qualifier\b.*$/i, '')
      .trim();
    return stripped.length > 14 ? stripped.substring(0, 13) + '…' : stripped;
  };

  const result = [];
  sortedEvents.forEach((evData, evIdx) => {
    const short = shortEvt(evData.name);
    const sorted = [...evData.matches].sort((a, b) =>
      (ROUND_ORDER[a.round] ?? a.round) !== (ROUND_ORDER[b.round] ?? b.round)
        ? (ROUND_ORDER[a.round] ?? a.round) - (ROUND_ORDER[b.round] ?? b.round)
        : a.matchnum - b.matchnum
    );
    sorted.forEach(m => {
      const myA  = (m.alliances||[]).find(a=>(a.teams||[]).some(t=>t.team&&Number(t.team.id)===tid));
      const oppA = (m.alliances||[]).find(a=>!(a.teams||[]).some(t=>t.team&&Number(t.team.id)===tid));
      const ms = myA?.score  != null ? Number(myA.score)  : null;
      const os = oppA?.score != null ? Number(oppA.score) : null;
      if (ms === null || os === null) return;
      const res        = ms > os ? 'W' : ms < os ? 'L' : 'T';
      const roundLabel = m.round===6?'F':m.round===3?'SF':m.round===2?'QF':'Q'+m.matchnum;
      result.push({ label: roundLabel, eventName: evData.name, eventShort: short, eventIdx: evIdx, myScore: ms, oppScore: os, result: res });
    });
  });

  return result;
}

function anRenderDetailLeft(entry) {
  const el = document.getElementById('anDetailLeft');
  if (!el) return;
  const t = entry.team;
  const c = entry.computed;
  const isMine = entry.team.id === AN.myTeamId;
  const num = t.number || t.name || '?';
  const wr  = c?.winRate != null ? (c.winRate*100).toFixed(1)+'%' : '—';
  const loc = [t.location?.city, t.location?.region].filter(Boolean).join(', ');

  // Rankings
  let rankHtml = '';
  if (c) {
    const r = anGetRankings(entry);
    const gold = (n) => n <= 3 ? 'var(--gold)' : 'var(--t1)';
    rankHtml = `
      <div style="margin-top:14px;">
        <div style="font-family:var(--fd);font-size:10px;font-weight:700;letter-spacing:0.13em;color:var(--t3);text-transform:uppercase;margin-bottom:6px;">Regional Rankings (${r.total} teams)</div>
        ${[['MMR',gold(r.mmr),r.mmr],['Skills',gold(r.skills),r.skills],['Win Rate',gold(r.winrate),r.winrate],['Events',gold(r.events),r.events]].map(([lbl,col,n])=>`
          <div class="an-rank-row">
            <span style="font-size:11px;color:var(--t3);">${lbl}</span>
            <span style="font-family:var(--fm);font-size:13px;font-weight:700;color:${col};">#${n} <span style="color:var(--t3);font-weight:400;font-size:10px;">/ ${r.total}</span></span>
          </div>`).join('')}
      </div>`;
  }

  // Vs You (only for other teams)
  let vsHtml = '';
  if (!isMine && c && AN.myStats) {
    const me = AN.myStats;
    const diff = (val, myVal, lower=false) => {
      if (val==null||myVal==null) return '';
      const d = val - myVal;
      if (Math.abs(d) < 0.5) return '';
      const good = lower ? d < 0 : d > 0;
      return `<span style="font-size:10px;color:${good?'#22c55e':'#ff7b77'};">(${d>0?'+':''}${Math.round(d)})</span>`;
    };
    vsHtml = `
      <div style="margin-top:14px;">
        <div style="font-family:var(--fd);font-size:10px;font-weight:700;letter-spacing:0.13em;color:var(--t3);text-transform:uppercase;margin-bottom:6px;">vs ${AN.myTeamNum}</div>
        ${[
          ['Skills',    c.combined,  me.combined],
          ['Driver',    c.driver,    me.driver],
          ['Auto',      c.auto,      me.auto],
          ['Win Rate',  c.winRate!=null?(c.winRate*100):null, me.winRate!=null?(me.winRate*100):null],
          ['MMR',       c.mmr,       me.mmr],
          ['CCWM',      c.ccwm,      me.ccwm],
          ['WP',        c.wp,        me.wp],
          ['AP',        c.ap,        me.ap],
          ['SP',        c.sp,        me.sp],
          ['Best Rank', c.bestRank,  me.bestRank, true],
        ].map(([lbl,val,myVal,lower])=>`
          <div class="an-rank-row">
            <span style="font-size:11px;color:var(--t3);">${lbl}</span>
            <span style="font-size:12px;font-family:var(--fm);">${val!=null?(typeof val==='number'&&!Number.isInteger(val)?val.toFixed(1):val):'—'} ${diff(val,myVal,lower)}</span>
          </div>`).join('')}
      </div>`;
  }

  el.innerHTML = `
    <div style="margin-bottom:14px;">
      <div style="font-family:var(--fd);font-size:22px;font-weight:900;color:${isMine?'var(--gold)':'var(--t1)'};">${num}</div>
      <div style="font-size:12px;color:var(--t2);margin-top:2px;">${t.organization||''}</div>
      ${loc?`<div style="font-size:10px;color:var(--t3);margin-top:1px;">${loc}</div>`:''}
    </div>
    ${c ? `
      <div class="an-detail-stat-card">
        <div style="font-size:10px;color:var(--t3);font-family:var(--fd);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">Robot Skills</div>
        <div style="font-size:24px;font-weight:700;color:var(--gold);">${c.combined||'—'}</div>
        <div style="font-size:10px;color:var(--t3);">Driver ${c.driver??'—'} · Auto ${c.auto??'—'}</div>
      </div>
      <div class="an-detail-stat-card">
        <div style="font-size:10px;color:var(--t3);font-family:var(--fd);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">Season Record</div>
        <div style="font-size:18px;font-weight:700;"><span style="color:#22c55e;">${c.wins}W</span> <span style="color:var(--t3);">${c.losses}L ${c.ties}T</span></div>
        <div style="font-size:10px;color:var(--t3);">${wr} · Best rank ${c.bestRank??'—'} · ${c.events} events</div>
      </div>
      <div class="an-detail-stat-card">
        <div style="font-size:10px;color:var(--t3);font-family:var(--fd);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">MMR</div>
        <div style="font-size:24px;font-weight:700;color:${c.mmr?'var(--gold)':'var(--t3)'};">${c.mmr??'—'}</div>
        <div style="font-size:10px;color:var(--t3);">Elo-style · based on ${entry.matches?.length??0} matches</div>
      </div>
    ` : '<div style="font-size:12px;color:var(--t3);padding:20px 0;text-align:center;">Loading stats…</div>'}
    ${rankHtml}
    ${vsHtml}`;
}

function anRenderDetailCenter(entry, tab) {
  // Destroy previous charts on every re-render (tab switch or new team)
  anDetailCharts.forEach(c => { try { c.destroy(); } catch {} });
  anDetailCharts = [];

  const el = document.getElementById('anDetailCenter');
  if (!el) return;

  if (!tab) tab = el.dataset.tab || 'charts';
  el.dataset.tab = tab;

  const tabBar = `<div style="display:flex;border-bottom:1px solid var(--b1);margin-bottom:12px;flex-shrink:0;">
    <button onclick="anRenderDetailCenter(AN.detailEntry,'charts')" style="padding:8px 18px;background:none;border:none;border-bottom:2px solid ${tab==='charts'?'var(--gold)':'transparent'};color:${tab==='charts'?'var(--gold)':'var(--t3)'};cursor:pointer;font-size:12px;font-family:var(--fm);">Charts</button>
    <button onclick="anRenderDetailCenter(AN.detailEntry,'notes')" style="padding:8px 18px;background:none;border:none;border-bottom:2px solid ${tab==='notes'?'var(--gold)':'transparent'};color:${tab==='notes'?'var(--gold)':'var(--t3)'};cursor:pointer;font-size:12px;font-family:var(--fm);">Notes</button>
  </div>`;

  if (tab === 'notes') {
    const teamId = entry.team.id;
    const savedNote = anGetNote(teamId);
    el.innerHTML = tabBar + `
      <div style="display:flex;flex-direction:column;gap:10px;flex:1;">
        <div style="font-size:11px;color:var(--t3);">Notes for <strong style="color:var(--t1);">${entry.team.number || entry.team.name}</strong> — saved automatically to this device.</div>
        <textarea id="anNotepad" style="flex:1;min-height:320px;width:100%;box-sizing:border-box;background:var(--s2);border:1px solid var(--b2);color:var(--t1);font-family:var(--fm);font-size:13px;padding:12px;border-radius:6px;outline:none;resize:vertical;line-height:1.6;"
          oninput="anSaveNote(${teamId},this.value)"
          onfocus="this.style.borderColor='var(--gold)'"
          onblur="this.style.borderColor='var(--b2)'">${savedNote}</textarea>
      </div>`;
    return;
  }

  const matchData = anGetMatchData(entry);

  if (!matchData.length) {
    el.innerHTML = tabBar + `<div class="an-chart-card" style="text-align:center;color:var(--t3);padding:40px;">No scored match data available for this team yet.</div>`;
    return;
  }

  const scores    = matchData.map(m => m.myScore);
  const oppScores = matchData.map(m => m.oppScore);
  const wins      = matchData.filter(m => m.result==='W').length;
  const losses    = matchData.filter(m => m.result==='L').length;
  const ties      = matchData.filter(m => m.result==='T').length;

  // Per-event color palette
  const EVT_COLORS = ['#a855f7','#60a5fa','#22c55e','#f87171','#c084fc','#fb923c','#34d399','#a78bfa'];
  const numEvents  = Math.max(...matchData.map(m => m.eventIdx)) + 1;

  // Unique events in order for legend
  const seenEvts = [];
  matchData.forEach(m => {
    if (!seenEvts.find(e => e.idx === m.eventIdx))
      seenEvts.push({ idx: m.eventIdx, short: m.eventShort, name: m.eventName });
  });

  // Axis labels: show event name only at the first match of each event; blank otherwise
  const axisLabels = matchData.map((m, i) => {
    const isFirst = i === 0 || matchData[i-1].eventIdx !== m.eventIdx;
    return isFirst ? m.eventShort : '';
  });

  // Point colors per match — used by all sequential charts
  const ptColors  = matchData.map(m => EVT_COLORS[m.eventIdx % EVT_COLORS.length]);

  // Running MMR
  let mmr = 1000;
  const mmrHist = matchData.map(m => {
    const margin = Math.abs(m.myScore - m.oppScore);
    const bonus  = Math.min(20, Math.floor(margin/5));
    if (m.result==='W') mmr += 30+bonus;
    else if (m.result==='L') mmr -= 25-Math.min(10,bonus);
    return mmr;
  });

  // Event legend HTML
  const legendHtml = numEvents > 1 ? `
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:4px;padding:6px 8px;background:var(--s2);border-radius:6px;border:1px solid var(--b1);">
      ${seenEvts.map(e => `
        <span style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--t2);">
          <span style="width:10px;height:10px;border-radius:50%;background:${EVT_COLORS[e.idx % EVT_COLORS.length]};flex-shrink:0;"></span>
          <span title="${e.name}">${e.short}</span>
        </span>`).join('')}
    </div>` : '';

  el.innerHTML = tabBar + legendHtml + `
    <div class="an-chart-card">
      <div class="an-chart-title">Match Scores</div>
      <div style="height:150px;position:relative;"><canvas id="anChartScores"></canvas></div>
    </div>
    <div class="an-chart-card">
      <div class="an-chart-title">MMR Progression</div>
      <div style="height:120px;position:relative;"><canvas id="anChartMMR"></canvas></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="an-chart-card">
        <div class="an-chart-title">Win / Loss / Tie</div>
        <div style="height:120px;position:relative;"><canvas id="anChartWL"></canvas></div>
      </div>
      <div class="an-chart-card">
        <div class="an-chart-title">Score Distribution</div>
        <div style="height:120px;position:relative;"><canvas id="anChartDist"></canvas></div>
      </div>
    </div>`;

  const baseOpts  = { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} } };
  const gridColor = 'rgba(255,255,255,0.06)';
  const tickStyle = { color:'#888', font:{ size:10 } };

  // Custom x-axis ticks: event name at first match of each event, blank otherwise
  const xTickOpts = {
    ...tickStyle,
    callback: (_val, idx) => {
      const m = matchData[idx];
      if (!m) return '';
      return idx === 0 || matchData[idx-1].eventIdx !== m.eventIdx ? m.eventShort : '';
    },
    maxRotation: 30,
    autoSkip: false,
  };

  const scalesXY = {
    x: { ticks: xTickOpts, grid: { color: gridColor } },
    y: { ticks: tickStyle, grid: { color: gridColor } },
  };

  // Shared tooltip: show event + round + scores
  const tooltipCallbacks = {
    title: items => {
      const m = matchData[items[0].dataIndex];
      return m ? `${m.eventShort} — ${m.label}` : '';
    },
    afterTitle: items => {
      const m = matchData[items[0].dataIndex];
      return m ? m.eventName : '';
    },
    label: ctx => {
      const m = matchData[ctx.dataIndex];
      if (!m) return `${ctx.parsed.y}`;
      if (ctx.dataset.label === 'My Score')  return `  My score:   ${m.myScore}  (${m.result})`;
      if (ctx.dataset.label === 'Opp Score') return `  Opp score: ${m.oppScore}`;
      return `  ${ctx.dataset.label}: ${ctx.parsed.y}`;
    },
  };

  requestAnimationFrame(() => {
    const ctxS = document.getElementById('anChartScores')?.getContext('2d');
    if (ctxS) anDetailCharts.push(new Chart(ctxS, {
      type:'line',
      data:{ labels: axisLabels, datasets:[
        { label:'My Score',  data:scores,    borderColor:'#a855f7', backgroundColor:'rgba(168,85,247,0.1)', tension:0.3, fill:true,  pointRadius:4, pointHoverRadius:6,
          pointBackgroundColor: ptColors, pointBorderColor: ptColors },
        { label:'Opp Score', data:oppScores, borderColor:'rgba(180,180,180,0.5)', backgroundColor:'transparent', tension:0.3, fill:false, pointRadius:3,
          borderDash:[4,3], pointBackgroundColor:'rgba(180,180,180,0.5)', pointBorderColor:'transparent' },
      ]},
      options:{ ...baseOpts, scales:scalesXY, plugins:{ ...baseOpts.plugins, tooltip:{ callbacks: tooltipCallbacks } } }
    }));

    const ctxM = document.getElementById('anChartMMR')?.getContext('2d');
    if (ctxM) anDetailCharts.push(new Chart(ctxM, {
      type:'line',
      data:{ labels: axisLabels, datasets:[{
        data:mmrHist, borderColor:'#a855f7', backgroundColor:'rgba(168,85,247,0.08)', tension:0.4,
        pointRadius:3, fill:true,
        pointBackgroundColor: ptColors, pointBorderColor: ptColors,
      }]},
      options:{ ...baseOpts, scales:scalesXY,
        plugins:{ ...baseOpts.plugins, tooltip:{ callbacks:{
          title: items => { const m=matchData[items[0].dataIndex]; return m?`${m.eventShort} — ${m.label}`:''; },
          afterTitle: items => { const m=matchData[items[0].dataIndex]; return m?m.eventName:''; },
          label: ctx => `  MMR: ${ctx.parsed.y}`,
        }}}
      }
    }));

    const ctxW = document.getElementById('anChartWL')?.getContext('2d');
    if (ctxW) anDetailCharts.push(new Chart(ctxW, {
      type:'bar',
      data:{ labels:['Wins','Losses','Ties'], datasets:[{ data:[wins,losses,ties], backgroundColor:['#22c55e','#ff7b77','#888'], borderRadius:4 }]},
      options:{ ...baseOpts, scales:{ x:{ ticks:tickStyle, grid:{display:false} }, y:{ ticks:{ ...tickStyle, stepSize:1 }, grid:{ color:gridColor } } } }
    }));

    // Score distribution (histogram in 20-point buckets)
    const buckets = {};
    scores.forEach(s => { const b = Math.floor(s/20)*20; buckets[b] = (buckets[b]||0)+1; });
    const bKeys = Object.keys(buckets).sort((a,b)=>+a-+b);
    const ctxD = document.getElementById('anChartDist')?.getContext('2d');
    if (ctxD) anDetailCharts.push(new Chart(ctxD, {
      type:'bar',
      data:{ labels:bKeys.map(k=>k+'-'+(+k+19)), datasets:[{ data:bKeys.map(k=>buckets[k]), backgroundColor:'rgba(168,85,247,0.6)', borderRadius:3 }]},
      options:{ ...baseOpts, scales:{ x:{ ticks:{ ...tickStyle, maxRotation:45 }, grid:{display:false} }, y:{ ticks:{ ...tickStyle, stepSize:1 }, grid:{ color:gridColor } } } }
    }));
  });
}

function anRenderDetailRight() {
  const el = document.getElementById('anDetailRight');
  if (!el) return;
  const cur    = AN.detailEntry;
  const curId  = cur?.team.id;
  const inCmp  = AN.compareTeams.includes(curId);
  const canAdd = AN.compareTeams.length < 5;

  el.innerHTML = `
    <div style="padding:12px;border-bottom:1px solid var(--b1);">
      <div style="font-family:var(--fd);font-size:10px;font-weight:700;letter-spacing:0.13em;color:var(--t3);text-transform:uppercase;margin-bottom:8px;">Compare</div>
      ${curId && curId !== AN.myTeamId ? `
        <button class="btn-o" onclick="anToggleCompare(${curId})" style="width:100%;box-sizing:border-box;font-size:11px;padding:5px 0;${inCmp?'border-color:var(--gold);color:var(--gold);':''}">
          ${inCmp ? '✓ Added' : canAdd ? '+ Add to Compare' : 'Compare full (5 max)'}
        </button>` : ''}
    </div>
    <div style="padding:12px;flex:1;display:flex;flex-direction:column;gap:4px;">
      <div style="font-size:11px;color:var(--t3);margin-bottom:6px;">${AN.compareTeams.length} / 5 selected</div>
      ${AN.compareTeams.map(id => {
        const e = AN.teams.find(t => t.team.id === id);
        if (!e) return '';
        return `<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:var(--s2);border-radius:4px;cursor:pointer;" onclick="anShowTeamDetail(${id})">
          <span style="flex:1;font-size:12px;font-weight:600;color:${id===curId?'var(--gold)':'var(--t1)'};">${e.team.number||'?'}</span>
          <button onclick="event.stopPropagation();anToggleCompare(${id})" style="background:none;border:none;color:var(--t3);cursor:pointer;font-size:13px;line-height:1;padding:0;">✕</button>
        </div>`;
      }).join('')}
      ${AN.compareTeams.length >= 2 ? `
        <button class="btn-o" onclick="anOpenCompare()" style="width:100%;box-sizing:border-box;font-size:11px;padding:5px 0;margin-top:6px;border-color:var(--gold);color:var(--gold);">
          Compare ${AN.compareTeams.length} Teams ▶
        </button>` : `<div style="font-size:10px;color:var(--t3);margin-top:4px;">Add 2+ teams to compare.</div>`}
    </div>`;
}

function anToggleCompare(teamId) {
  const idx = AN.compareTeams.indexOf(teamId);
  if (idx >= 0) AN.compareTeams.splice(idx, 1);
  else if (AN.compareTeams.length < 5) AN.compareTeams.push(teamId);
  anUpdateCompareBtn();
  anRenderDetailRight();
}

function anUpdateCompareBtn() {
  const btn = document.getElementById('anCompareBtn');
  if (!btn) return;
  if (AN.compareTeams.length >= 2) {
    btn.style.display = '';
    btn.textContent = `Compare (${AN.compareTeams.length})`;
  } else {
    btn.style.display = 'none';
  }
}

function anOpenCompare() {
  const teams = AN.compareTeams.map(id => AN.teams.find(t => t.team.id === id)).filter(Boolean);
  if (teams.length < 2) return;
  anCompareCharts.forEach(c => { try { c.destroy(); } catch {} });
  anCompareCharts = [];
  const cv = document.getElementById('anCompareView');
  if (cv) cv.style.display = 'flex';

  const metrics = [
    { lbl:'Robot Skills', get: c => c.combined ?? null },
    { lbl:'Driver',       get: c => c.driver   ?? null },
    { lbl:'Auto',         get: c => c.auto      ?? null },
    { lbl:'Win Rate',     get: c => c.winRate != null ? +(c.winRate*100).toFixed(1) : null, fmt: v => v+'%' },
    { lbl:'W/L/T',        get: c => null, raw: c => `${c.wins}/${c.losses}/${c.ties}` },
    { lbl:'Best Rank',    get: c => c.bestRank != null ? -c.bestRank : null, fmt: (v,c) => c.bestRank ?? '—', lower:true },
    { lbl:'Events',       get: c => c.events },
    { lbl:'MMR',          get: c => c.mmr ?? null },
  ];

  const cols = `90px ${teams.map(()=>'1fr').join(' ')}`;
  const colors = ['#a855f7','#22c55e','#60a5fa','#f87171','#c084fc'];

  const header = `
    <div style="padding:8px 10px;background:var(--s2);border-bottom:1px solid var(--b1);font-size:10px;color:var(--t3);font-family:var(--fd);text-transform:uppercase;letter-spacing:0.1em;">Stat</div>
    ${teams.map((e,i) => `<div style="padding:8px 10px;background:var(--s2);border-bottom:1px solid var(--b1);text-align:center;font-family:var(--fd);font-size:13px;font-weight:900;color:${colors[i]};">${e.team.number}</div>`).join('')}`;

  const rows = metrics.map(m => {
    const vals = teams.map(e => e.computed ? m.get(e.computed) : null);
    const best = vals.some(v=>v!==null) ? Math.max(...vals.filter(v=>v!==null)) : null;
    return `
      <div style="padding:8px 10px;border-bottom:1px solid var(--b1);font-size:12px;color:var(--t3);">${m.lbl}</div>
      ${teams.map((e,i) => {
        if (!e.computed) return `<div style="padding:8px 10px;border-bottom:1px solid var(--b1);text-align:center;color:var(--t3);">—</div>`;
        const raw  = m.raw ? m.raw(e.computed) : null;
        const val  = m.get(e.computed);
        const disp = raw ?? (m.fmt ? m.fmt(val, e.computed) : (val ?? '—'));
        const hi   = val !== null && val === best;
        return `<div style="padding:8px 10px;border-bottom:1px solid var(--b1);text-align:center;font-size:13px;font-family:var(--fm);${hi?`color:${colors[i]};font-weight:700;`:''}">${disp}</div>`;
      }).join('')}`;
  }).join('');

  const content = document.getElementById('anCompareContent');
  if (!content) return;
  content.innerHTML = `
    <div style="display:grid;grid-template-columns:${cols};border:1px solid var(--b1);border-radius:8px;overflow:hidden;margin-bottom:16px;">
      ${header}${rows}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="an-chart-card"><div class="an-chart-title">Skills Comparison</div><div style="height:180px;position:relative;"><canvas id="anCmpSkills"></canvas></div></div>
      <div class="an-chart-card"><div class="an-chart-title">MMR Comparison</div><div style="height:180px;position:relative;"><canvas id="anCmpMMR"></canvas></div></div>
      <div class="an-chart-card"><div class="an-chart-title">Win Rate (%)</div><div style="height:180px;position:relative;"><canvas id="anCmpWR"></canvas></div></div>
      <div class="an-chart-card"><div class="an-chart-title">Win/Loss/Tie Breakdown</div><div style="height:180px;position:relative;"><canvas id="anCmpWL"></canvas></div></div>
    </div>`;

  const baseOpts = { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} } };
  const tickStyle = { color:'#888', font:{ size:10 } };
  const teamNums  = teams.map(e => e.team.number||'?');

  requestAnimationFrame(() => {
    const bar = (id, data, bgColors) => {
      const ctx = document.getElementById(id)?.getContext('2d');
      if (!ctx) return;
      anCompareCharts.push(new Chart(ctx, {
        type:'bar',
        data:{ labels:teamNums, datasets:[{ data, backgroundColor:bgColors, borderRadius:4 }]},
        options:{ ...baseOpts, scales:{ x:{ ticks:tickStyle, grid:{display:false} }, y:{ ticks:tickStyle, grid:{ color:'rgba(255,255,255,0.06)' } } } }
      }));
    };
    bar('anCmpSkills', teams.map(e=>e.computed?.combined??0), colors.slice(0,teams.length));
    bar('anCmpMMR',    teams.map(e=>e.computed?.mmr??0),      colors.slice(0,teams.length));
    bar('anCmpWR',     teams.map(e=>e.computed?.winRate!=null?+(e.computed.winRate*100).toFixed(1):0), colors.slice(0,teams.length));

    // Grouped W/L/T
    const ctxWL = document.getElementById('anCmpWL')?.getContext('2d');
    if (ctxWL) anCompareCharts.push(new Chart(ctxWL, {
      type:'bar',
      data:{ labels:teamNums, datasets:[
        { label:'W', data:teams.map(e=>e.computed?.wins??0),   backgroundColor:'#22c55e', borderRadius:3 },
        { label:'L', data:teams.map(e=>e.computed?.losses??0), backgroundColor:'#ff7b77', borderRadius:3 },
        { label:'T', data:teams.map(e=>e.computed?.ties??0),   backgroundColor:'#888',    borderRadius:3 },
      ]},
      options:{ ...baseOpts, plugins:{ ...baseOpts.plugins, legend:{ display:true, labels:{ color:'#888', font:{size:10} } } }, scales:{ x:{ ticks:tickStyle, grid:{display:false} }, y:{ ticks:tickStyle, grid:{ color:'rgba(255,255,255,0.06)' } } } }
    }));
  });
}

function anCloseCompare() {
  anCompareCharts.forEach(c => { try { c.destroy(); } catch {} });
  anCompareCharts = [];
  const cv = document.getElementById('anCompareView');
  if (cv) cv.style.display = 'none';
}

// ── Sidebar: Head-to-Head (quick lookup) ──────────────────────────────────────

function anOpenH2H() {
  const input = document.getElementById('anH2HInput');
  if (!input) return;
  const num = input.value.trim().toUpperCase();
  if (!num) { alert('Enter a team number first.'); return; }
  const entry = AN.teams.find(t => (t.team.number || '').toUpperCase() === num);
  if (!entry) { alert(`Team "${num}" not found in the loaded region data.`); return; }
  anRenderH2H(entry);
}

function anRenderH2H(entry) {
  const result = document.getElementById('anH2HResult');
  if (!result) return;

  if (!AN.myStats || !entry.computed) {
    result.innerHTML = `<div style="font-size:11px;color:var(--t3);margin-top:8px;">Stats not loaded yet — wait for data to finish loading.</div>`;
    return;
  }

  const them = entry.computed;
  const me   = AN.myStats;
  const myNum = AN.myTeamNum;
  const theirNum = entry.team.number || entry.team.name || '?';

  const rows = [
    { lbl:'Skills',    myVal: me.combined, theirVal: them.combined, lower: false },
    { lbl:'Driver',    myVal: me.driver,   theirVal: them.driver,   lower: false },
    { lbl:'Auto',      myVal: me.auto,     theirVal: them.auto,     lower: false },
    { lbl:'Win%', myVal: me.winRate != null ? +(me.winRate*100).toFixed(1) : null,
                  theirVal: them.winRate != null ? +(them.winRate*100).toFixed(1) : null,
                  fmt: v => v+'%', lower: false },
    { lbl:'MMR',       myVal: me.mmr,        theirVal: them.mmr,        lower: false },
    { lbl:'CCWM',      myVal: me.ccwm,       theirVal: them.ccwm,       lower: false },
    { lbl:'WP',        myVal: me.wp,         theirVal: them.wp,         lower: false },
    { lbl:'AP',        myVal: me.ap,         theirVal: them.ap,         lower: false },
    { lbl:'SP',        myVal: me.sp,         theirVal: them.sp,         lower: false },
    { lbl:'Best Rank', myVal: me.bestRank,   theirVal: them.bestRank,   lower: true },
    { lbl:'Events',    myVal: me.events,     theirVal: them.events,     lower: false },
  ];

  const cell = (val, vs, lower, fmt) => {
    const disp = val != null ? (fmt ? fmt(val) : val) : '—';
    let col = 'var(--t1)';
    if (val != null && vs != null) {
      const better = lower ? val < vs : val > vs;
      const worse  = lower ? val > vs : val < vs;
      if (better) col = '#22c55e';
      else if (worse) col = '#ff7b77';
    }
    return `<div style="text-align:right;font-family:var(--fm);font-size:12px;font-weight:600;color:${col};">${disp}</div>`;
  };

  result.innerHTML = `
    <div style="margin-top:10px;background:var(--s2);border-radius:6px;overflow:hidden;border:1px solid var(--b1);">
      <div style="display:grid;grid-template-columns:1fr auto 1fr;padding:7px 8px;background:var(--s3);border-bottom:1px solid var(--b1);">
        <div style="font-size:11px;font-weight:700;color:var(--gold);">${myNum}</div>
        <div style="font-size:10px;color:var(--t3);text-align:center;padding:0 6px;">vs</div>
        <div style="font-size:11px;font-weight:700;color:#60a5fa;text-align:right;">${theirNum}</div>
      </div>
      ${rows.map(r => `
        <div style="display:grid;grid-template-columns:1fr auto 1fr;padding:5px 8px;border-bottom:1px solid var(--b1);">
          ${cell(r.myVal, r.theirVal, r.lower, r.fmt)}
          <div style="font-size:10px;color:var(--t3);text-align:center;padding:0 6px;">${r.lbl}</div>
          ${cell(r.theirVal, r.myVal, r.lower, r.fmt)}
        </div>`).join('')}
    </div>
    <button class="btn-o an-sidebar-btn" style="margin-top:8px;" onclick="anShowTeamDetail(${entry.team.id})">Open ${theirNum} Detail ▶</button>`;
}

// ── Match Predictor ────────────────────────────────────────────────────────────

function anPredLookup(num) {
  if (!num) return null;
  return AN.teams.find(t => (t.team.number || '').toUpperCase() === num.trim().toUpperCase()) || null;
}

function anPredMMR(num) {
  const e = anPredLookup(num);
  if (!e || !e.computed) return null;
  if (e.computed.mmr != null) return e.computed.mmr;
  // No MMR yet — synthesise from composite (range ≈ 900–1100)
  return 900 + (e.computed.composite ?? 0) * 2;
}

function anPredHint(slot) {
  const input = document.getElementById('anPredIn_' + slot);
  const hint  = document.getElementById('anPredHint_' + slot);
  if (!input || !hint) return;
  const e = anPredLookup(input.value);
  hint.textContent = e ? (e.team.organization || e.team.name || '') : (input.value.trim() ? 'Not in region' : '');
  hint.style.color = e ? 'var(--t2)' : 'var(--t3)';
}

function anRunPredictor() {
  const result = document.getElementById('anPredResult');
  if (!result) return;

  const slots = ['R1','R2','B1','B2'];
  const nums  = {};
  const mmrs  = {};
  const errs  = [];

  slots.forEach(s => {
    const val = (document.getElementById('anPredIn_' + s)?.value || '').trim().toUpperCase();
    nums[s] = val;
    if (!val) { errs.push(s); return; }
    const m = anPredMMR(val);
    if (m === null) errs.push(`${val} (not found)`);
    else mmrs[s] = m;
  });

  if (errs.length) {
    result.innerHTML = `<div style="font-size:10px;color:#ff7b77;margin-top:6px;">Missing or unknown: ${errs.join(', ')}</div>`;
    return;
  }

  const redAvg  = (mmrs.R1 + mmrs.R2) / 2;
  const blueAvg = (mmrs.B1 + mmrs.B2) / 2;

  // ELO-style win probability
  const redWin  = 1 / (1 + Math.pow(10, (blueAvg - redAvg) / 400));
  const blueWin = 1 - redWin;

  // CCWM-based expected margin
  const getC = num => anPredLookup(num)?.computed?.ccwm ?? null;
  const ccwms = [getC(nums.R1), getC(nums.R2), getC(nums.B1), getC(nums.B2)];
  const allHaveCCWM = ccwms.every(c => c !== null);
  let marginHtml = '';
  if (allHaveCCWM) {
    const redCCWM  = (ccwms[0] + ccwms[1]) / 2;
    const blueCCWM = (ccwms[2] + ccwms[3]) / 2;
    const margin   = Math.abs(redCCWM - blueCCWM).toFixed(1);
    const favColor = redCCWM >= blueCCWM ? '#ff7b77' : '#60a5fa';
    const favLabel = redCCWM >= blueCCWM ? 'Red' : 'Blue';
    marginHtml = `<div style="font-size:10px;color:var(--t3);text-align:center;margin-top:5px;">Est. margin <span style="color:${favColor};">+${margin} pts (${favLabel})</span> by CCWM</div>`;
  }

  const redPct  = (redWin  * 100).toFixed(1);
  const bluePct = (blueWin * 100).toFixed(1);

  result.innerHTML = `
    <div style="margin-top:10px;background:var(--s2);border-radius:6px;border:1px solid var(--b1);padding:10px 12px;">
      <div style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:11px;margin-bottom:4px;">
          <span style="font-weight:700;color:#ff7b77;">${nums.R1} + ${nums.R2}</span>
          <span style="font-family:var(--fm);font-weight:700;color:#ff7b77;">${redPct}%</span>
        </div>
        <div style="height:8px;background:var(--s3);border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${redPct}%;background:#ff7b77;border-radius:4px;"></div>
        </div>
        <div style="font-size:9px;color:var(--t3);margin-top:2px;">MMR avg ${Math.round(redAvg)}</div>
      </div>
      <div style="margin-bottom:6px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:11px;margin-bottom:4px;">
          <span style="font-weight:700;color:#60a5fa;">${nums.B1} + ${nums.B2}</span>
          <span style="font-family:var(--fm);font-weight:700;color:#60a5fa;">${bluePct}%</span>
        </div>
        <div style="height:8px;background:var(--s3);border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${bluePct}%;background:#60a5fa;border-radius:4px;"></div>
        </div>
        <div style="font-size:9px;color:var(--t3);margin-top:2px;">MMR avg ${Math.round(blueAvg)}</div>
      </div>
      ${marginHtml}
    </div>`;
}

// ── Sidebar: Regional Events ───────────────────────────────────────────────────

async function anLoadEvents() {
  const list = document.getElementById('anEventList');
  if (!list) return;
  if (!AN.seasonId || !AN.myTeamId) { list.innerHTML = '<div style="font-size:11px;color:var(--t3);">Load regional data first.</div>'; return; }
  if (AN.eventsLoaded && AN.events.length) { anRenderEventChips(); return; }

  list.innerHTML = '<div style="font-size:11px;color:var(--t3);">Loading…</div>';
  try {
    const effectiveRegion  = AN.regionOverride || AN.myRegion;
    const effectiveCountry = AN.regionOverride ? '' : AN.myCountry;
    const params = {'program[]': 1, 'season[]': AN.seasonId, per_page: 250};
    if (effectiveRegion)  params['region']  = effectiveRegion;
    if (effectiveCountry) params['country'] = effectiveCountry;
    AN.events = await ra('/events', params);
    AN.eventsLoaded = true;
    anRenderEventChips();
  } catch(e) {
    list.innerHTML = `<div style="font-size:11px;color:#ff7b77;">Error: ${e.message}</div>`;
  }
}

function anRenderEventChips() {
  const list = document.getElementById('anEventList');
  if (!list) return;
  if (!AN.events.length) { list.innerHTML = '<div style="font-size:11px;color:var(--t3);">No events found.</div>'; return; }
  list.innerHTML = `
    <button class="an-event-chip ${AN.filterEventId === null ? 'active' : ''}" onclick="anSetEventFilter(null)">All events</button>
    ${AN.events.map(ev => `
      <button class="an-event-chip ${AN.filterEventId === ev.id ? 'active' : ''}" onclick="anSetEventFilter(${ev.id})" title="${ev.name}">
        ${(ev.name || '').length > 28 ? (ev.name.substring(0, 26) + '…') : (ev.name || ev.sku)}
      </button>`).join('')}`;
}

async function anSetEventFilter(eventId) {
  AN.filterEventId = eventId;
  anRenderEventChips();

  if (eventId === null) {
    // Clear filter — restore full region data
    AN.teams.forEach(t => { t._filteredOut = false; });
    anRenderTable();
    return;
  }

  // Fetch teams registered for this event and mark others as filtered out
  const meta = document.getElementById('anTableMeta');
  if (meta) meta.textContent = 'Filtering…';
  try {
    const evtTeams = await ra(`/events/${eventId}/teams`, {per_page: 250});
    const teamIdsInEvent = new Set(evtTeams.map(t => t.id));
    AN.teams.forEach(t => { t._filteredOut = !teamIdsInEvent.has(t.team.id); });
    anRenderTable();
  } catch(e) {
    if (meta) meta.textContent = `Filter error: ${e.message}`;
  }
}

// ── Sidebar: Change Region ─────────────────────────────────────────────────────

function anApplySeason() {
  const input = document.getElementById('anSeasonInput');
  if (!input) return;
  const val = parseInt(input.value.trim(), 10);
  if (!val) { alert('Enter a numeric season ID (e.g. 190).'); return; }
  AN.seasonOverride = val;
  AN.seasonId = null;
  AN.loaded = false;
  loadAnalysisData(true);
}

function anClearSeason() {
  AN.seasonOverride = null;
  AN.seasonId = null;
  AN.loaded = false;
  const input = document.getElementById('anSeasonInput');
  if (input) input.value = '';
  loadAnalysisData(true);
}

function anApplyRegion() {
  const input = document.getElementById('anRegionInput');
  if (!input) return;
  const val = input.value.trim();
  if (!val) return;
  AN.regionOverride = val;
  AN.loaded = false;
  AN.eventsLoaded = false;
  AN.events = [];
  AN.filterEventId = null;
  document.getElementById('anEventList').innerHTML = '';
  loadAnalysisData(true);
}

function anClearRegion() {
  AN.regionOverride = '';
  AN.loaded = false;
  AN.eventsLoaded = false;
  AN.events = [];
  AN.filterEventId = null;
  const input = document.getElementById('anRegionInput');
  if (input) input.value = '';
  document.getElementById('anEventList').innerHTML = '';
  loadAnalysisData(true);
}

// ─── SIMULATOR ANALYTICS ──────────────────────────────────────────────────────

async function simOpenAnalytics() {
  const overlay = document.getElementById('simAnalyticsOverlay');
  overlay.style.display = 'flex';
  await simRefreshSessions();
}

function simCloseAnalytics() {
  document.getElementById('simAnalyticsOverlay').style.display = 'none';
}

async function simRefreshSessions() {
  const el = document.getElementById('simSessionList');
  el.innerHTML = '<span style="color:var(--t3);font-size:11px;">Loading…</span>';
  const sessions = await window.electronAPI?.simListSessions?.() || [];
  if (!sessions.length) {
    el.innerHTML = '<div style="color:var(--t3);font-size:11px;line-height:1.6;">No sessions yet.<br>Run a match in Driver or Auton mode to record data.</div>';
    return;
  }
  el.innerHTML = sessions.map(s => {
    const d = new Date(s.date);
    const label = `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const dur = s.frameCount ? `${Math.round(s.frameCount / 10)}s` : '?s';
    return `<div class="sim-session-row" id="ssr_${CSS.escape(s.file)}" onclick="simSelectSession('${s.file.replace(/'/g, "\\'")}')">
      <div style="font-size:11px;font-weight:700;color:var(--t1);">${(s.mode || 'driver').toUpperCase()} &nbsp;<span style="font-weight:400;color:var(--t3);">${dur}</span></div>
      <div style="font-size:10px;color:var(--t3);margin-top:2px;">${label}</div>
    </div>`;
  }).join('');
}

let _simLastSessionFile = null;

async function simSelectSession(file) {
  _simLastSessionFile = file;
  document.querySelectorAll('.sim-session-row').forEach(r => r.classList.remove('active'));
  const row = document.getElementById('ssr_' + CSS.escape(file));
  if (row) row.classList.add('active');

  const session = await window.electronAPI?.simLoadSession?.(file);
  if (!session) return;
  simRenderSessionAnalytics(session);
}

function simRenderSessionAnalytics(session) {
  document.getElementById('simAnalyticsEmpty').style.display = 'none';
  const detail = document.getElementById('simAnalyticsDetail');
  detail.style.display = 'flex';

  const frames = session.frames || [];
  if (!frames.length) {
    detail.style.display = 'none';
    document.getElementById('simAnalyticsEmpty').style.display = '';
    document.getElementById('simAnalyticsEmpty').textContent = 'No frame data in this session.';
    return;
  }

  const GRID = 24;
  const FIELD = 144;
  const heatmap = new Array(GRID * GRID).fill(0);

  frames.forEach(f => {
    const gx = Math.min(GRID - 1, Math.floor((f.p.x / FIELD) * GRID));
    const gy = Math.min(GRID - 1, Math.floor((f.p.y / FIELD) * GRID));
    heatmap[gy * GRID + gx]++;
  });

  const maxH = Math.max(...heatmap, 1);
  const canvas = document.getElementById('simHeatmapCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cw = W / GRID, ch = H / GRID;

  ctx.clearRect(0, 0, W, H);

  // Draw field background
  ctx.fillStyle = '#0d0d1a';
  ctx.fillRect(0, 0, W, H);

  // Draw heatmap cells
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const v = heatmap[y * GRID + x] / maxH;
      if (v < 0.01) continue;
      const hue = 240 - v * 210;
      const light = 25 + v * 45;
      ctx.fillStyle = `hsl(${hue},80%,${light}%)`;
      ctx.fillRect(x * cw, y * ch, cw, ch);
    }
  }

  // Grid overlay
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= GRID; i++) {
    ctx.beginPath(); ctx.moveTo(i * cw, 0); ctx.lineTo(i * cw, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * ch); ctx.lineTo(W, i * ch); ctx.stroke();
  }

  // Diagonal field split (y=x line: blue side above-left, red side below-right)
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, H); ctx.stroke();
  ctx.setLineDash([]);
  // Hopper marker
  ctx.strokeStyle = 'rgba(251,191,36,0.6)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(W / 2, H / 2, W * (13 / 144), 0, Math.PI * 2); ctx.stroke();

  // Path trace
  if (frames.length > 1) {
    ctx.strokeStyle = 'rgba(251,191,36,0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    frames.forEach((f, i) => {
      const px = (f.p.x / FIELD) * W;
      const py = (f.p.y / FIELD) * H;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.stroke();
  }

  // Start (green) / end (red) markers
  const drawDot = (x, y, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc((x / FIELD) * W, (y / FIELD) * H, 4, 0, Math.PI * 2);
    ctx.fill();
  };
  drawDot(frames[0].p.x, frames[0].p.y, '#22c55e');
  drawDot(frames[frames.length - 1].p.x, frames[frames.length - 1].p.y, '#ef4444');

  // ── Speed timeline ──────────────────────────────────────────────────────────
  const sc = document.getElementById('simSpeedCanvas');
  const sctx = sc.getContext('2d');
  const SW = sc.width, SH = sc.height;
  sctx.clearRect(0, 0, SW, SH);
  sctx.fillStyle = '#111118';
  sctx.fillRect(0, 0, SW, SH);

  const speeds = frames.map(f => Math.sqrt(f.p.vx ** 2 + f.p.vy ** 2));
  const maxSpd = Math.max(...speeds, 1);
  const avgSpd = speeds.reduce((a, b) => a + b, 0) / speeds.length;

  // avg line
  sctx.strokeStyle = 'rgba(251,191,36,0.3)';
  sctx.lineWidth = 1;
  const avgY = SH - (avgSpd / maxSpd) * (SH - 6) - 3;
  sctx.beginPath(); sctx.moveTo(0, avgY); sctx.lineTo(SW, avgY); sctx.stroke();

  // speed curve
  sctx.strokeStyle = '#6ab3ff';
  sctx.lineWidth = 1.5;
  sctx.beginPath();
  speeds.forEach((spd, i) => {
    const x = (i / (speeds.length - 1)) * SW;
    const y = SH - (spd / maxSpd) * (SH - 6) - 3;
    i === 0 ? sctx.moveTo(x, y) : sctx.lineTo(x, y);
  });
  sctx.stroke();

  // ── Stats ───────────────────────────────────────────────────────────────────
  const cellsVisited = heatmap.filter(v => v > 0).length;
  const coverage = (cellsVisited / (GRID * GRID) * 100).toFixed(0);

  const quarterCells = GRID / 4;
  let centerDeadCount = 0;
  for (let y = quarterCells; y < GRID * 3 / 4; y++)
    for (let x = quarterCells; x < GRID * 3 / 4; x++)
      if (heatmap[y * GRID + x] === 0) centerDeadCount++;

  const lastSc = frames[frames.length - 1]?.sc || { player: 0, opponent: 0 };

  // Use the robot's actual max speed from telemetry metadata; fall back to 200-rpm default (~34 in/s)
  const robotMaxSpd = session.maxRobotSpeed || 34;
  const avgSpdPct   = Math.round(avgSpd / robotMaxSpd * 100);
  const maxSpdPct   = Math.round(maxSpd / robotMaxSpd * 100);

  const coverageColor = coverage > 50 ? '#22c55e' : coverage > 25 ? '#f59e0b' : '#ef4444';
  const deadColor = centerDeadCount > 30 ? '#ef4444' : centerDeadCount > 10 ? '#f59e0b' : '#22c55e';
  const spdColor = avgSpdPct > 55 ? '#22c55e' : avgSpdPct > 30 ? '#f59e0b' : '#ef4444';

  document.getElementById('simAnalyticsStats').innerHTML = `
    <div class="sim-an-stat"><span>Field Coverage</span><span style="color:${coverageColor}">${coverage}%</span></div>
    <div class="sim-an-stat"><span>Avg Speed</span><span style="color:${spdColor}">${avgSpd.toFixed(1)} in/s (${avgSpdPct}% of max)</span></div>
    <div class="sim-an-stat"><span>Max Speed</span><span>${maxSpd.toFixed(1)} in/s (${maxSpdPct}% of max)</span></div>
    <div class="sim-an-stat"><span>Final Score</span><span>${lastSc.player} &ndash; ${lastSc.opponent}</span></div>
    <div class="sim-an-stat"><span>Center Dead Zones</span><span style="color:${deadColor}">${centerDeadCount} cells</span></div>
    <div class="sim-an-stat"><span>Duration</span><span>${(frames.length / 10).toFixed(0)}s (${frames.length} frames)</span></div>
  `;

  // ── Coaching tips ────────────────────────────────────────────────────────────
  const tips = [];
  if (coverage < 25) tips.push({ type: 'warn', msg: 'Low field coverage — you are staying in a small area. Practice traversing all four quadrants.' });
  else if (coverage < 45) tips.push({ type: 'info', msg: 'Moderate coverage. Try to reach the corners opposite your starting position.' });
  if (centerDeadCount > 40) tips.push({ type: 'warn', msg: 'Large center dead zone — midfield control is key. Spend more time fighting for center objects.' });
  // Speed thresholds are relative to the robot's configured max speed, not hardcoded
  if (avgSpdPct < 25) tips.push({ type: 'warn', msg: `Average speed only ${avgSpdPct}% of your robot's max — you're leaving a lot of pace on the field.` });
  else if (avgSpdPct < 40) tips.push({ type: 'info', msg: `Average speed is ${avgSpdPct}% of max. Pushing above 50% consistently will put more pressure on opponents.` });
  else if (avgSpdPct > 60) tips.push({ type: 'good', msg: `High average speed (${avgSpdPct}% of max) — great aggression on the field.` });
  if (lastSc.player > lastSc.opponent) tips.push({ type: 'good', msg: `Won ${lastSc.player}–${lastSc.opponent}. Review the heatmap to see which areas contributed most.` });
  else if (lastSc.player < lastSc.opponent) tips.push({ type: 'warn', msg: `Lost ${lastSc.player}–${lastSc.opponent}. Study opponent positions on the heatmap to find contested zones.` });
  else tips.push({ type: 'info', msg: 'Tied match. A more aggressive endgame push often breaks ties.' });
  if (tips.length === 0) tips.push({ type: 'good', msg: 'Strong performance — solid coverage and speed.' });

  const tipColor = { warn: '#f59e0b', good: '#22c55e', info: 'var(--t2)' };
  document.getElementById('simAnalyticsTips').innerHTML = tips.map(t =>
    `<div style="font-size:12px;color:${tipColor[t.type]};padding:5px 8px;border-radius:5px;background:var(--s3);line-height:1.5;">${t.msg}</div>`
  ).join('');
}

// ─── INIT ──────────────────────────────────────────────────────────────────────
init();
initGoogleAuth();
checkAuthRedirect();
// Populate homepage inputs from saved values
(()=>{
  const re = document.getElementById('hpReToken');
  const team = document.getElementById('hpMyTeam');
  const status = document.getElementById('hpReStatus');
  if (re)   re.value   = S.re || '';
  if (team) team.value = ls('vs_myteam') || '';
  if (re)   re.style.borderColor = S.re ? 'var(--green)' : 'var(--b2)';
  if (team) team.style.borderColor = ls('vs_myteam') ? 'var(--green)' : 'var(--b2)';
  if (status) status.textContent = S.re ? `Token active (${S.re.length} chars)` : 'Required for all API features';
})();
if(window.electronAPI?.onUpdateStatus)window.electronAPI.onUpdateStatus(msg=>setSt(msg,'live'));
