#!/usr/bin/env python3
"""Build independently loaded WebP map tiles from dmm-tools PNGs."""
import argparse, concurrent.futures
from pathlib import Path
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
ap=argparse.ArgumentParser();ap.add_argument('renders',type=Path);args=ap.parse_args()
out=Path(__file__).resolve().parents[1]/'assets'
def convert(path):
    im=Image.open(path).convert('RGBA')
    # A fixed background avoids transparent voids becoming expensive compositing layers.
    bg=Image.new('RGBA',im.size,(17,22,29,255));bg.alpha_composite(im);im=bg.convert('RGB')
    dest=out/path.stem;dest.mkdir(parents=True,exist_ok=True)
    im.resize((im.width//8,im.height//8),Image.Resampling.LANCZOS).save(dest/'overview.webp',quality=85,method=4)
    for ppc in [16,32]:
        frame=im if ppc==32 else im.resize((im.width//2,im.height//2),Image.Resampling.LANCZOS)
        folder=dest/str(ppc);folder.mkdir(exist_ok=True)
        for y in range(0,frame.height,512):
            for x in range(0,frame.width,512):
                tile=frame.crop((x,y,min(x+512,frame.width),min(y+512,frame.height)))
                tile.save(folder/f'{x//512}_{y//512}.webp',quality=88,method=4)
    print(path.stem,flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:list(ex.map(convert,sorted(args.renders.glob('*.png'))))
