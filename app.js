/* ===================== SPROG-OPLØSNING ===================== */
let lang = localStorage.getItem('onepot_lang') || 'da';
const T = STR[lang];
const recipes = lang==='en' ? RECIPES_EN : RECIPES_DA;
const AISLES = lang==='en' ? AISLES_EN : AISLES_DA;
const PRICES = lang==='en' ? PRICES_EN : PRICES_DA;
const COUNTABLE = lang==='en' ? COUNTABLE_EN : COUNTABLE_DA;
const MANUAL_TAGS = lang==='en' ? MANUAL_TAGS_EN : MANUAL_TAGS_DA;
const TAG_GROUPS = lang==='en' ? TAG_GROUPS_EN : TAG_GROUPS_DA;
const AUTO_TAG_KEYWORDS = lang==='en' ? AUTO_TAG_KEYWORDS_EN : AUTO_TAG_KEYWORDS_DA;
const STRIP_RE = lang==='en' ? STRIP_RE_EN : STRIP_RE_DA;
const SYN = lang==='en' ? SYN_EN : SYN_DA;
const OR_SPLIT = lang==='en' ? OR_SPLIT_EN : OR_SPLIT_DA;
const GARLIC_WORD = lang==='en' ? 'garlic' : 'hvidløg';
const CLOVE_WORD = lang==='en' ? 'clove' : 'fed';
const SALTPEPPER_WORD = lang==='en' ? 'salt & pepper' : 'salt & peber';
const WATER_WORD = lang==='en' ? 'water' : 'vand';
const SORT_LOCALE = lang==='en' ? 'en' : 'da';

// Tag-kanonisering: fravalgte tags gemmes ALTID som dansk kanonisk navn,
// så gemte filtre er bagudkompatible og overlever sprogskifte.
const TAG_EN_TO_DA = {"Meat":"Kød","Fish":"Fisk","Veg":"Veg","Quick":"Hurtig","Protein":"Protein",
  "Kid-friendly":"Børnevenlig","Creamy":"Cremet","Light":"Let","Spicy":"Stærk","Vegan":"Vegansk","Few ingredients":"Få ingredienser",
  "With garlic":"Med hvidløg","With coriander":"Med koriander","With chili":"Med chili","With mushroom":"Med svampe"};
function tagCanon(t){ return lang==='en' ? (TAG_EN_TO_DA[t]||t) : t; }
// Egenskab-gruppens tags (tilvælg/OG) — resten (Kategori+Ingredienser) er fravælg som hidtil
const TRAIT_TAGS = new Set(TAG_GROUPS[1][1]);
const FEW_ING_MAX = 8; // "Få ingredienser": højst dette antal (vand tæller ikke) — datasættets min. er 5, så ≤4 ville aldrig matche

// Lokaltal: komma (da) vs. punktum (en)
function fmtNum(n){
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/,'').replace('.', T.decimal_sep);
}

// Sæt statiske tekster (markup uden for JS-templates) ud fra data-i18n-attributter
function applyStaticI18n(){
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el=>{ el.textContent = T[el.dataset.i18n]; });
  document.querySelectorAll('[data-i18n-html]').forEach(el=>{ el.innerHTML = T[el.dataset.i18nHtml]; });
  document.querySelectorAll('[data-i18n-aria]').forEach(el=>{ el.setAttribute('aria-label', T[el.dataset.i18nAria]); });
}
applyStaticI18n();

const pad=n=>String(n).padStart(2,'0');
const QUICK_MAX=20; // min. for "Hurtig"/"Quick"

/* ===================== TAGS & FILTRE ===================== */
// Alle tags for en ret: kategori + auto-udledte + manuelle (MANUAL_TAGS nøglet efter indeks)
function recipeTags(r){
  const i = recipes.indexOf(r);
  const t=new Set([r.cat]);
  if(parseInt(r.time)<=QUICK_MAX) t.add(lang==='en'?'Quick':'Hurtig');
  if(r.cat!=='Veg') t.add('Protein');
  const realIng=r.ing.filter(x=>x[0].trim().toLowerCase()!==WATER_WORD);
  if(realIng.length<=FEW_ING_MAX) t.add(lang==='en'?'Few ingredients':'Få ingredienser');
  const ing=r.ing.map(x=>x[0].toLowerCase()).join(' ');
  AUTO_TAG_KEYWORDS.forEach(([kw,tag])=>{ if(ing.includes(kw)) t.add(tag); });
  (MANUAL_TAGS[i]||[]).forEach(x=>t.add(x));
  return t;
}

// Migrer evt. gamle favoritter (gemt som opskrift-NAVNE før flersprog-understøttelse) til indeks-baseret format
function migrateFavs(){
  let raw=[];
  try{ raw=JSON.parse(localStorage.getItem('onepot_favs')||'[]'); }catch(e){}
  if(raw.length && typeof raw[0]==='string'){
    const migrated = raw.map(name=>RECIPES_DA.findIndex(r=>r.name===name)).filter(i=>i>=0);
    localStorage.setItem('onepot_favs', JSON.stringify(migrated));
    return new Set(migrated);
  }
  return new Set(raw);
}

