/* Crimson Grid Atlas. Static and dependency-free; works under any Pages subpath. */
(() => {
'use strict';
const $=id=>document.getElementById(id), D=window.MAP_DATA;
if(!D){$('current-map').textContent='Map data failed to load';return;}
const canvas=$('map-canvas'),ctx=canvas.getContext('2d'),view=$('map-view');
let map=D.maps[0],level=map.levels.find(l=>l.id==='city-2'),cx=level.w/2,cy=level.h/2,zoom=3,W=1,H=1,dpr=1;
let dirty=false,labels=true,links=true,hitboxes=[],hover=null,flash=null,selectedArea=null;
let history=[],toastTimer,hashTimer,moveOrigin=null,lastPointer=null,pinch=null;
const pointers=new Map(),images=new Map(),grids=new Map(),errors=new Set();
const colors={stairs:'#f4bf68',ramp:'#f4bf68',ladder:'#62dfcc',manhole:'#62dfcc',portal:'#c89aff',transfer:'#c89aff',elevator:'#80baff'};
const glyphs={stairs:'↗',ramp:'↗',ladder:'↕',manhole:'↕',portal:'◇',transfer:'↔',elevator:'E'};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function levelBy(id){return map.levels.find(l=>l.id===id);}
function project(x,y){return [(x-.5-cx)*zoom+W/2,(cy-y+.5)*zoom+H/2];}
function unproject(x,y){return {x:cx+(x-W/2)/zoom+.5,y:cy-(y-H/2)/zoom+.5};}
function snapshot(){return {map:map.id,level:level.id,cx,cy,zoom};}
function remember(){history.push(snapshot());if(history.length>80)history.shift();$('back').disabled=false;}
function restore(s){map=D.maps.find(m=>m.id===s.map);level=levelBy(s.level);cx=s.cx;cy=s.cy;zoom=s.zoom;refresh();}
function back(){if(!history.length)return;restore(history.pop());$('back').disabled=!history.length;notify('Returned to previous view');}
function schedule(){if(!dirty){dirty=true;requestAnimationFrame(draw);}clearTimeout(hashTimer);hashTimer=setTimeout(writeHash,220);}
function writeHash(){const p=new URLSearchParams({map:map.id,level:level.id,x:cx.toFixed(2),y:cy.toFixed(2),zoom:zoom.toFixed(3)});window.history.replaceState(null,'','#'+p);}
function fit(){cx=level.w/2;cy=level.h/2;zoom=Math.min((W-70)/level.w,(H-110)/level.h);zoom=Math.max(.5,zoom);selectedArea=null;schedule();}
function image(url){let e=images.get(url);if(e){e.used=performance.now();return e.ready?e.img:null;}const img=new Image();e={img,ready:false,used:performance.now()};images.set(url,e);img.onload=()=>{e.ready=true;errors.delete(url);$('load-error').hidden=!errors.size;schedule();};img.onerror=()=>{errors.add(url);$('load-error').hidden=false;};img.src=url;return null;}
function drawMap(){
  const left=(0-cx)*zoom+W/2,top=(cy-level.h)*zoom+H/2;
  const base='assets/'+level.image+'/';const overview=image(base+'overview.webp');
  ctx.imageSmoothingEnabled=zoom<12;
  if(overview)ctx.drawImage(overview,left,top,level.w*zoom,level.h*zoom);
  if(zoom>5){const ppc=zoom<=16?16:32,span=512/ppc;
    const x0=Math.max(0,Math.floor(-left/(span*zoom))),x1=Math.min(Math.ceil(level.w/span)-1,Math.floor((W-left)/(span*zoom)));
    const y0=Math.max(0,Math.floor(-top/(span*zoom))),y1=Math.min(Math.ceil(level.h/span)-1,Math.floor((H-top)/(span*zoom)));
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const im=image(base+ppc+'/'+x+'_'+y+'.webp');if(im)ctx.drawImage(im,left+x*span*zoom,top+y*span*zoom,im.width/ppc*zoom,im.height/ppc*zoom);}
  }
  if(images.size>190){const old=[...images.entries()].filter(([u,e])=>!u.endsWith('overview.webp')&&e.ready).sort((a,b)=>a[1].used-b[1].used);for(const [u] of old.slice(0,images.size-160))images.delete(u);}
}
function overlap(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
function drawLabels(occupied){
  ctx.textAlign='center';ctx.textBaseline='middle';
  for(const a of level.labels){if(a.generic||a.size<(zoom<4?90:zoom<8?30:8))continue;
    const [x,y]=project(a.x,a.y);if(x<0||x>W||y<0||y>H-40)continue;
    const fs=zoom<5?12:13;ctx.font=`600 ${fs}px system-ui`;const tw=ctx.measureText(a.name).width;
    const b={x:x-tw/2-7,y:y-12,w:tw+14,h:24};if(occupied.some(o=>overlap(b,o)))continue;occupied.push(b);
    ctx.fillStyle='#0b121de8';ctx.strokeStyle='#74819570';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(b.x,b.y,b.w,b.h,4);ctx.fill();ctx.stroke();ctx.fillStyle='#e4edf4';ctx.fillText(a.name,x,y);
  }
}
function drawNodes(){
  hitboxes=[];const occupied=[];
  if(!links)return occupied;
  const nodes=map.nodes.filter(n=>n.level===level.id).sort((a,b)=>(!!a.to.length)-(!!b.to.length));
  for(const n of nodes){const [x,y]=project(n.x,n.y);if(x< -20||x>W+20||y< -20||y>H+20)continue;
    // Avoid concealing adjacent stairs at overview scales. Every link is available via Links.
    const r=zoom<5?5:zoom<10?8:11;
    if(zoom<7&&hitboxes.some(h=>Math.hypot(h.x-x,h.y-y)<r*1.8&&h.n.kind===n.kind&&h.n.to.length&&n.to.length))continue;
    const color=n.to.length?(colors[n.kind]||'#c89aff'):'#798591';
    ctx.beginPath();ctx.arc(x,y,r+2,0,Math.PI*2);ctx.fillStyle='#09111ce6';ctx.fill();
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.lineWidth=1;ctx.strokeStyle='#f5ffff80';ctx.stroke();
    if(r>=8){ctx.font=`bold ${r+2}px system-ui`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#101922';ctx.fillText(n.to.length?(glyphs[n.kind]||'↔'):'·',x,y);}
    hitboxes.push({x,y,r:Math.max(r+5,12),n});occupied.push({x:x-r-4,y:y-r-4,w:r*2+8,h:r*2+8});
  }return occupied;
}
function draw(){dirty=false;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#11161d';ctx.fillRect(0,0,W,H);drawMap();
  if(selectedArea){const a=selectedArea.bounds,[x1,y1]=project(a[0]-.5,a[3]+.5),[x2,y2]=project(a[2]+.5,a[1]-.5);ctx.strokeStyle='#66ddc2';ctx.lineWidth=2;ctx.setLineDash([6,4]);ctx.strokeRect(x1,y1,x2-x1,y2-y1);ctx.setLineDash([]);}
  const occupied=drawNodes();occupied.push({x:0,y:0,w:W,h:60},{x:0,y:H-44,w:W,h:44});if(labels)drawLabels(occupied);
  if(flash&&flash.level===level.id){const [x,y]=project(flash.x,flash.y);ctx.beginPath();ctx.arc(x,y,23,0,Math.PI*2);ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();ctx.beginPath();ctx.arc(x,y,28,0,Math.PI*2);ctx.strokeStyle='#66ddc2';ctx.stroke();}
  const cells=Math.max(1,Math.round(70/zoom));$('scale').textContent=cells+' tiles';$('scale').style.width=Math.min(130,cells*zoom)+'px';
}
function notify(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3300);}
function hidePanels(){$('destination-panel').hidden=true;$('tooltip').hidden=true;hover=null;}
function refresh(){
  hidePanels();flash=null;selectedArea=null;$('current-map').textContent=map.name;$('map-select').value=map.id;$('layer-badge').textContent=level.name;
  $('levels').innerHTML='';for(const l of [...map.levels].sort((a,b)=>a.group===b.group?b.z-a.z:a.group==='city'?-1:1)){const b=document.createElement('button');b.className='level'+(l===level?' active':'')+(l.group==='umbra'?' umbra':'');b.setAttribute('aria-pressed',String(l===level));b.innerHTML=`<span class="level-tag">${l.group==='umbra'?'U':('Z'+l.z)}</span><span class="level-name">${esc(l.group==='umbra'?'Umbra':l.name.split(' · ')[1])}</span>`;b.onclick=()=>{if(l===level)return;remember();level=l;refresh();closeMobile();};$('levels').append(b);}
  $('layer-count').textContent=map.levels.length+' layers';listAreas();schedule();
}
function listAreas(){
  const q=$('search').value.trim().toLowerCase();const pool=q?map.levels:[level];const found=[];const seen=new Set();
  for(const l of pool)for(const a of l.labels){if(a.generic||!a.name.toLowerCase().includes(q))continue;const key=l.id+':'+a.area;if(seen.has(key))continue;seen.add(key);found.push({...a,level:l});}
  found.sort((a,b)=>a.name.localeCompare(b.name));$('area-count').textContent=found.length;$('areas').innerHTML='';
  if(!found.length){$('areas').innerHTML='<div class="empty">No matching named areas.</div>';return;}
  for(const a of found){const b=document.createElement('button');b.className='area-item';b.innerHTML=`<span>${esc(a.name)}</span>${q?`<small>${esc(a.level.name)}</small>`:''}`;b.onclick=()=>{remember();level=a.level;refresh();cx=a.x-.5;cy=a.y-.5;zoom=Math.max(8,Math.min(24,(W-100)/(a.bounds[2]-a.bounds[0]+8),(H-140)/(a.bounds[3]-a.bounds[1]+8)));selectedArea=a;schedule();closeMobile();};$('areas').append(b);}
}
function jump(n,destination){
  const dest=map.nodes[destination];if(!dest||!n.to.includes(dest.id))return;
  remember();const dx=dest.x-n.x,dy=dest.y-n.y;
  // Projected destination = projected origin: same zoom, same pixel position.
  cx+=dx;cy+=dy;level=levelBy(dest.level);refresh();flash=dest;schedule();
  setTimeout(()=>{if(flash===dest){flash=null;schedule();}},3500);
  notify(dest.area+' · '+level.name);$('hint').style.opacity='0';closeMobile();
}
function activate(n){
  hidePanels();if(n.to.length===1){jump(n,n.to[0]);return;}
  if(!n.to.length){notify(n.oneWay?'One-way arrival point — no return route here.':n.unresolved||'No mapped destination.');return;}
  $('destination-title').textContent=n.label;$('destination-list').innerHTML='';
  for(const id of n.to){const dest=map.nodes[id];const b=document.createElement('button');b.innerHTML=`${esc(dest.area)}<small>${esc(levelBy(dest.level).name)} · (${dest.x}, ${dest.y})</small>`;b.onclick=()=>jump(n,id);$('destination-list').append(b);}
  $('destination-panel').hidden=false;$('destination-list').querySelector('button')?.focus();
}
function visibleLinks(){hidePanels();$('destination-title').textContent='Transitions in this view';$('destination-list').innerHTML='';
  const ns=map.nodes.filter(n=>{const [x,y]=project(n.x,n.y);return n.level===level.id&&x>=0&&x<=W&&y>=0&&y<=H;});
  for(const n of ns){const b=document.createElement('button');b.innerHTML=`${esc(n.label)}<small>${esc(n.area)} · ${n.to.length?n.to.length+' destination'+(n.to.length===1?'':'s'):n.oneWay?'One-way exit':'Unresolved'}</small>`;b.onclick=()=>activate(n);$('destination-list').append(b);}
  if(!ns.length)$('destination-list').innerHTML='<p class="empty">No transitions in view. Zoom out or pan to another area.</p>';
  $('destination-panel').hidden=false;$('destination-list').querySelector('button')?.focus();
}
function areaAt(x,y){if(x<1||y<1||x>level.w||y>level.h)return 'Outside map';const key=map.id+':'+level.id;let g=grids.get(key);if(!g){const bytes=Uint8Array.from(atob(level.grid),c=>c.charCodeAt(0));g=new DataView(bytes.buffer);grids.set(key,g);}return map.areas[g.getUint16(((level.h-y)*level.w+x-1)*2,true)]||'Unknown area';}
function pointerPos(e){const r=canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
function hit(p){return hitboxes.filter(h=>Math.hypot(h.x-p.x,h.y-p.y)<h.r).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0]?.n;}
function pointerHover(p){const n=hit(p);hover=n;canvas.style.cursor=n?'pointer':'grab';const w=unproject(p.x,p.y),x=Math.floor(w.x+.5),y=Math.floor(w.y+.5);$('position').textContent=`${areaAt(x,y)} · ${x}, ${y}`;
  if(!n){$('tooltip').hidden=true;return;}let dest=n.to.map(id=>{const d=map.nodes[id];return d.area+' · '+levelBy(d.level).name;}).join(' / ');
  $('tooltip').innerHTML=`<strong>${esc(n.label)}</strong>${esc(n.area)}<span>${esc(n.to.length?'→ '+dest:n.oneWay?'One-way arrival point':n.unresolved||'No mapped destination')}</span>${n.to.length?'<span>Click to '+(n.to.length===1?'follow':'choose destination')+'</span>':''}`;
  $('tooltip').hidden=false;const r=$('tooltip').getBoundingClientRect();$('tooltip').style.left=Math.max(6,Math.min(W-r.width-8,p.x+17))+'px';$('tooltip').style.top=Math.max(65,Math.min(H-r.height-50,p.y+17))+'px';
  for(const id of n.to){image('assets/'+levelBy(map.nodes[id].level).image+'/overview.webp');}
}
function zoomAt(factor,p={x:W/2,y:H/2}){const old=zoom;zoom=Math.max(.5,Math.min(64,zoom*factor));cx+=(p.x-W/2)*(1/old-1/zoom);cy-=(p.y-H/2)*(1/old-1/zoom);hidePanels();schedule();}
canvas.addEventListener('wheel',e=>{e.preventDefault();zoomAt(Math.exp(-e.deltaY*.0015),pointerPos(e));$('hint').style.opacity='0';},{passive:false});
canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;const p=pointerPos(e);pointers.set(e.pointerId,p);canvas.setPointerCapture(e.pointerId);lastPointer=p;moveOrigin={...p,cx,cy,moved:false};canvas.classList.add('dragging');hidePanels();if(pointers.size===2){const [a,b]=[...pointers.values()];pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}};moveOrigin.moved=true;}});
canvas.addEventListener('pointermove',e=>{const p=pointerPos(e);if(!pointers.has(e.pointerId)){pointerHover(p);return;}pointers.set(e.pointerId,p);
  if(pointers.size===2){const [a,b]=[...pointers.values()],distance=Math.hypot(a.x-b.x,a.y-b.y),center={x:(a.x+b.x)/2,y:(a.y+b.y)/2};if(pinch&&pinch.distance>0){cx-=(center.x-pinch.center.x)/zoom;cy+=(center.y-pinch.center.y)/zoom;zoomAt(distance/pinch.distance,center);}pinch={distance,center};moveOrigin.moved=true;}
  else if(moveOrigin){if(Math.hypot(p.x-moveOrigin.x,p.y-moveOrigin.y)>4)moveOrigin.moved=true;cx-=(p.x-lastPointer.x)/zoom;cy+=(p.y-lastPointer.y)/zoom;lastPointer=p;schedule();}if(moveOrigin?.moved)$('hint').style.opacity='0';
});
function endPointer(e,cancel=false){const p=pointerPos(e),wasPinch=!!pinch,moved=moveOrigin?.moved;pointers.delete(e.pointerId);canvas.classList.remove('dragging');pinch=null;if(!cancel&&!moved&&!wasPinch){const n=hit(p);if(n)activate(n);}if(pointers.size){lastPointer=[...pointers.values()][0];moveOrigin={...lastPointer,cx,cy,moved:true};}else moveOrigin=null;schedule();}
canvas.addEventListener('pointerup',e=>endPointer(e));canvas.addEventListener('pointercancel',e=>endPointer(e,true));canvas.addEventListener('pointerleave',()=>{$('tooltip').hidden=true;});
canvas.addEventListener('dblclick',e=>{if(!hit(pointerPos(e)))zoomAt(1.7,pointerPos(e));});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){hidePanels();closeMobile();}if(e.altKey&&e.key==='ArrowLeft'){e.preventDefault();back();return;}if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||$('notes').open)return;const amount=80/zoom;let handled=true;switch(e.key){case '+':case '=':zoomAt(1.4);break;case '-':zoomAt(1/1.4);break;case 'f':case 'F':remember();fit();break;case 'ArrowLeft':cx-=amount;break;case 'ArrowRight':cx+=amount;break;case 'ArrowUp':cy+=amount;break;case 'ArrowDown':cy-=amount;break;default:handled=false;}if(handled){e.preventDefault();schedule();}});
function closeMobile(){$('sidebar').classList.remove('open');$('menu').setAttribute('aria-expanded','false');}
$('menu').onclick=()=>{const on=$('sidebar').classList.toggle('open');$('menu').setAttribute('aria-expanded',String(on));};
$('back').onclick=back;$('fit').onclick=()=>{remember();fit();};$('zoom-in').onclick=()=>zoomAt(1.5);$('zoom-out').onclick=()=>zoomAt(1/1.5);$('visible-links').onclick=visibleLinks;$('close-destination').onclick=hidePanels;
$('labels-toggle').onchange=e=>{labels=e.target.checked;schedule();};$('links-toggle').onchange=e=>{links=e.target.checked;schedule();};$('search').oninput=listAreas;
$('about').onclick=()=>$('notes').showModal();$('close-notes').onclick=()=>$('notes').close();$('retry').onclick=()=>{for(const url of errors)images.delete(url);errors.clear();$('load-error').hidden=true;schedule();};
for(const m of D.maps){const o=document.createElement('option');o.value=m.id;o.textContent=m.name;$('map-select').append(o);}
$('map-select').onchange=e=>{remember();map=D.maps.find(m=>m.id===e.target.value);level=map.levels.find(l=>l.id==='city-2')||map.levels[0];$('search').value='';refresh();fit();};
$('revision').textContent='Wheezel · '+D.commit.slice(0,7)+' · '+D.snapshotDate;
$('source').href=D.source+'/tree/'+D.commit;
$('source-detail').innerHTML=`Source snapshot: <a href="${esc(D.source+'/tree/'+D.commit)}" target="_blank" rel="noopener">Wheezel/crimson-grid @ ${esc(D.commit.slice(0,7))}</a> · ${esc(D.snapshotDate)}. See <a href="transition-audit.json">unresolved transfer IDs</a>.`;
let loadedHash=false;function readHash(){const p=new URLSearchParams(location.hash.slice(1)),m=D.maps.find(m=>m.id===p.get('map'));if(!m)return false;const l=m.levels.find(l=>l.id===p.get('level'));const x=Number(p.get('x')),y=Number(p.get('y')),z=Number(p.get('zoom'));if(!l||![x,y,z].every(Number.isFinite)||z<.5||z>64||Math.abs(x)>10000||Math.abs(y)>10000)return false;map=m;level=l;cx=x;cy=y;zoom=z;return true;}
loadedHash=readHash();window.addEventListener('hashchange',()=>{if(readHash())refresh();});
new ResizeObserver(()=>{const r=view.getBoundingClientRect();W=r.width;H=r.height;dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);if(!loadedHash){fit();loadedHash=true;}schedule();}).observe(view);
refresh();
// Read-only diagnostics make the alignment contract straightforward to verify.
window.atlas={state:()=>({...snapshot(),width:W,height:H}),project:(x,y)=>project(x,y),nodes:()=>map.nodes,activate,jump,back,fit,restore};
})();
