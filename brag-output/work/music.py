"""Original 120 BPM C#-minor instrumental; no downloaded or sampled media."""
from pathlib import Path
import json, wave
import numpy as np
from scipy.signal import butter, sosfilt

HERE = Path(__file__).resolve().parent
SR, SECONDS, BPM = 48000, 20, 120
N = SR * SECONDS
BEAT = 60 / BPM
rng = np.random.default_rng(64187)
mix = np.zeros((N, 2), np.float64)

def add(signal, beat, gain=1, pan=0):
    start = round(beat * BEAT * SR)
    if start >= N: return
    s = np.asarray(signal)[:N-start] * gain
    mix[start:start+len(s), 0] += s * np.sqrt((1-pan)/2)
    mix[start:start+len(s), 1] += s * np.sqrt((1+pan)/2)

def hz(midi): return 440 * 2 ** ((midi - 69)/12)
def pluck(midi, duration=.7):
    t = np.arange(round(duration*SR))/SR
    f = hz(midi)
    sound = np.sin(2*np.pi*f*t) + .25*np.sin(2*np.pi*2*f*t)*np.exp(-t*8) + .08*np.sin(2*np.pi*3*f*t)*np.exp(-t*12)
    return sound*(1-np.exp(-t*300))*np.exp(-t*6)
def bass(midi, duration=.38):
    t = np.arange(round(duration*SR))/SR
    return (np.sin(2*np.pi*hz(midi)*t)+.12*np.sin(2*np.pi*hz(midi)*2*t))*(1-np.exp(-t*180))*np.exp(-t*7)
def kick():
    t=np.arange(round(.32*SR))/SR
    freq=48+85*np.exp(-t*40)
    phase=2*np.pi*np.cumsum(freq)/SR
    return np.sin(phase)*(1-np.exp(-t*900))*np.exp(-t*17)
def hat():
    t=np.arange(round(.055*SR))/SR
    noise=rng.normal(0,1,len(t))
    noise=sosfilt(butter(2,6500,'highpass',fs=SR,output='sos'),noise)
    return noise*np.exp(-t*95)*(1-np.exp(-t*3000))
def snare():
    t=np.arange(round(.13*SR))/SR
    noise=sosfilt(butter(2,[1500,5500],'bandpass',fs=SR,output='sos'),rng.normal(0,1,len(t)))
    return (noise*.5+np.sin(2*np.pi*190*t)*.18)*np.exp(-t*37)*(1-np.exp(-t*2000))

# C#m - A - E - B, then resolve to C#m. Ten two-second bars.
roots=[37,37,33,33,40,40,35,35,37,37]
triads={37:[61,64,68],33:[57,61,64],40:[59,64,68],35:[59,63,66]}
for bar,root in enumerate(roots):
    b=bar*4
    chord=triads[root]
    # Sparse motif leaves space for the product; tails are short and warm.
    for offset,note in [(0,chord[0]+12),(1.5,chord[1]+12),(2.5,chord[2]+12)]:
        add(pluck(note),b+offset,.065,(-.18 if offset==0 else .16))
    for offset in [0,1.5,2,3.5]: add(bass(root),b+offset,.23)
    for offset in [0,2]: add(kick(),b+offset,.39)
    for offset in [1,3]: add(snare(),b+offset,.11,.04)
    for offset in np.arange(.5,4,.5): add(hat(),b+float(offset),.025 if offset%1 else .018,-.17 if offset%1 else .17)

# Quiet in-key punctuation uses the same beat grid as the cuts and state change.
for beat in [6,14,19.5,24,32]:
    add(pluck(80,.75),beat,.045,.1)
    add(pluck(73,.75),beat,.027,-.1)

# One short, diffuse stereo return; no bright repeated click effects.
dry=mix.copy()
for delay,gain in [(.125,.09),(.25,.055),(.375,.028)]:
    d=round(delay*SR)
    mix[d:] += dry[:-d,::-1]*gain
mix=sosfilt(butter(2,13500,'lowpass',fs=SR,output='sos'),mix,axis=0)
mix=np.tanh(mix*1.25)/1.25
mix[:2400] *= np.linspace(0,1,2400)[:,None]
mix[-24000:] *= np.linspace(1,0,24000)[:,None]
mix *= .82 / np.max(np.abs(mix))
pcm=np.int16(np.clip(mix,-1,1)*32767)
with wave.open(str(HERE/'music.wav'),'wb') as f:
    f.setnchannels(2);f.setsampwidth(2);f.setframerate(SR);f.writeframes(pcm.tobytes())
stats={'originalComposition':True,'durationSeconds':SECONDS,'bpm':BPM,'key':'C# minor','sampleRate':SR,'channels':2,'samplePeakDbfs':round(20*np.log10(np.max(np.abs(mix))),2),'rmsDbfs':round(20*np.log10(np.sqrt(np.mean(mix**2))),2),'seed':64187}
(HERE/'music-check.json').write_text(json.dumps(stats,indent=2))
print(json.dumps(stats))