// Filter-state (gemmes)
let excludedTags=new Set(JSON.parse(localStorage.getItem('onepot_excluded')||'[]'));
let requiredTraits=new Set(JSON.parse(localStorage.getItem('onepot_required')||'[]')); // Egenskaber: tilvælg/OG
let favs=migrateFavs();
let onlyFavs=localStorage.getItem('onepot_onlyfavs')==='1';
let hideRecent=localStorage.getItem('onepot_hiderecent')==='1'; // skjul retter brugt i ugeplan for <7 dage
let sortMode=localStorage.getItem('onepot_sort')||'default'; // default|time|price|alpha
let searchText='';
function saveFilters(){
  localStorage.setItem('onepot_excluded',JSON.stringify([...excludedTags]));
  localStorage.setItem('onepot_required',JSON.stringify([...requiredTraits]));
  localStorage.setItem('onepot_favs',JSON.stringify([...favs]));
  localStorage.setItem('onepot_onlyfavs',onlyFavs?'1':'0');
  localStorage.setItem('onepot_hiderecent',hideRecent?'1':'0');
}
// Synkron hjælper: opskrift-indekser brugt i en gemt ugeplan inden for de sidste N dage
const RECENT_DAYS=7;
function recentlyUsedIndices(days){
  let plans=[]; try{ plans=JSON.parse(localStorage.getItem('onepot_plans')||'[]'); }catch(e){}
  const cutoff=Date.now()-days*86400000;
  const set=new Set();
  plans.forEach(p=>{ if(p.id>=cutoff) (p.recipes||[]).forEach(i=>set.add(i)); });
  return set;
}
// Central match: søgning + fravalgte tags (Kategori/Ingredienser) + krævede egenskaber (OG) + favoritter + nylig-filter
function matchRecipe(r){
  const idx=recipes.indexOf(r);
  if(onlyFavs && !favs.has(idx)) return false;
  if(hideRecent && recentlyUsedIndices(RECENT_DAYS).has(idx)) return false;
  if(searchText){
    const hay=(r.name+' '+r.ing.map(x=>x[0]).join(' ')).toLowerCase();
    if(!hay.includes(searchText)) return false;
  }
  const tags=recipeTags(r);
  for(const t of tags) if(!TRAIT_TAGS.has(t) && excludedTags.has(tagCanon(t))) return false;
  for(const req of requiredTraits) if(![...tags].some(t=>tagCanon(t)===req)) return false;
  return true;
}
// Estimér ca.-pris for ÉN opskrift (til "Billigst"-sortering) — genbruger prismotoren uden sammenlægning
function estimateRecipePrice(r){
  let total=0;
  r.ing.forEach(([nm,val,unit])=>{
    if(nm.trim().toLowerCase()===WATER_WORD) return;
    const base=baseIngredient(nm);
    const row=PRICES[base];
    if(!row) { total+=8; return; }
    const q=val!==""?parseFloat(val):null;
    const u=unit||'stk';
    if(q===null){ if(row.pack) total+=row.pack; }
    else if(row[u]!==undefined) total+=q*row[u];
    else if(row.pack!==undefined) total+=row.pack;
    else total+=8;
  });
  return total;
}
// Sortér en liste af opskrift-indekser efter aktivt sortMode (nummerorden er default = uændret)
function sortIndices(idxList){
  const arr=[...idxList];
  if(sortMode==='time') arr.sort((a,b)=>parseInt(recipes[a].time)-parseInt(recipes[b].time));
  else if(sortMode==='price') arr.sort((a,b)=>estimateRecipePrice(recipes[a])-estimateRecipePrice(recipes[b]));
  else if(sortMode==='alpha') arr.sort((a,b)=>recipes[a].name.localeCompare(recipes[b].name,SORT_LOCALE));
  return arr;
}
function setSortMode(m){
  sortMode=m;
  localStorage.setItem('onepot_sort',m);
  document.querySelectorAll('.sortSeg .seg-btn').forEach(b=>b.classList.toggle('on', b.dataset.mode===m));
  refreshFilterChrome();
  renderList();
  const pl=document.getElementById('planList'); if(pl) renderPlanList();
}
// Opdaterer badge-tal, Filtre-knappens farve og synligheden af nulstil-knappen uden at lukke panelet
function refreshFilterChrome(){
  const nActive=excludedTags.size+requiredTraits.size+(onlyFavs?1:0)+(hideRecent?1:0)+(sortMode!=='default'?1:0);
  document.querySelectorAll('.fbar').forEach(bar=>{
    const btn=bar.querySelector('.fbtn2'), bdg=bar.querySelector('.bdg'), reset=bar.querySelector('.freset');
    if(btn) btn.classList.toggle('active', nActive>0);
    if(bdg) bdg.textContent=nActive;
    if(reset) reset.style.display = nActive>0 ? '' : 'none';
  });
}

let current=null, mult=1, lastRandom=-1;
const timers={};

// Fælles filter-UI (forside + ugeplan). Callback angives ved NAVN (global funktion).
function renderFilterUI(containerId, cbName, keepOpen=false){
  const el=document.getElementById(containerId);
  const nActive=excludedTags.size+requiredTraits.size+(onlyFavs?1:0)+(hideRecent?1:0)+(sortMode!=='default'?1:0);
  el.innerHTML=`
    <div class="fbar">
      <input class="fsearch" type="search" placeholder="${T.search_placeholder}" value="${searchText}"
        oninput="searchText=this.value.toLowerCase(); window['${cbName}']()">
      <button class="fbtn2 ${nActive?'active':''}" onclick="this.parentElement.nextElementSibling.classList.toggle('show')">
        ${T.filters_btn} <span class="bdg">${nActive}</span>
      </button>
      <button class="freset" style="display:${nActive?'':'none'}" onclick="resetFilters('${containerId}','${cbName}')" title="${T.select_all}">✕</button>
    </div>
    <div class="fpanel ${keepOpen?'show':''}">
      <div class="fgrp">${T.sort_group}</div>
      <div class="seg sortSeg">
        <button class="seg-btn ${sortMode==='default'?'on':''}" data-mode="default" onclick="setSortMode('default')">${T.sort_default}</button>
        <button class="seg-btn ${sortMode==='time'?'on':''}" data-mode="time" onclick="setSortMode('time')">${T.sort_time}</button>
        <button class="seg-btn ${sortMode==='price'?'on':''}" data-mode="price" onclick="setSortMode('price')">${T.sort_price}</button>
        <button class="seg-btn ${sortMode==='alpha'?'on':''}" data-mode="alpha" onclick="setSortMode('alpha')">${T.sort_alpha}</button>
      </div>
      <div class="fgrp">${T.shortcuts_group}</div>
      <div class="fchips">
        <button class="fchip fav ${onlyFavs?'on':''}" onclick="toggleOnlyFavs('${containerId}','${cbName}')">${T.favorites_only} (${favs.size})</button>
        <button class="fchip fav ${hideRecent?'on':''}" onclick="toggleHideRecent('${containerId}','${cbName}')">${T.hide_recent_btn}</button>
      </div>
      ${TAG_GROUPS.map(([g,tags],gi)=>`
        <div class="fgrp">${g}</div>
        <div class="fchips">
          ${tags.map(t=>{
            const isTrait=gi===1;
            const on=isTrait ? requiredTraits.has(tagCanon(t)) : !excludedTags.has(tagCanon(t));
            const cls=isTrait ? `fchip req ${on?'on':''}` : `fchip ${on?'':'off'}`;
            return `<button class="${cls}" onclick="toggleTag('${t}','${containerId}','${cbName}')">${t}</button>`;
          }).join('')}
        </div>`).join('')}
    </div>`;
}
function toggleTag(t,cid,cbName){
  const c=tagCanon(t);
  if(TRAIT_TAGS.has(t)){
    requiredTraits.has(c)?requiredTraits.delete(c):requiredTraits.add(c);
  }else{
    excludedTags.has(c)?excludedTags.delete(c):excludedTags.add(c);
  }
  saveFilters();
  renderFilterUI(cid,cbName,true); // panel forbliver åbent
  window[cbName]();
}
function toggleOnlyFavs(cid,cbName){
  onlyFavs=!onlyFavs; saveFilters();
  renderFilterUI(cid,cbName,true);
  window[cbName]();
}
function toggleHideRecent(cid,cbName){
  hideRecent=!hideRecent; saveFilters();
  renderFilterUI(cid,cbName,true);
  window[cbName]();
}
function resetFilters(cid,cbName){
  excludedTags.clear(); requiredTraits.clear(); onlyFavs=false; hideRecent=false;
  sortMode='default'; localStorage.setItem('onepot_sort','default');
  saveFilters();
  renderFilterUI(cid,cbName,true);
  window[cbName]();
}
function toggleFav(idx,btn){
  favs.has(idx)?favs.delete(idx):favs.add(idx);
  saveFilters();
  if(btn) btn.textContent=favs.has(idx)?'❤':'♡';
  renderList(); // opdater ❤ på forsidekort
}

// Forside-filtre
renderFilterUI('filters','renderList');

