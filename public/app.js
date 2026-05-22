let selectedId = null;
let suggestTimer = null;
let activeSuggestion = -1;
function escapeHtml(s){return String(s||'').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
async function fetchSuggestions(q){
  const d = await api('/api/address-suggest?q=' + encodeURIComponent(q));
  return d.suggestions || [];
}
function hideSuggestions(){ $('addressSuggestions').hidden = true; $('addressSuggestions').innerHTML=''; activeSuggestion=-1; }
function renderSuggestions(items){
  const box=$('addressSuggestions');
  if(!items.length){ hideSuggestions(); return; }
  box.innerHTML=items.map((x,i)=>`<div class="suggestion" data-i="${i}" data-place="${escapeHtml(x.placeId)}"><strong>${escapeHtml(x.mainText)}</strong><span>${escapeHtml(x.secondaryText)}</span></div>`).join('');
  box.hidden=false;
  box.querySelectorAll('.suggestion').forEach((el,i)=>el.onclick=()=>selectSuggestion(items[i]));
}
async function selectSuggestion(item){
  try{
    const d = await api('/api/place-details?placeId=' + encodeURIComponent(item.placeId));
    $('addressInput').value = d.address || item.description;
  } catch { $('addressInput').value = item.description; }
  hideSuggestions();
}
function setupAddressAutocomplete(){
  const input=$('addressInput');
  if(!input) return;
  let lastItems=[];
  input.addEventListener('input', () => {
    clearTimeout(suggestTimer);
    const q=input.value.trim();
    if(q.length<3){ hideSuggestions(); return; }
    suggestTimer=setTimeout(async()=>{
      try{ lastItems=await fetchSuggestions(q); renderSuggestions(lastItems); }
      catch(e){ console.warn(e); hideSuggestions(); }
    }, 220);
  });
  input.addEventListener('keydown', e => {
    const box=$('addressSuggestions');
    if(box.hidden || !lastItems.length) return;
    if(e.key==='ArrowDown'){ e.preventDefault(); activeSuggestion=Math.min(activeSuggestion+1,lastItems.length-1); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); activeSuggestion=Math.max(activeSuggestion-1,0); }
    else if(e.key==='Enter' && activeSuggestion>=0){ e.preventDefault(); selectSuggestion(lastItems[activeSuggestion]); return; }
    else if(e.key==='Escape'){ hideSuggestions(); return; }
    box.querySelectorAll('.suggestion').forEach((el,i)=>el.classList.toggle('active', i===activeSuggestion));
  });
  document.addEventListener('click', e => { if(!e.target.closest('.address-label')) hideSuggestions(); if(!e.target.closest('.tipcell')) document.querySelectorAll('.tipbox').forEach(b=>b.hidden=true); });
}

