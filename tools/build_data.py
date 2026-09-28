#!/usr/bin/env python3
"""Extract area geometry and source-resolved transitions from Crimson Grid TGM maps.
Usage: python tools/build_data.py /path/to/crimson-grid --commit SHA
Requires numpy and scipy. Source and renderer inputs are kept outside the website.
"""
import argparse, base64, collections, datetime, functools, json, re
from pathlib import Path
import numpy as np
from scipy import ndimage

ap = argparse.ArgumentParser()
ap.add_argument('source', type=Path)
ap.add_argument('--commit', default='unknown')
ap.add_argument('--snapshot-date', default=datetime.date.today().isoformat())
args = ap.parse_args()
SRC = args.source
OUT = Path(__file__).resolve().parents[1]
types = collections.defaultdict(dict)

def value(s):
    s = s.strip().rstrip(';').strip()
    quoted=re.match(r'^"((?:\\.|[^"\\])*)"',s)
    if quoted:
        return quoted[1].replace('\\improper ', '').replace('\\proper ', '').replace('\\"', '"')
    s=s.split('//')[0].strip().rstrip(';').strip()
    if s in ['TRUE', 'FALSE']: return s == 'TRUE'
    try: return int(s)
    except ValueError: return s

def properties(body):
    return {m[1]: value(m[2]) for m in re.finditer(r'^\s*(?:var/)?(\w+)\s*=\s*(.*?)\s*;?\s*$', body, re.M)}

for inc in re.findall(r'^#include "([^"]+)"', (SRC/'tgstation.dme').read_text(), re.M):
    path = SRC / inc.replace('\\', '/')
    if path.suffix != '.dm' or not path.is_file(): continue
    text = path.read_text(errors='replace')
    for m in re.finditer(r'^(/(?:area|obj/transfer_point_vamp|obj/structure/(?:stairs|ladder))[^\s(]*)\s*\n((?:[ \t][^\n]*\n|\n)*)', text, re.M):
        types[m[1]].update(properties(m[2]))

@functools.lru_cache(None)
def inherited(path):
    parent = path.rpartition('/')[0]
    return {**(inherited(parent) if parent else {}), **types.get(path, {})}

def atoms(text):
    # TGM atoms occupy individual lines; braces contain variable edits.
    out=[]
    for m in re.finditer(r'^(/[^\s{},()]+)(?:\{(.*?)\})?\s*(?:,|$)', text, re.M|re.S):
        out.append((m[1], {**inherited(m[1]), **properties(m[2] or '')}))
    return out