const listEl=document.getElementById('list'), emptyEl=document.getElementById('empty');
function renderList(){
  listEl.innerHTML='';
  const matched=recipes.map((r,i)=>i).filter(i=>matchRecipe(recipes[i]));
  const order=sortIndices(matched);
  emptyEl.classList.toggle('hidden',order.length>0);
  order.forEach(i=>{
    const r=recipes[i];
    const c=document.createElement('button');
    c.className='card';
    c.onclick=()=>openDetail(i);
    c.innerHTML=`<span class="n">${pad(i+1)}</span>
      <span class="mid"><div class="nm">${favs.has(i)?'❤ ':''}${r.name}</div><div class="d">${r.desc}</div></span>
      <span class="meta"><div class="cat">${r.cat}</div><div class="tm">${r.time}</div></span>`;
    listEl.appendChild(c);
  });
}
renderList();

// amount formatting with multiplier
function fmtAmt(val,unit){
  if(val==="") return unit; // e.g. "to garnish"
  let n=parseFloat(val)*mult;
  let s = Number.isInteger(n)? String(n) : fmtNum(n);
  return unit? `${s} ${unit}` : s;
}

function secsToClock(s){const m=Math.floor(s/60),ss=s%60;return `${m}:${String(ss).padStart(2,'0')}`;}
// Lange kogetrin (>3 min) forlænges ~20% ved dobbelt portion; korte trin står
function adjSecs(secs){ return (mult===2 && secs>180) ? Math.round(secs*1.2) : secs; }

// Marker et trin som gjort + alle trin før det
function markStep(el){
  const li=el.closest('.steps li'); if(!li) return;
  const all=[...li.parentElement.children];
  const idx=all.indexOf(li);
  const turnOn=!li.classList.contains('done');
  all.forEach((s,i)=>{
    if(turnOn) s.classList.toggle('done', i<=idx);
    else s.classList.toggle('done', i<idx); // afmarker dette + efterfølgende
  });
}

let detailFromPlan=false;
function openDetail(i, fromPlan=false){
  current=i;
  detailFromPlan=fromPlan;
  mult = fromPlan ? planMult : 1; // fra plan: brug planens portioner, kan ikke ændres
  const r=recipes[i];
  Object.keys(timers).forEach(k=>{clearInterval(timers[k].int);delete timers[k];});
  const portionHTML = fromPlan
    ? `<div class="stats" style="margin-top:14px">
        <div class="stat"><div class="l">${T.stat_persons}</div><div class="v">${planMult===1?'1':'2'}</div></div>
        <div class="stat"><div class="l">${T.stat_time}</div><div class="v" id="time" data-base="${parseInt(r.time)}">${planMult===1?r.time:(parseInt(r.time)+5)+' min'}</div></div>
        <div class="stat"><div class="l">${T.stat_pots}</div><div class="v">1</div></div>
        <div class="stat"><div class="l">${T.stat_leftovers}</div><div class="v" id="rest">${planMult===1?T.leftover_1:T.leftover_2}</div></div>
      </div>`
    : `<div class="portion">
        <div class="lab"><div class="l">${T.stat_persons}</div><div class="v" id="pv">${T.now_rest_1}</div></div>
        <button class="pbtn on" id="p1" onclick="setMult(1)">1<br>${T.ppl_short}</button>
        <button class="pbtn" id="p2" onclick="setMult(2)">2<br>${T.ppl_short}</button>
      </div>
      <div class="stats">
        <div class="stat"><div class="l">${T.stat_time}</div><div class="v" id="time" data-base="${parseInt(r.time)}">${r.time}</div></div>
        <div class="stat"><div class="l">${T.stat_pots}</div><div class="v">1</div></div>
        <div class="stat"><div class="l">${T.stat_leftovers}</div><div class="v" id="rest">${T.leftover_1}</div></div>
      </div>`;
  // Tilbage-knap: fra plan -> tilbage til planen (som stadig er åben under)
  const backBtn=document.querySelector('#detail .dbar .back');
  backBtn.textContent = fromPlan ? T.back_to_plan : T.detail_back_all;
  backBtn.onclick = closeDetail;
  // Randomizer skjules i plan-tilstand (giver ikke mening der)
  document.querySelector('#detail .dbar .dice').style.display = fromPlan ? 'none' : '';
  document.getElementById('dcontent').innerHTML=`
    <div class="dhead">
      <div class="dcat">№ ${pad(i+1)} · ${r.cat}${fromPlan?T.from_plan_suffix:''}</div>
      <h2>${r.name} <button class="fav-h2" id="favBtn" onclick="toggleFav(current,this)">${favs.has(i)?'❤':'♡'}</button></h2>
      <p class="d">${r.desc}</p>
    </div>
    ${portionHTML}
    <div class="sec">${T.ingredients_header}</div>
    <ul class="ing" id="ing">
      ${r.ing.map(([nm,val,unit])=>`
        <li onclick="this.classList.toggle('done')">
          <span class="box"></span>
          <span class="nm">${nm}</span>
          <span class="amt" data-v="${val}" data-u="${unit}">${fmtAmt(val,unit)}</span>
        </li>`).join('')}
    </ul>
    <div class="sec">${T.method_header}</div>
    <ol class="steps">
      ${r.steps.map(([txt,secs],si)=>`
        <li onclick="markStep(this)">
          <span class="stxt">${txt}</span>${secs>0?`
          <div><button class="timer" id="t${si}" data-base="${secs}" onclick="event.stopPropagation();toggleTimer(${si})">
            <span class="ic">⏱</span><span class="tl">${secsToClock(adjSecs(secs))}</span></button></div>`:''}
        </li>`).join('')}
    </ol>
    <div class="note"><b>${T.tip_label}</b> ${r.note}</div>`;
  showView('detail');
}
function closeDetail(){
  Object.keys(timers).forEach(k=>{clearInterval(timers[k].int);delete timers[k];});
  let target='home';
  if(detailFromPlan) target='plan';
  else if(document.getElementById('navSaved').classList.contains('on')) target='saved';
  else if(document.getElementById('navFridge').classList.contains('on')) target='fridge';
  detailFromPlan=false;
  showView(target, true); // bevar scroll-position på destinationen
}
function setMult(m){
  mult=m;
  document.getElementById('p1').classList.toggle('on',m===1);
  document.getElementById('p2').classList.toggle('on',m===2);
  document.getElementById('pv').innerHTML = (m===1) ? T.now_rest_1 : T.now_rest_2;
  const rest=document.getElementById('rest');
  if(rest) rest.textContent=(m===1)?T.leftover_1:T.leftover_2;
  const time=document.getElementById('time');
  if(time){const base=parseInt(time.dataset.base);time.textContent=(m===1?base:base+5)+' min';}
  document.querySelectorAll('#ing .amt').forEach(el=>{
    el.textContent=fmtAmt(el.dataset.v,el.dataset.u);
  });
  // Opdater viste timer-tider (spring dem over der kører lige nu)
  document.querySelectorAll('.timer').forEach(btn=>{
    const idx=btn.id.slice(1);
    if(timers[idx]) return; // kører — lad nedtællingen være
    const base=parseInt(btn.dataset.base);
    btn.querySelector('.tl').textContent=secsToClock(adjSecs(base));
  });
}
function toggleTimer(si){
  const btn=document.getElementById('t'+si), lab=btn.querySelector('.tl');
  const secs=adjSecs(parseInt(btn.dataset.base));
  if(timers[si]){
    clearInterval(timers[si].int); delete timers[si];
    btn.classList.remove('run'); lab.textContent=secsToClock(secs); return;
  }
  let rem=secs; btn.classList.add('run'); lab.textContent=secsToClock(rem);
  timers[si]={int:setInterval(()=>{
    rem--; lab.textContent=secsToClock(rem);
    if(rem<=0){clearInterval(timers[si].int);delete timers[si];
      btn.classList.remove('run');lab.textContent=T.timer_done;
      markStep(btn); // marker trinnet automatisk når timeren udløber
      if(navigator.vibrate)navigator.vibrate([300,150,300]);}
  },1000)};
}
function randomize(){
  const pool=recipes.map((r,i)=>i).filter(i=>matchRecipe(recipes[i])&&i!==lastRandom);
  const src=pool.length?pool:recipes.map((r,i)=>i).filter(i=>matchRecipe(recipes[i]));
  if(!src.length)return;
  const pick=src[Math.floor(Math.random()*src.length)];
  lastRandom=pick; openDetail(pick);
}