const $ = id => document.getElementById(id);
const fmt = v => v === null || v === undefined || v === '' ? 'n/a' : v;
const money = v => v ? '$' + Number(v).toLocaleString() : 'n/a';
const pct = v => v === null || v === undefined ? 'n/a' : (Number(v) * 100).toFixed(1) + '%';
const compactPop = v => v === null || v === undefined || v === '' ? 'n/a' : (Math.round(Number(v)/100)/10).toLocaleString(undefined,{maximumFractionDigits:1}) + 'K';
async function api(path, opts={}) { const r = await fetch(path, { headers:{'Content-Type':'application/json'}, ...opts }); const d = await r.json(); if(!r.ok) throw new Error(d.error || 'Request failed'); return d; }
function statusText(m){ if(m.dataStatus==='fresh') return `Updated ${new Date(m.lastUpdatedAt).toLocaleString()}`; if(m.dataStatus==='error') return `Error: ${m.lastError||'update failed'}`; return 'Not updated yet'; }
async function loadMarkets(){ const {markets}=await api('/api/markets'); $('marketsList').innerHTML = markets.length ? markets.map(m=>`<div class="market-item ${m.id===selectedId?'active':''}" data-id="${m.id}"><strong>${m.name}</strong><span class="muted">${m.address}</span><br><span class="badge">${statusText(m)}</span></div>`).join('') : '<p class="muted">No saved markets yet.</p>'; document.querySelectorAll('.market-item').forEach(el=>el.onclick=()=>loadMarket(el.dataset.id)); }
function renderComparison(rows=[]){
  const metrics=[
    ['Geography name',r=>fmt(r.name)],
    ['Population',r=>fmt(r.population?.toLocaleString?.()||r.population)],
    ['Median household income',r=>money(r.medianHouseholdIncome)],
    ['Median home value',r=>money(r.medianHomeValue)],
    ['% renters',r=>pct(r.renterPercent)],
    ['% under 18',r=>pct(r.ageUnder18Percent)],
    ['% 65+',r=>pct(r.age65PlusPercent)]
  ];
  const tooltip={
    'ZIP/ZCTA':'ZCTA = ZIP Code Tabulation Area. It is the Census approximation of USPS ZIP codes, not always identical to postal ZIP boundaries.',
    'Census Tract':'Small Census geography, usually 1,200-8,000 people. Often more useful than city/town for rural or unincorporated MHP locations.',
    'City/Place':'Census incorporated place. This can differ from the mailing city and may be unavailable for unincorporated areas.'
  };
  const headerLabel=(r,i)=> tooltip[r.level] ? `<button type="button" class="tip" data-tip-id="tip-${i}" aria-expanded="false">${escapeHtml(r.level)} <span class="tipmark">?</span></button><div id="tip-${i}" class="tipbox" hidden>${escapeHtml(tooltip[r.level])}</div>` : escapeHtml(r.level);
  $('comparisonTable').innerHTML = `<thead><tr><th>Metric</th>${rows.map((r,i)=>`<th class="tipcell">${headerLabel(r,i)}</th>`).join('')}</tr><tr class="geo-name-row"><th>Geography</th>${rows.map(r=>`<th>${escapeHtml(r.name || 'Unavailable')}</th>`).join('')}</tr></thead><tbody>${metrics.slice(1).map(([name,fn])=>`<tr><td>${name}</td>${rows.map(r=>`<td>${r.error?'<span class="error">'+escapeHtml(r.error)+'</span>':fn(r)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  document.querySelectorAll('.tip').forEach(btn=>btn.onclick=(e)=>{
    e.stopPropagation();
    const box=$(btn.dataset.tipId);
    const opening=box.hidden;
    document.querySelectorAll('.tipbox').forEach(b=>b.hidden=true);
    document.querySelectorAll('.tip').forEach(b=>b.setAttribute('aria-expanded','false'));
    box.hidden=!opening;
    btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
  });
}
function renderPopulationTrends(rows=[]){
  if(!rows.length){ $('populationTrendTable').innerHTML='<tbody><tr><td class="muted">No population trend yet. Click Update Data.</td></tr></tbody>'; return; }
  const years=[2022,2021,2020,2019,2018,2017,2016,2015,2014,2013];
  const popFor=(r,y)=>r.years?.find(p=>p.year===y)?.population;
  const growth=(r,n)=>{ const latest=popFor(r,2022); const prior=popFor(r,2022-n); return latest&&prior ? (latest-prior)/prior : null; };
  const growthRows=[['1-year growth',1],['3-year growth',3],['5-year growth',5],['10-year growth',9]];
  const colLabel=r=>`<th><span>${escapeHtml(r.level)}</span><small>${escapeHtml(r.name||'')}</small></th>`;
  $('populationTrendTable').innerHTML=`<thead><tr><th>Metric / Year</th>${rows.map(colLabel).join('')}</tr></thead><tbody>${growthRows.map(([label,n])=>`<tr class="summary-row"><td><strong>${label}</strong></td>${rows.map(r=>`<td>${pct(growth(r,n))}</td>`).join('')}</tr>`).join('')}<tr class="divider-row"><td colspan="${rows.length+1}">Annual population</td></tr>${years.map(y=>`<tr><td><strong>${y}</strong></td>${rows.map(r=>`<td>${compactPop(popFor(r,y))}</td>`).join('')}</tr>`).join('')}</tbody>`;
}
function renderRents(rows=[]){
  if(!rows.length){ $('rentTable').innerHTML='<tbody><tr><td class="muted">No HUD FMR match yet. Click Update Data after geocoding a market.</td></tr></tbody>'; return; }
  const cols=[
    ['FY',r=>r.year],['Type',r=>r.type],['Geography',r=>r.geography || r.hudAreaName],['HUD Area',r=>r.hudAreaName],
    ['0BR',r=>money(r.efficiency)],['1BR',r=>money(r.oneBedroom)],['2BR',r=>money(r.twoBedroom)],['3BR',r=>money(r.threeBedroom)],['4BR',r=>money(r.fourBedroom)]
  ];
  $('rentTable').innerHTML=`<thead><tr>${cols.map(([h])=>`<th>${escapeHtml(h)}</th>`).join('')}<th>Source</th></tr></thead><tbody>${rows.map((r,i)=>`<tr>${cols.map(([,fn])=>`<td>${escapeHtml(fn(r) ?? 'n/a')}</td>`).join('')}<td class="tipcell"><button type="button" class="tip rent-tip" data-tip-id="rent-tip-${i}" aria-expanded="false">Source <span class="tipmark">?</span></button><div id="rent-tip-${i}" class="tipbox" hidden>${escapeHtml(r.sourceFile || 'HUD FMR dataset')}<br>${escapeHtml(r.sourceUrl || '')}</div></td></tr>`).join('')}</tbody>`;
  document.querySelectorAll('.rent-tip').forEach(btn=>btn.onclick=(e)=>{
    e.stopPropagation();
    const box=$(btn.dataset.tipId);
    const opening=box.hidden;
    document.querySelectorAll('.tipbox').forEach(b=>b.hidden=true);
    document.querySelectorAll('.tip').forEach(b=>b.setAttribute('aria-expanded','false'));
    box.hidden=!opening;
    btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
  });
}
async function loadMarket(id){ selectedId=id; await loadMarkets(); const m=await api('/api/markets/'+id); $('reportEmpty').hidden=true; $('report').hidden=false; $('reportName').textContent=m.name; $('reportAddress').textContent=`${m.address} • ${m.radiusMiles||30} mile radius`; $('reportStatus').textContent=statusText(m); $('geoSummary').innerHTML = m.geo ? [`Matched: ${m.geo.matchedAddress}`,`County: ${m.geo.county?.name||'n/a'}`,`City: ${m.geo.city?.name||'n/a'}`,`State: ${m.geo.state?.name||'n/a'}`,`ZCTA: ${m.geo.zcta?.code||'n/a'}`,`Tract: ${m.geo.tract?.name||m.geo.tract?.code||'n/a'}`].map(x=>`<span class="chip">${x}</span>`).join('') : '<span class="chip">Click Update Data to geocode and pull Census data</span>'; renderComparison(m.comparison||[]); renderPopulationTrends(m.populationTrends||[]); renderRents(m.rents||[]); $('sources').innerHTML=(m.sources||[]).map(s=>`<p><strong>${s.name}</strong> - ${new Date(s.updatedAt).toLocaleString()}<br><span class="muted">${s.url}</span></p>`).join('') || '<p>No sources yet.</p>'; }
$('newMarketForm').onsubmit=async e=>{ e.preventDefault(); const fd=new FormData(e.target); const body=Object.fromEntries(fd.entries()); const m=await api('/api/markets',{method:'POST',body:JSON.stringify(body)}); e.target.reset(); e.target.radiusMiles.value=30; await loadMarket(m.id); };
$('updateMarket').onclick=async()=>{ if(!selectedId) return; $('updateMarket').disabled=true; $('updateMarket').textContent='Updating...'; try{ await api(`/api/markets/${selectedId}/update`,{method:'POST'}); await loadMarket(selectedId); } catch(e){ alert(e.message); await loadMarket(selectedId); } finally{ $('updateMarket').disabled=false; $('updateMarket').textContent='Update Data'; } };
$('refreshList').onclick=loadMarkets;
setupAddressAutocomplete();
loadMarkets().catch(e=>alert(e.message));
