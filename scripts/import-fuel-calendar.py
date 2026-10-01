from PIL import Image
import numpy as np
import fitz,subprocess,json,re,hashlib,concurrent.futures,os
from pathlib import Path
import argparse,tempfile
parser=argparse.ArgumentParser(description="Import offline AM4 reference data; never contacts the game")
parser.add_argument("input_directory",type=Path)
parser.add_argument("--output",type=Path,default=Path(__file__).resolve().parents[1]/"data/reference")
args=parser.parse_args();root=args.input_directory;out=args.output;out.mkdir(parents=True,exist_ok=True);tmp=Path(tempfile.mkdtemp(prefix="am4-ocr-"))
def read(task):
 days,day=task;p=root/f'Preços Combustíveis - Mês com {days} dias.pdf'
 d=fitz.open(p);page=d[day];w,h=page.rect.width,page.rect.height
 result={'day':day,'page':day+1,'verified':False}
 for kind,x0,x1 in [('fuel',.22,.50),('co2',.54,.78)]:
  image=tmp/f'{days}-{day}-{kind}.png';page.get_pixmap(matrix=fitz.Matrix(2.5,2.5),clip=fitz.Rect(w*x0,h*.25,w*x1,h)).save(image)
  im=np.array(Image.open(image).convert('RGB'));dark=im.min(axis=2)<80
  ys=np.where(dark.mean(axis=1)>.7)[0]
  run=np.zeros(dark.shape[1],dtype=int);longest=run.copy()
  for row in dark:run=(run+1)*row;longest=np.maximum(longest,run)
  xs=np.where(longest>100)[0]
  for y in ys:im[max(0,y-2):y+3,:]=255
  for x in xs:im[:,max(0,x-2):x+3]=255
  Image.fromarray(im).save(image)
  text=subprocess.check_output(['tesseract',str(image),'stdout','--psm','6'],stderr=subprocess.DEVNULL,env={**os.environ,'OMP_THREAD_LIMIT':'1'}).decode()
  entries=[]
  for line in text.splitlines():
   m=re.fullmatch(r'\s*(\d{1,2}):([03]0)\s+(\d{2,4})\s*',line)
   if m:
    hh,mm,price=map(int,m.groups())
    if hh<24 and (100<=price<=3000 if kind=='fuel' else 10<=price<=500):entries.append([hh*60+mm,price])
  result[kind]=entries
  result[kind+'Issues']=len(entries)==0 or any(entries[i][0]>=entries[i+1][0] for i in range(len(entries)-1))
 return days,result
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 results=list(pool.map(read,[(d,i) for d in [30,31] for i in range(1,d+1)]))
for days in [30,31]:
 p=root/f'Preços Combustíveis - Mês com {days} dias.pdf'
 data={'schemaVersion':1,'monthLength':days,'utcOffsetMinutes':-180,'source':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'status':'ocr-unverified','days':[r for d,r in results if d==days]}
 (out/f'fuel-calendar-{days}.json').write_text(json.dumps(data,separators=(',',':'))+'\n')
 print(days,len(data['days']),sum(len(r['fuel']) for r in data['days']),sum(len(r['co2']) for r in data['days']),flush=True)