/* ===================== UGEPLAN & INDKØBSLISTE ===================== */

// Klassificér ud fra grundingrediensen. Match helord/præfiks, ikke løs substring
// (så 'olivenolie' ikke fanges af 'oliven').
function aisleFor(name){
  const b=baseIngredient(name);
  for(const [aisle,keys] of AISLES){
    if(keys.some(k=> b===k || b.startsWith(k+' ') || b.endsWith(' '+k) || b.includes(' '+k+' '))) return aisle;
  }
  return "Andet";
}
// Estimér pris for en vare-post {base, units}. Ukendt enhed -> pakkepris.
function estimatePrice(e){
  const row=PRICES[e.base];
  if(!row) return 8; // ukendt vare: antag ~8 kr frem for at ignorere
  let total=0;
  for(const [u,q] of e.units){
    if(q===null){ continue; }
    const unit=u||'stk';
    if(row[unit]!==undefined) total+=q*row[unit];
    else if(row.pack!==undefined) total+=row.pack;
    else total+=8;
  }
  if(total===0 && row.pack) total=row.pack;
  return total;
}
function fmtKr(n){ return Math.round(n)+' kr'; }

/* ---------- STORAGE: gemte ugeplaner (localStorage) ---------- */
async function loadPlans(){
  try{ const r=localStorage.getItem('onepot_plans'); return r? JSON.parse(r):[]; }
  catch(e){ return []; }
}
async function savePlans(plans){
  try{ localStorage.setItem('onepot_plans', JSON.stringify(plans)); return true; }
  catch(e){ return false; }
}

let planSel=new Set();   // valgte opskrift-indekser
let planMult=1;          // portioner i ugeplanen
let planRandomN=4;       // slider: antal retter til tilfældig udvælgelse

function openPlan(){
  planSel=new Set(); planMult=1; planRandomN=4;
  renderPlanSelect();
  showView('plan');
}
function closePlan(){
  showPage('saved');
}
function planBack(){
  // Hvis vi er på indkøbslisten, gå tilbage til valg; ellers luk
  if(document.getElementById('shopView')) renderPlanSelect();
  else closePlan();
}

function renderPlanSelect(){
  const c=document.getElementById('pcontent');
  document.getElementById('planBack').textContent=T.plan_back_default;
  document.getElementById('planBack').onclick=closePlan;
  c.innerHTML=`
    <div class="phead">
      <h2>${T.plan_title}</h2>
      <p>${T.plan_desc}</p>
    </div>
    <div class="pport">
      <div class="lab">${T.stat_persons}</div>
      <button id="pp1" class="${planMult===1?'on':''}" onclick="setPlanMult(1)">1</button>
      <button id="pp2" class="${planMult===2?'on':''}" onclick="setPlanMult(2)">2</button>
    </div>
    <div class="pslider">
      <div class="psl-top"><span class="psl-lab">${T.slider_label}</span><span class="psl-val" id="slVal">${planRandomN}</span></div>
      <input type="range" id="planSlider" min="2" max="7" step="1" value="${planRandomN}"
        oninput="onSlider(this.value)">
      <div class="psl-scale"><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span></div>
    </div>
    <div class="prow">
      <button class="primary" onclick="planRandom(planRandomN)">${tf(T.pick_random_btn,{n:planRandomN})}</button>
      <button onclick="planClear()">${T.clear_selection}</button>
    </div>
    <div class="filters" id="planFilters"></div>
    <div class="psel">${T.selected_label} <span class="cnt" id="selCnt">${planSel.size}</span> ${T.recipes_word}</div>
    <div id="planList"></div>
    <div class="pfoot">
      <button class="pgen" id="genBtn" onclick="generateShopping()" ${planSel.size<2?'disabled':''}>
        ${T.generate_list_btn}${planSel.size>=2?` (${planSel.size} ${T.recipes_word})`:''}
      </button>
    </div>`;
  buildPlanFilters();
  renderPlanList();
}
function buildPlanFilters(){
  renderFilterUI('planFilters','renderPlanList');
}
function onSlider(v){
  planRandomN=parseInt(v);
  document.getElementById('slVal').textContent=planRandomN;
  const rb=document.querySelector('.prow .primary');
  if(rb) rb.textContent=tf(T.pick_random_btn,{n:planRandomN});
}
function renderPlanList(){
  const list=document.getElementById('planList');
  const matched=recipes.map((r,i)=>i).filter(i=>matchRecipe(recipes[i]));
  const order=sortIndices(matched);
  list.innerHTML=order.map(i=>{ const r=recipes[i]; return `
    <button class="pcard ${planSel.has(i)?'on':''}" data-idx="${i}" onclick="togglePlan(${i})">
      <span class="pcheck"></span>
      <span class="pmid"><div class="pnm">${r.name}</div><div class="pd">${r.cat} · ${r.time}</div></span>
    </button>`; }).join('') || `<div class="empty" style="padding:30px 0">${T.empty_no_results}</div>`;
}
function refreshPlanFoot(){
  const cnt=document.getElementById('selCnt'); if(cnt)cnt.textContent=planSel.size;
  const btn=document.getElementById('genBtn');
  if(btn){btn.disabled=planSel.size<2;btn.textContent=T.generate_list_btn+(planSel.size>=2?` (${planSel.size} ${T.recipes_word})`:'');}
}
function togglePlan(i){
  if(planSel.has(i)) planSel.delete(i);
  else { if(planSel.size>=7){return;} planSel.add(i); }
  const card=document.querySelector(`.pcard[data-idx="${i}"]`);
  if(card) card.classList.toggle('on',planSel.has(i));
  refreshPlanFoot();
}
function planRandom(n){
  planSel=new Set();
  // vælg blandt retter der matcher filteret
  const idx=recipes.map((r,i)=>i).filter(i=>matchRecipe(recipes[i]));
  for(let k=idx.length-1;k>0;k--){const j=Math.floor(Math.random()*(k+1));[idx[k],idx[j]]=[idx[j],idx[k]];}
  idx.slice(0,n).forEach(i=>planSel.add(i));
  renderPlanList(); refreshPlanFoot();
}
function planClear(){ planSel=new Set(); renderPlanList(); refreshPlanFoot(); }
function setPlanMult(m){
  planMult=m;
  document.getElementById('pp1').classList.toggle('on',m===1);
  document.getElementById('pp2').classList.toggle('on',m===2);
}

