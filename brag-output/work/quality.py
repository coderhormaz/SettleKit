"""Summarize the actual media checks and preserve export hashes."""
from pathlib import Path
import hashlib, json, re, wave
import numpy as np
from PIL import Image
from scipy.signal import correlate, correlation_lags

WORK = Path(__file__).resolve().parent
OUT = WORK.parent
media = json.loads((WORK/'media-check.json').read_text())
render = json.loads((WORK/'render-check.json').read_text())
capture = json.loads((WORK/'capture-check.json').read_text())
snapshots = json.loads((WORK/'captures.json').read_text())

poster = np.asarray(Image.open(OUT/'brag.jpg').convert('RGB'), dtype=np.float32)
first = np.asarray(Image.open(WORK/'decoded/0.png').convert('RGB'), dtype=np.float32)
poster_error = float(np.abs(poster-first).mean())
with wave.open(str(WORK/'music.wav')) as audio:
    original = np.frombuffer(audio.readframes(48000), dtype='<i2').reshape(-1,2)[:,0]/32768
decoded = np.fromfile(WORK/'decoded-audio.f32', dtype='<f4')
correlation = correlate(decoded, original, mode='full', method='fft')
lags = correlation_lags(len(decoded), len(original), mode='full')
window = np.abs(lags)<4096
lag = int(lags[window][np.argmax(correlation[window])])

def luminance(value):
    values=[int(value[i:i+2],16)/255 for i in (1,3,5)]
    linear=[x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in values]
    return sum(x*y for x,y in zip(linear,[.2126,.7152,.0722]))

contrasts={color:round((luminance(color)+.05)/(luminance('#0b0d11')+.05),2) for color in ['#f5f7fa','#a3f5c5','#a5adbd','#8e98ab']}
sanitized={name:{'scriptCount':len(re.findall(r'<script',value['html'])),'navigationUrlCount':len(re.findall(r'href=',value['html'])),'walletValueCount':len(re.findall(r'0x[a-fA-F0-9]{8,}',value['html']))} for name,value in snapshots.items()}
same_poster=(WORK/'frames/0000.jpg').read_bytes()==(OUT/'brag.jpg').read_bytes()
checks={
    'mediaChecksPass':all(media['checks'].values()),
    'exactly600SourceFrames':len(list((WORK/'frames').glob('*.jpg')))==600,
    'posterReplacesFrameZero':same_poster,
    'encodedPosterMatches':poster_error<3,
    'audioAlignedWithinOneMillisecond':abs(lag)<=48,
    'mainTextContrastPasses':min(contrasts.values())>=4.5,
    'sanitizedProductSnapshots':all(not any(value.values()) for value in sanitized.values()),
    'captureHasNoErrorsOrWrites':capture['realApiWrites']==0 and not capture['errors'],
    'renderHasNoBrowserErrors':not render['pageErrors'],
}
result={
    'format':'1920x1080 / 30 fps / 20 seconds / AVC H.264 + AAC stereo',
    'checks':checks,
    'encodedPosterMeanAbsoluteRgbError':round(poster_error,4),
    'audioAlignmentSamples':lag,
    'audioAlignmentMilliseconds':lag/48,
    'mainTextContrastRatios':contrasts,
    'productSnapshots':sanitized,
    'visualReview':{
        'settledFramesSeconds':[1.5,4.8,8.5,10.4,14.6,18],
        'transitionFramesSeconds':[2.93,3.12,6.94,7.12,11.93,12.12,15.93,16.12],
        'findings':'Reviewed all five scenes and mid-transition samples. No clipped headline, colliding elements or overlapping busy layouts. Checkout frame height tightened to its actual content. Product text/amounts, source fixture disclosure and funded-proof boundary remain visible.',
        'detectorReview':'Chrome padding warnings visually reviewed against centered 15px text in a 45px bar; fixed-resolution film typography intentionally differs from operating UI. No application design system edits.',
    },
    'files':{name:{'bytes':(OUT/name).stat().st_size,'sha256':hashlib.sha256((OUT/name).read_bytes()).hexdigest()} for name in ['brag.mp4','brag.jpg','share-copy.txt']},
    'evidenceBoundary':'Illustrative UI fixtures. Not funded sponsor execution, a new CRE run, DON deployment, signed Arkiv receipt, public hosting, submission or the human-narrated final demonstration.',
}
(WORK/'final-qa.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
if not all(checks.values()): raise SystemExit(1)
