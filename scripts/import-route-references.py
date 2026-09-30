import zipfile,xml.etree.ElementTree as E,json,re,hashlib
from pathlib import Path
import argparse,tempfile
parser=argparse.ArgumentParser(description="Import offline AM4 reference data; never contacts the game")
parser.add_argument("input_directory",type=Path)
parser.add_argument("--output",type=Path,default=Path(__file__).resolve().parents[1]/"data/reference")
args=parser.parse_args();root=args.input_directory;out=args.output;out.mkdir(parents=True,exist_ok=True);N={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def rows(p,sheet):
 with zipfile.ZipFile(p) as z:
  ss=[''.join(e.itertext()) for e in E.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si',N)] if 'xl/sharedStrings.xml' in z.namelist() else []
  with z.open('xl/worksheets/sheet'+str(sheet)+'.xml') as f:
   context=E.iterparse(f,events=['start','end']);_,r=next(context)
   for event,e in context:
    if event=='end' and e.tag.endswith('}row'):
     data={}
     for c in e.findall('m:c',N):
      v=c.findtext('m:v','',N);v=ss[int(v)] if c.get('t')=='s' and v else v
      if v:data[re.sub(r'\d','',c.get('r'))]=(v,c.findtext('m:f','',N))
     yield int(e.get('r')),data
     e.clear();r.clear()
hubs={'GRU','XAP','DTW'};routes=[];seen={};conflicts=0;count=0
for row,d in rows(root/'All_routes.xlsx',1):
 count+=1
 get=lambda k:d.get(k,('',''))[0]
 a,b=get('C'),get('D')
 if a not in hubs and b not in hubs:continue
 try:
  distance=int(float(get('F')));dem={k:int(float(get(col))) for k,col in zip(['Y','J','F'],['J','K','L'])}
  if not re.fullmatch('[A-Z]{3}',a) or not re.fullmatch('[A-Z]{3}',b) or a==b or distance<=0 or min(dem.values())<0:continue
  key=a+'-'+b
  v={'from':a,'to':b,'distanceKm':distance,'referenceDemand':dem,'sourceRow':row}
  if key in seen:
   if {k:v[k] for k in ['distanceKm','referenceDemand']}!={k:seen[key][k] for k in ['distanceKm','referenceDemand']}:conflicts+=1;seen[key]['conflict']=True
  else:seen[key]=v
 except ValueError:continue
routes=list(seen.values())
meta={'schemaVersion':1,'source':'All_routes.xlsx','sha256':hashlib.sha256((root/'All_routes.xlsx').read_bytes()).hexdigest(),'demandKind':'reference-not-remaining','hubs':sorted(hubs),'scannedRows':count,'conflicts':conflicts,'routes':routes}
(out/'routes.json').write_text(json.dumps(meta,separators=(',',':'))+'\n');print('ROUTES',count,len(routes),conflicts,flush=True)
# Cross-check raw hub workbook A:H only; ignore generated J:Q and broken formula results.
matched=diff=0
for row,d in rows(root/'Rotas por Hub 2.3.xlsx',2):
 get=lambda k:d.get(k,('',''))[0]
 if get('A') not in hubs and get('D') not in hubs:continue
 k=get('A')+'-'+get('D');ref=seen.get(k)
 if ref:
  matched+=1
  if float(get('G'))!=ref['distanceKm']:diff+=1
print('HUB_CROSSCHECK',matched,diff,flush=True)