// Grund-ingrediens: fjern tilberedning efter komma + normalisér, så former slås sammen
// "Garlic, crushed" og "Garlic, thinly sliced" -> begge "garlic"
function baseIngredient(name){
  let n=name.split(',')[0].trim().toLowerCase();
  n=n.replace(STRIP_RE,'').trim();
  n=n.replace(/\s+/g,' ').trim();
  // "X or Y" / "X el. Y" -> tag første
  n=n.split(OR_SPLIT)[0].trim();
  return SYN[n]||n;
}
// Salt & peber skal aldrig have mængde/antal på indkøbslisten
function isNoQtyStaple(base){ return base===SALTPEPPER_WORD; }
// Omregning til hele/praktiske enheder. Returnér hjælpetekst eller null.
function wholeHint(base, unit, qty){
  if(qty===null) return null;
  const b=base, u=(unit||'').toLowerCase();
  const round=(x)=>{ const r=Math.round(x*2)/2; return Number.isInteger(r)?String(r):r.toString().replace('.',T.decimal_sep);};
  if(b===GARLIC_WORD && u===CLOVE_WORD){
    const n=qty/10;
    if(n<0.8) return null;
    const amt=round(Math.max(1,n));
    return lang==='en' ? `~${amt} bulb${n>1.05?'s':''}` : `~${amt} løg`;
  }
  return null;
}

// Læg ingredienser sammen på tværs af valgte retter (på grund-ingrediens)
function buildShoppingList(){
  const map=new Map(); // key: base -> {display, base, aisle, units:Map(unit->qty|null)}
  planSel.forEach(i=>{
    recipes[i].ing.forEach(([nm,val,unit])=>{
      if(nm.trim().toLowerCase()===WATER_WORD) return; // vand fra hanen
      const base=baseIngredient(nm);
      const num=val!==""?parseFloat(val)*planMult:null;
      let e=map.get(base);
      if(!e){ e={base,display:base.charAt(0).toUpperCase()+base.slice(1),
        aisle:aisleFor(nm),units:new Map(),uses:new Set()}; map.set(base,e); }
      e.uses.add(recipes[i].name);
      const u=unit||'';
      if(e.units.has(u)){
        const cur=e.units.get(u);
        if(cur!==null && num!==null) e.units.set(u,cur+num);
      }else{
        e.units.set(u,num);
      }
    });
  });
  // Hint pr. vare (fx hvidløg fed -> løg / garlic clove -> bulb)
  map.forEach(e=>{
    e.hint=null;
    for(const [u,q] of e.units){ const h=wholeHint(e.base,u,q); if(h){e.hint=h;break;} }
  });
  const order=AISLES.map(a=>a[0]).concat("Andet");
  const groups={};
  map.forEach(e=>{ (groups[e.aisle]=groups[e.aisle]||[]).push(e); });
  const out=[];
  order.forEach(a=>{
    if(groups[a]){
      groups[a].sort((x,y)=>x.display.localeCompare(y.display,SORT_LOCALE));
      out.push([a,groups[a]]);
    }
  });
  return out;
}
// Formatér mængde: tal med samme enhed er lagt sammen; forskellige enheder adskilles med '+'
function fmtQty(e){
  if(isNoQtyStaple(e.base)) return ''; // salt & peber/pepper: ingen mængde
  const parts=[]; let hasReal=false;
  for(const [u,q] of e.units){
    if(q===null){ if(u) parts.push(u); }
    else{
      hasReal=true;
      let s=Number.isInteger(q)?String(q):fmtNum(q);
      let unit=u;
      if(!unit && COUNTABLE.includes(e.base)) unit=(lang==='da') ? 'stk' : '';
      parts.push(unit?`${s} ${unit}`:s);
    }
  }
  let shown = hasReal ? parts.filter(x=>/\d/.test(x)) : parts;
  let base = shown.join(' + ') || '';
  return e.hint?`${base} (${e.hint})`:base;
}
// To tilstande pr. vare: 🏠 har i skabet (påvirker pris) og 🛒 i kurven (påvirker ikke pris)
let haveSet=new Set(), cartSet=new Set(), currentPlanId=null;

// Fælles renderer for indkøbsliste-del (bruges af ny og gemt plan)
function shoppingHTML(groups){
  return `<div class="shop-legend">${T.shop_legend}</div>`+
  groups.map(([aisle,items])=>`
    <div class="shop-cat">${aisle}</div>
    ${items.map(e=>`
      <div class="shop-item ${haveSet.has(e.base)?'have':''} ${cartSet.has(e.base)?'incart':''}"
           data-key="${e.base}" data-price="${e._price||0}">
        <button class="tick h" onclick="toggleState(this,'have')">🏠</button>
        <button class="tick c" onclick="toggleState(this,'cart')">🛒</button>
        <span class="siname">${e.display}
          <button class="uses-b" onclick="this.closest('.shop-item').nextElementSibling.classList.toggle('show')">${e.uses.size} ${e.uses.size>1?T.uses_count_n:T.uses_count_1}</button>
        </span>
        ${fmtQty(e)?`<span class="siamt">${fmtQty(e)}</span>`:''}
      </div>
      <div class="uses-list">${T.used_in} ${[...e.uses].join(' · ')}</div>`).join('')}
  `).join('');
}
function toggleState(btn,type){
  const item=btn.closest('.shop-item');
  const key=item.dataset.key;
  if(type==='have'){
    haveSet.has(key)?haveSet.delete(key):haveSet.add(key);
    item.classList.toggle('have',haveSet.has(key));
    updateShopTotal(); // kun skabet påvirker prisen
  }else{
    cartSet.has(key)?cartSet.delete(key):cartSet.add(key);
    item.classList.toggle('incart',cartSet.has(key));
  }
  persistTicks();
}
// Gem afkrydsninger på den gemte plan (hvis planen er gemt)
async function persistTicks(){
  if(!currentPlanId) return;
  const plans=await loadPlans();
  const p=plans.find(x=>x.id===currentPlanId); if(!p)return;
  p.have=[...haveSet]; p.cart=[...cartSet];
  await savePlans(plans);
}
// PDF/print: generér ren tekst (samme format som Del) og print kun den
function printPlan(){
  const {chosen,groups,total}=currentPlanData();
  document.getElementById('printArea').textContent=planToText(chosen,planMult,total*1.2,groups);
  window.print();
}
function clearTicks(){
  haveSet.clear(); cartSet.clear();
  document.querySelectorAll('.shop-item').forEach(el=>el.classList.remove('have','incart'));
  updateShopTotal();
  persistTicks();
}
function updateShopTotal(){
  const tv=document.getElementById('shopTotal'); if(!tv)return;
  let sum=0;
  document.querySelectorAll('.shop-item:not(.have)').forEach(el=>{ sum+=parseFloat(el.dataset.price)||0; });
  tv.textContent='~'+fmtKr(sum*1.2); // +20% buffer
}
// Fælles UI-dele til indkøbsliste (ny + gemt plan)
function priceBoxHTML(total){
  return `<div class="shop-total">
      <div><div class="tl">${T.estimated_price}</div><div class="tnote">${T.price_note}</div></div>
      <div class="tv" id="shopTotal">~${fmtKr(total*1.2)}</div>
    </div>`;
}
function commonActionsHTML(){
  return `<button class="share" onclick="shareCurrentPlan()">${T.share_btn}</button>
      <button class="share" onclick="printPlan()">${T.pdf_btn}</button>
      <button class="share" onclick="clearTicks()">${T.clear_ticks_btn}</button>`;
}
function generateShopping(){
  if(planSel.size<2)return;
  haveSet=new Set(); cartSet=new Set(); currentPlanId=null; // ny liste = friske krydser
  const groups=buildShoppingList();
  const chosen=[...planSel];
  let total=0;
  groups.forEach(([,items])=>items.forEach(e=>{e._price=estimatePrice(e)||0; total+=e._price;}));
  const c=document.getElementById('pcontent');
  document.getElementById('planBack').textContent=T.edit_plan_back;
  document.getElementById('planBack').onclick=renderPlanSelect;
  c.innerHTML=`
    <div id="shopView">
    <div class="phead">
      <h2>${T.shopping_title}</h2>
      <p>${tf(T.shopping_subtitle,{n:chosen.length, p:planMult===1?T.one_person:T.two_persons})}</p>
    </div>
    ${priceBoxHTML(total)}
    <div class="shop-actions">
      <button class="save" onclick="saveCurrentPlan(this)">${T.save_plan_btn}</button>
      ${commonActionsHTML()}
    </div>
    <div class="shop-plan-list">
      ${chosen.map(i=>`<div class="shop-day"><span class="sn">${recipes[i].name}</span><span class="st">${recipes[i].cat} · ${recipes[i].time}</span></div>`).join('')}
    </div>
    ${shoppingHTML(groups)}
    </div>`;
  window.scrollTo(0,0);
}