def readmap(path):
    text=path.read_text()
    dictionary={m[1]:atoms(m[2]) for m in re.finditer(r'^"(\w+)" = \((.*?)\)\s*(?=^"\w+" =|^\(\d+,\d+,\d+\) =|\Z)',text,re.M|re.S)}
    assert dictionary, f'No TGM dictionary: {path}'
    n=len(next(iter(dictionary)))
    blocks=re.findall(r'^\((\d+),(\d+),(\d+)\) = \{"\n(.*?)\n"\}',text,re.M|re.S)
    w=max(int(x)+len(b.splitlines()[0])//n-1 for x,y,z,b in blocks)
    h=max(int(y)+len(b.splitlines())-1 for x,y,z,b in blocks)
    grids=collections.defaultdict(dict)
    for xs,ys,zs,b in blocks:
        rows=b.splitlines()
        for j,row in enumerate(rows):
            for i in range(0,len(row),n):
                grids[int(zs)][int(xs)+i//n,int(ys)+len(rows)-1-j]=dictionary[row[i:i+n]]
    assert all(len(g)==w*h for g in grids.values()), f'Incomplete grid in {path}'
    return w,h,grids

allmaps=[]
report=[]
for key,configfile in [('oakland','bomby_oakland'),('sanfangsisco','sanfangsisco'),('westfield','westfieldmall')]:
    config=json.loads((SRC/'_maps'/f'{configfile}.json').read_text())
    city={'id':key,'name':config['map_name'],'levels':[],'nodes':[],'areas':[]}
    cells={}; levelmeta={}; areaids={}; area_names=[]; area_paths=[]
    for group,pathkey,filekey in [('city','map_path','map_file'),('umbra','umbra_map_path','umbra_map_file')]:
        path=SRC/'_maps'/config[pathkey]/config[filekey]
        w,h,grids=readmap(path)
        for z,grid in sorted(grids.items()):
            lid=f'{group}-{z}'
            lname=f'Z{z} · '+({1:'Underground',2:'Street level',3:'Upper level',4:'Rooftops / upper level',5:'Special areas'}.get(z,'Map level')) if group=='city' else f'Umbra · {z}'
            layer={'id':lid,'name':lname,'z':z,'group':group,'w':w,'h':h,'image':f'{path.stem}-{z}', 'labels':[]}
            layer['source']=str(path.relative_to(SRC))
            city['levels'].append(layer); cells[lid]=grid;levelmeta[lid]=layer
            ag=np.zeros((h,w),dtype='<u2')
            for (x,y),aa in grid.items():
                areas=[a for a in aa if a[0].startswith('/area')]
                assert len(areas)==1, (path,x,y,areas)
                at,av=areas[0]
                name=av.get('name',at.rsplit('/',1)[-1].replace('_',' ').title())
                if name=='CITY_NAME': name=city['name']
                ak=(at,name)
                if ak not in areaids:
                    areaids[ak]=len(area_names);area_names.append(name);area_paths.append(at)
                ag[h-y,x-1]=areaids[ak]
            layer['grid']=base64.b64encode(ag.tobytes()).decode()
            # One label per connected area, with tiny fragments omitted.
            for aid in np.unique(ag):
                mask=ag==aid
                components,count=ndimage.label(mask)
                for ci,box in enumerate(ndimage.find_objects(components),1):
                    if box is None:continue
                    local=components[box]==ci
                    size=int(local.sum())
                    if size<8:continue
                    ys,xs=np.where(local)
                    # Keep anchor within the region, preferentially away from walls/edges.
                    dist=ndimage.distance_transform_edt(np.pad(local,1))[1:-1,1:-1]
                    mx,my=xs.mean(),ys.mean()
                    score=dist[ys,xs]-.025*((xs-mx)**2+(ys-my)**2)**.5
                    best=int(score.argmax()); x=int(xs[best]+box[1].start+1); y=int(h-(ys[best]+box[0].start))
                    layer['labels'].append({'area':int(aid),'name':area_names[aid],'x':x,'y':y,'size':size,
                        'bounds':[box[1].start+1,h-box[0].stop+1,box[1].stop,h-box[0].start],
                        'generic': area_paths[aid] in ['/area','/area/space','/area/vtm','/area/vtm/interior','/area/vtm/outside']})
            layer['labels'].sort(key=lambda a:-a['size'])
    city['areas']=area_names
    city['areaPaths']=area_paths
    def area_at(lid,x,y):
        aa=cells[lid].get((x,y),[])
        for p,v in aa:
            if p.startswith('/area'):
                n=v.get('name',p.rsplit('/',1)[-1].replace('_',' ').title())
                return city['name'] if n=='CITY_NAME' else n
        return 'Map edge'
    def turf(lid,x,y):
        return next((p for p,v in cells.get(lid,{}).get((x,y),[]) if p.startswith('/turf')),'')
    def node(lid,x,y,kind,label,**extra):
        n={'id':len(city['nodes']),'level':lid,'x':x,'y':y,'kind':kind,'label':label,
           'area':area_at(lid,x,y),'to':[],**extra}
        city['nodes'].append(n);return n
    def link(a,b):
        if b['id'] not in a['to']:a['to'].append(b['id'])
    def vertical(z,d):
        traits=config.get('traits',[])
        return 1<=z<=len(traits) and traits[z-1].get('Up' if d>0 else 'Down')==d and f'city-{z+d}' in cells
    stairs={};ladders={};transfers=collections.defaultdict(list);bumps=collections.defaultdict(list);elevators=collections.defaultdict(list)
    for lid,grid in cells.items():
        for (x,y),aa in grid.items():
            for p,v in aa:
                if p.startswith('/obj/transfer_point_vamp'):
                    tid=v.get('id',1)
                    n=node(lid,x,y,'portal' if '/umbral' in p else 'transfer',v.get('name','Transfer point'),pair=tid,oneWay=bool(v.get('one_way',False)))
                    transfers[tid].append(n)
                elif p.startswith('/obj/effect/bump_teleporter'):
                    n=node(lid,x,y,'transfer','Teleporter',pair=v.get('id'),target=v.get('id_target'))
                    bumps[v.get('id')].append(n)
                elif p.startswith('/obj/structure/ladder'):
                    n=node(lid,x,y,'manhole' if '/manhole/' in p else 'ladder',v.get('name','Ladder'))
                    ladders[lid,x,y]=(n,v)
                elif p=='/obj/structure/stairs' or p.startswith('/obj/structure/stairs/'):
                    stairs[lid,x,y]=(p,v)
                elif p.startswith('/obj/machinery/button/elevator') and v.get('id'):
                    n=node(lid,x,y,'elevator',str(v['id'])+' elevator',pair=v['id'])
                    elevators[v['id']].append(n)
    for tid,group in transfers.items():
        if len(group)==2:
            a,b=group
            if not a.get('oneWay'):link(a,b)
            if not b.get('oneWay'):link(b,a)
        else:
            for n in group:n['unresolved']='No unique paired exit in these configured maps'
            report.append({'map':key,'kind':'transfer','id':tid,'count':len(group)})
    for group in bumps.values():
        for n in group:
            dest=bumps.get(n.get('target'),[])
            if len(dest)==1:link(n,dest[0])
            else:n['unresolved']='Teleporter destination is missing or ambiguous'
    for (lid,x,y),(n,v) in ladders.items():
        if not lid.startswith('city-'):continue
        z=levelmeta[lid]['z']
        for d in [-1,1]:
            other=ladders.get((f'city-{z+d}',x,y))
            if other and vertical(z,d) and v.get('connect_up' if d>0 else 'connect_down',True) and v.get('crafted',False)==other[1].get('crafted',False):
                link(n,other[0]);link(other[0],n)
    directions={1:(0,1),2:(0,-1),4:(1,0),8:(-1,0),'NORTH':(0,1),'SOUTH':(0,-1),'EAST':(1,0),'WEST':(-1,0)}
    stair_candidates=[]
    for (lid,x,y),(p,v) in stairs.items():
        if not lid.startswith('city-'):continue
        z=levelmeta[lid]['z']; target=f'city-{z+1}'
        if not vertical(z,1):continue
        direction=v.get('dir',2); dx,dy=directions.get(direction,(0,-1))
        mode=v.get('terminator_mode',0)
        nextstair=stairs.get((lid,x+dx,y+dy))
        if mode in [1,'STAIR_TERMINATOR_NO']:continue
        if mode not in [2,'STAIR_TERMINATOR_YES'] and nextstair and nextstair[1].get('dir',2)==direction:continue
        if not(v.get('force_open_above',False) or turf(target,x,y).startswith('/turf/open/openspace')):continue
        landing=turf(target,x+dx,y+dy)
        if not landing.startswith('/turf/open') or landing.startswith('/turf/open/openspace'):continue
        stair_candidates.append((lid,x,y,target,x+dx,y+dy,p,direction))
    # Adjacent parallel stair termini represent one wide staircase.
    seen=set()
    for entry in stair_candidates:
        if entry in seen:continue
        lid,x,y,target,tx,ty,p,direction=entry
        group=[entry];seen.add(entry)
        for current in group:
            for e in stair_candidates:
                if e not in seen and e[0]==lid and e[7]==direction and abs(e[1]-current[1])+abs(e[2]-current[2])==1:
                    seen.add(e);group.append(e)
        e=group[len(group)//2];lid,x,y,target,tx,ty,p,direction=e
        kind='ramp' if '/ramp' in p else 'stairs'
        a=node(lid,x,y,kind,kind.title()+' up')
        b=node(target,tx,ty,kind,kind.title()+' down')
        link(a,b);link(b,a)
    for eid,group in elevators.items():
        for n in group:
            for other in group:
                if n['level']!=other['level']:link(n,other)
            n['note']='Mapped elevator call stops; availability and access can change in-round.'
    for n in city['nodes']:
        if not n['to'] and not n.get('oneWay') and not n.get('unresolved'):
            n['unresolved']='No connected destination in these map layers'
        for dest in n['to']:
            assert 0<=dest<len(city['nodes'])
    counts=collections.Counter(n['kind'] for n in city['nodes'])
    print(key,len(city['levels']),'levels',len(area_names),'areas',len(city['nodes']),'transition markers',dict(counts))
    allmaps.append(city)

data={'source':'https://github.com/Wheezel/crimson-grid','commit':args.commit,'snapshotDate':args.snapshot_date,
      'coordinateSystem':'Map-file coordinates; runtime BYOND offsets may differ.', 'maps':allmaps}
(OUT/'data.js').write_text('window.MAP_DATA='+json.dumps(data,separators=(',',':'))+';\n')
(OUT/'transition-audit.json').write_text(json.dumps(report,indent=2))
print('Unresolved transfer IDs:',len(report))
