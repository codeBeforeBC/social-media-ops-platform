import json,sys,warnings
from PIL import Image
warnings.simplefilter('error',Image.DecompressionBombWarning)
Image.MAX_IMAGE_PIXELS=100000000
with Image.open(sys.argv[1]) as image:
    if image.format!='PNG': raise ValueError('PNG required')
    image.verify()
with Image.open(sys.argv[1]) as image:
    image.load()
    metadata={'width':image.width,'height':image.height,'has_alpha':'A' in image.getbands() or 'transparency' in image.info,'format':'PNG'}
    image=image.convert('RGBA')
    image.thumbnail((1200,1200),Image.Resampling.LANCZOS)
    image.save(sys.argv[2],format='PNG')
    print(json.dumps(metadata))