// Byg tekst-repræsentation til deling (SMS/Noter/Mail)
function planToText(chosen, mult, total, groups){
  let t=T.share_header+'\n';
  t+=(mult===1?T.one_person:T.two_persons)+' · '+chosen.length+' '+T.recipes_word+'\n\n';
  t+=T.share_recipes_header+'\n';
  chosen.forEach((i,n)=>{ t+=`${n+1}. ${recipes[i].name} (${recipes[i].time})\n`; });
  t+='\n'+T.share_shopping_header+'\n';
  groups.forEach(([aisle,items])=>{
    t+=`\n${aisle}:\n`;
    items.forEach(e=>{ const q=fmtQty(e); t+=`- ${e.display}${q?` — ${q}`:''}\n`; });
  });
  t+='\n'+tf(T.share_price_line,{p:fmtKr(total)});
  return t;
}
function currentPlanData(){
  const chosen=[...planSel];
  const groups=buildShoppingList();
  let total=0;
  groups.forEach(([,items])=>items.forEach(e=>{const pr=estimatePrice(e); if(pr) total+=pr;}));
  return {chosen,groups,total};
}
async function shareCurrentPlan(){
  const {chosen,groups,total}=currentPlanData();
  const text=planToText(chosen,planMult,total*1.2,groups); // samme pris som vist i appen
  if(navigator.share){
    try{ await navigator.share({title:T.share_title,text}); }catch(e){}
  }else{
    try{ await navigator.clipboard.writeText(text); alert(T.share_copied_alert); }
    catch(e){ alert(text); }
  }
}
async function saveCurrentPlan(btn){
  const {chosen}=currentPlanData();
  const plans=await loadPlans();
  const now=new Date();
  const plan={
    id:Date.now(),
    recipes:chosen,
    mult:planMult,
    have:[...haveSet], cart:[...cartSet],
    date:now.toLocaleDateString(T.date_locale,{day:'numeric',month:'long',year:'numeric'})
  };
  plans.unshift(plan);
  const ok=await savePlans(plans);
  if(ok){ await openSavedPlan(plan.id); } // ud af oprettelse, ind på den gemte plan
  else { alert(T.save_error_alert); }
}

/* ---------- SIDENAVIGATION ---------- */
let activeView='home';
const viewScroll={}; // husk scroll-position pr. visning
function showView(name, keepScroll=false){
  viewScroll[activeView]=window.scrollY;
  document.getElementById('homePage').style.display = name==='home'?'block':'none';
  document.getElementById('savedPage').style.display = name==='saved'?'block':'none';
  document.getElementById('fridgePage').style.display = name==='fridge'?'block':'none';
  document.getElementById('plan').classList.toggle('open', name==='plan');
  document.getElementById('detail').classList.toggle('open', name==='detail');
  document.body.classList.toggle('detail-open', name==='detail');
  activeView=name;
  window.scrollTo(0, keepScroll ? (viewScroll[name]||0) : 0);
}
function showPage(page){
  detailFromPlan=false;
  document.getElementById('navHome').classList.toggle('on',page==='home');
  document.getElementById('navSaved').classList.toggle('on',page==='saved');
  document.getElementById('navFridge').classList.toggle('on',page==='fridge');
  if(page==='saved') renderSaved();
  if(page==='fridge') renderFridgePage();
  showView(page);
}
// Beregn en gemt plans pris live — samme formel (+20%) som inde i planen
function planPrice(p){
  const saveSel=planSel, saveMult=planMult;
  planSel=new Set(p.recipes.filter(i=>recipes[i])); planMult=p.mult||1;
  const groups=buildShoppingList();
  const have=new Set(p.have||[]);
  let total=0;
  groups.forEach(([,items])=>items.forEach(e=>{ if(!have.has(e.base)) total+=estimatePrice(e)||0; }));
  planSel=saveSel; planMult=saveMult;
  return Math.round(total*1.2);
}
async function renderSaved(){
  const list=document.getElementById('savedList');
  const plans=await loadPlans();
  if(!plans.length){
    list.innerHTML=`<div class="saved-empty">${T.saved_empty}</div>`;
    return;
  }
  list.innerHTML=plans.map(p=>`
    <div class="saved-card">
      <div class="st-row">
        <div><h3>${p.recipes.length} ${T.recipes_word}</h3><div class="sdate">${p.date} · ${p.mult===1?T.one_person:T.two_persons}</div></div>
        <div class="sprice">~${planPrice(p)} kr</div>
      </div>
      <div class="smeta">${p.recipes.map(i=>recipes[i]?recipes[i].name:'').filter(Boolean).join(' · ')}</div>
      <div class="sbtns">
        <button class="open" onclick="openSavedPlan(${p.id})">${T.open_btn}</button>
        <button class="del" onclick="deleteSavedPlan(${p.id})">${T.delete_btn}</button>
      </div>
    </div>`).join('');
}
async function deleteSavedPlan(id){
  if(!confirm(T.delete_confirm))return;
  let plans=await loadPlans();
  plans=plans.filter(p=>p.id!==id);
  await savePlans(plans);
  renderSaved();
}
// Åbn en gemt plan: vis retter man kan trykke ind på + indkøbsliste
async function openSavedPlan(id){
  const plans=await loadPlans();
  const p=plans.find(x=>x.id===id); if(!p)return;
  planSel=new Set(p.recipes.filter(i=>recipes[i])); planMult=p.mult||1;
  // Genskab gemte krydser og husk plan-id så nye krydser gemmes løbende
  haveSet=new Set(p.have||[]); cartSet=new Set(p.cart||[]); currentPlanId=p.id;
  showView('plan');
  const groups=buildShoppingList();
  let total=0; groups.forEach(([,items])=>items.forEach(e=>{e._price=estimatePrice(e)||0; if(!haveSet.has(e.base)) total+=e._price;}));
  const chosen=[...planSel];
  document.getElementById('planBack').textContent=T.saved_plan_back;
  document.getElementById('planBack').onclick=()=>{showPage('saved');};
  document.getElementById('pcontent').innerHTML=`
    <div class="phead">
      <h2>${T.plan_title}</h2>
      <p>${p.date} · ${chosen.length} ${T.recipes_word} · ${planMult===1?T.one_person:T.two_persons}</p>
    </div>
    <div class="sec" style="border-bottom:2px solid var(--accent);font-weight:800;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);padding-bottom:5px;margin-bottom:4px">${T.recipes_tap_header}</div>
    <div class="plan-recipes">
      ${chosen.map(i=>`
        <button class="plan-recipe" onclick="openRecipeFromPlan(${i})">
          <span class="prn">${recipes[i].name}</span>
          <span class="prt">${recipes[i].cat} · ${recipes[i].time}</span>
          <span class="arr">›</span>
        </button>`).join('')}
    </div>
    ${priceBoxHTML(total)}
    <div class="shop-actions">
      ${commonActionsHTML()}
    </div>
    ${shoppingHTML(groups)}`;
  window.scrollTo(0,0);
}
// Åbn opskrift OVENPÅ planen — let at hoppe ind og ud
function openRecipeFromPlan(i){
  openDetail(i, true); // fromPlan: bruger planens portioner, tilbage -> planen
}

/* ===================== TØM KØLESKABET ===================== */
// Samme mønster som tagCanon(): gemt data er ALTID dansk kanonisk, uanset aktivt sprog
function ingCanon(base){ return lang==='en' ? (ING_EN_TO_DA[base]||base) : base; }
function ingDisplay(canonBase){ return lang==='en' ? (ING_DA_TO_EN[canonBase]||canonBase) : canonBase; }

let haveIngredients=new Set(JSON.parse(localStorage.getItem('onepot_have_ing')||'[]')); // kanoniske (dansk) baser
let fridgeSearch='';
let fridgeView='ing';
function saveHaveIngredients(){
  localStorage.setItem('onepot_have_ing', JSON.stringify([...haveIngredients]));
}
// Master-liste: alle unikke grundingredienser (aktivt sprog) + hvilke retter de bruges i
function buildFridgeMaster(){
  const map=new Map(); // base -> {display, aisle, uses:Set(recipeIndex)}
  recipes.forEach((r,i)=>{
    r.ing.forEach(([nm])=>{
      if(nm.trim().toLowerCase()===WATER_WORD) return;
      const base=baseIngredient(nm);
      let e=map.get(base);
      if(!e){ e={base,display:base.charAt(0).toUpperCase()+base.slice(1),aisle:aisleFor(nm),uses:new Set()}; map.set(base,e); }
      e.uses.add(i);
    });
  });
  const order=AISLES.map(a=>a[0]).concat("Andet");
  const groups={};
  map.forEach(e=>{ (groups[e.aisle]=groups[e.aisle]||[]).push(e); });
  const out=[];
  order.forEach(a=>{
    if(groups[a]){
      groups[a].sort((x,y)=>x.display.localeCompare(y.display,SORT_LOCALE));
      out.push([a,groups[a]]);
    }
  });
  return out;
}
function toggleHaveIngredient(base){
  const c=ingCanon(base);
  haveIngredients.has(c)?haveIngredients.delete(c):haveIngredients.add(c);
  saveHaveIngredients();
}
function clearHaveIngredients(){
  haveIngredients.clear();
  saveHaveIngredients();
  renderFridgePage();
}
function setFridgeView(v){
  fridgeView=v;
  document.getElementById('fvIng').classList.toggle('on',v==='ing');
  document.getElementById('fvRes').classList.toggle('on',v==='res');
  renderFridgeContent();
}
function renderFridgePage(){
  setFridgeView(fridgeView);
}
function renderFridgeContent(){
  const el=document.getElementById('fridgeContent');
  if(fridgeView==='ing'){
    el.innerHTML=`
      <div class="fbar" style="margin-top:14px">
        <input class="fsearch" type="search" placeholder="${T.fridge_search_placeholder}" value="${fridgeSearch}"
          oninput="fridgeSearch=this.value.toLowerCase();renderFridgeIngList()">
        <button class="freset" id="fridgeResetBtn" style="display:${haveIngredients.size?'':'none'}" onclick="clearHaveIngredients()" title="${T.fridge_clear_btn}">✕</button>
      </div>
      <div class="fridge-count" id="fridgeCountLbl">${tf(T.fridge_have_count,{n:haveIngredients.size})}</div>
      <ul class="ing fridgeList" id="fridgeListEl"></ul>`;
    renderFridgeIngList();
  } else {
    el.innerHTML=fridgeResultsHTML();
  }
}
// Opdaterer KUN selve ingredienslisten (ikke søgefeltet) — bevarer fokus/cursor ved tastning
function renderFridgeIngList(){
  const listEl=document.getElementById('fridgeListEl');
  if(!listEl) return;
  const groups=buildFridgeMaster();
  const q=fridgeSearch;
  let any=false;
  const body=groups.map(([aisle,items])=>{
    const shown=items.filter(e=>!q || e.display.toLowerCase().includes(q));
    if(!shown.length) return '';
    any=true;
    return `<div class="shop-cat">${aisle}</div>
      ${shown.map(e=>`
        <li class="ing fridgeIng ${haveIngredients.has(ingCanon(e.base))?'done':''}" onclick="this.classList.toggle('done');toggleHaveIngredient('${e.base.replace(/'/g,"\\'")}');refreshFridgeCount()">
          <span class="box"></span><span class="nm">${e.display}</span>
        </li>`).join('')}`;
  }).join('');
  listEl.innerHTML = any?body:`<div class="empty">${T.empty_no_results}</div>`;
}
// Opdaterer optæller + nulstil-knap uden at rykke ved selve listen/søgefeltet
function refreshFridgeCount(){
  const lbl=document.getElementById('fridgeCountLbl');
  const btn=document.getElementById('fridgeResetBtn');
  if(lbl) lbl.textContent=tf(T.fridge_have_count,{n:haveIngredients.size});
  if(btn) btn.style.display = haveIngredients.size?'':'none';
}
function fridgeResultsHTML(){
  if(!haveIngredients.size) return `<div class="saved-empty">${T.fridge_empty_hint}</div>`;
  const pool=recipes.map((r,i)=>i).filter(i=>matchRecipe(recipes[i]));
  const scored=pool.map(i=>{
    const real=recipes[i].ing.filter(([nm])=>nm.trim().toLowerCase()!==WATER_WORD);
    const haveN=real.filter(([nm])=>haveIngredients.has(ingCanon(baseIngredient(nm)))).length;
    return {i, have:haveN, total:real.length};
  }).filter(x=>x.have>0)
    .sort((a,b)=> (b.have/b.total)-(a.have/a.total) || b.have-a.have);
  if(!scored.length) return `<div class="saved-empty">${T.fridge_no_match_hint}</div>`;
  return scored.map(({i,have,total})=>{
    const r=recipes[i];
    const pct=Math.round(have/total*100);
    return `<button class="card" onclick="openDetail(${i})">
      <span class="n">${pad(i+1)}</span>
      <span class="mid"><div class="nm">${favs.has(i)?'❤ ':''}${r.name}</div><div class="d">${r.desc}</div></span>
      <span class="meta"><div class="matchbdg" style="--pct:${pct}%">${tf(T.fridge_match_label,{have,total})}</div><div class="tm">${r.time}</div></span>
    </button>`;
  }).join('');
}

// Install-boks: vis på iOS og Android, ikke når appen kører fra hjemmeskærm
function dismissInstall(){
  document.getElementById('install').classList.remove('show','eligible');
}
function renderInstallContent(){
  const install=document.getElementById('install');
  const content=document.getElementById('installContent');
  if(!install || !content) return;
  const ua=navigator.userAgent;
  const isIOS=/iPhone|iPad|iPod/.test(ua);
  const isAndroid=/Android/.test(ua);
  const platform=isIOS?'ios':isAndroid?'android':'ios';
  install.classList.toggle('android', platform==='android');
  install.classList.toggle('ios', platform==='ios');
  content.innerHTML = platform==='android' ? `
    <h3>${T.android_h3}</h3>
    <p>${T.android_p}</p>
    <div class="step"><span class="badge">1</span><div><strong>${T.android_step1a}</strong>${T.android_step1b}</div></div>
    <div class="step"><span class="badge">2</span><div><strong>${T.android_step2a}</strong>${T.android_step2b}</div></div>
    <div class="step"><span class="badge">3</span><div><strong>${T.android_step3a}</strong>${T.android_step3b}</div></div>
  ` : `
    <h3>${T.ios_h3}</h3>
    <p>${T.ios_p}</p>
    <div class="step"><span class="badge">1</span> ${T.ios_step1}</div>
    <div class="step"><span class="badge">2</span> ${T.ios_step2a}
      <svg class="sicon" width="15" height="18" viewBox="0 0 15 18" fill="none"><path d="M7.5 1v11M4 4l3.5-3L11 4" stroke="#ff4a1c" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 8v7.5a1 1 0 001 1h9a1 1 0 001-1V8" stroke="#ff4a1c" stroke-width="1.6" stroke-linecap="round"/></svg>
      ${T.ios_step2b}
    </div>
    <div class="step"><span class="badge">3</span> ${T.ios_step3}</div>
  `;
}
(function initInstall(){
  const standalone = window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua);
  const isAndroid = /Android/.test(ua);
  // Vis kun hvis: på iOS eller Android, ikke allerede app, og ikke lukket i denne session
  if((isIOS || isAndroid) && !standalone && !sessionStorage.getItem('hideInstall')){
    renderInstallContent();
    document.getElementById('install').classList.add('eligible'); // deltag i layout først nu
    setTimeout(()=>document.getElementById('install').classList.add('show'), 1200);
  }
})();
// Husk luk for resten af sessionen
document.querySelector('#install .x').addEventListener('click',()=>{
  try{ sessionStorage.setItem('hideInstall','1'); }catch(e){}
});

/* ---------- SWIPE TILBAGE (fra venstre kant) ---------- */
function addSwipeBack(el, backFn){
  let sx=0, sy=0, active=false;
  el.addEventListener('touchstart',e=>{
    const t=e.touches[0];
    if(t.clientX<40){ sx=t.clientX; sy=t.clientY; active=true; }
    else active=false;
  },{passive:true});
  el.addEventListener('touchend',e=>{
    if(!active) return;
    const t=e.changedTouches[0];
    const dx=t.clientX-sx, dy=Math.abs(t.clientY-sy);
    if(dx>80 && dy<70) backFn();
    active=false;
  },{passive:true});
}
addSwipeBack(document.getElementById('detail'), ()=>closeDetail());
addSwipeBack(document.getElementById('plan'), ()=>{
  const b=document.getElementById('planBack');
  if(b && b.onclick) b.onclick(); else closePlan();
});

/* ---------- ZOOM-LÅS (iOS ignorerer delvist viewport-meta) ---------- */
document.addEventListener('gesturestart', e=>e.preventDefault()); // knib-zoom

/* ---------- TEMA (dark/light) ---------- */
let theme=localStorage.getItem('onepot_theme')||'dark';
function applyTheme(){
  document.body.classList.toggle('light', theme==='light');
  document.getElementById('segDark').classList.toggle('on', theme==='dark');
  document.getElementById('segLight').classList.toggle('on', theme==='light');
  const mc=document.querySelector('meta[name="theme-color"]');
  if(mc) mc.setAttribute('content', theme==='light' ? '#f7f2ec' : '#141210');
}
function setTheme(t){
  theme=t;
  localStorage.setItem('onepot_theme', theme);
  applyTheme();
}
applyTheme();

/* ---------- SPROG: gem valg + genindlæs (samme mønster som tema) ---------- */
function applyLangSegUI(){
  const da=document.getElementById('segDa'), en=document.getElementById('segEn');
  if(da) da.classList.toggle('on', lang==='da');
  if(en) en.classList.toggle('on', lang==='en');
}
applyLangSegUI();
function setLang(l){
  if(l===lang) return;
  localStorage.setItem('onepot_lang', l);
  location.reload();
}

/* ---------- INDSTILLINGER (popup) ---------- */
function openSettings(){ document.getElementById('settingsBackdrop').classList.add('show'); }
function closeSettings(){ document.getElementById('settingsBackdrop').classList.remove('show'); }

/* ---------- VERSION ---------- */
const APP_VERSION='v2.1.2';
document.getElementById('setVerBtn').textContent=APP_VERSION+' ✓';
let updateAvailable=false;
async function checkVersion(){
  try{
    const r=await fetch('sw.js?ts='+Date.now(),{cache:'no-store'});
    const t=await r.text();
    const m=t.match(/onepot-(v[\d.]+)/);
    if(!m) return;
    updateAvailable = m[1]!==APP_VERSION;
    const vb=document.getElementById('setVerBtn');
    vb.textContent = updateAvailable ? APP_VERSION+' ⟳' : APP_VERSION+' ✓';
    vb.classList.toggle('upd',updateAvailable);
    document.getElementById('gearBtn').classList.toggle('upd',updateAvailable);
  }catch(e){ /* offline: vis bare versionen */ }
}
checkVersion();
// Tryk på versionen = tving opdatering
async function forceUpdate(btn){
  btn.textContent=APP_VERSION+' …';
  try{
    const reg=await navigator.serviceWorker.getRegistration();
    if(reg) await reg.update();
  }catch(e){}
  // controllerchange genindlæser hvis ny SW tager over; fallback-reload efter kort ventetid
  setTimeout(()=>location.reload(),1200);
}

// Offline + stille auto-opdatering
if('serviceWorker' in navigator){
  let reloading=false;
  // Når en ny service worker tager over, genindlæs stille én gang
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(reloading) return;
    reloading=true;
    location.reload();
  });
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('sw.js').then(reg=>{
      // Tjek for opdatering ved hver åbning
      reg.update().catch(()=>{});
      // Når en ny version er hentet og klar, aktivér den med det samme
      reg.addEventListener('updatefound',()=>{
        const nw=reg.installing;
        if(!nw) return;
        nw.addEventListener('statechange',()=>{
          if(nw.state==='installed' && navigator.serviceWorker.controller){
            nw.postMessage({type:'SKIP_WAITING'});
          }
        });
      });
    }).catch(()=>{});
  });
}
