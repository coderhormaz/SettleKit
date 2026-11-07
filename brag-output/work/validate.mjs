import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
const work=dirname(fileURLToPath(import.meta.url));
const test=process.argv.includes('--test');
const file=join(test?work:resolve(work,'..'),test?'encode-test.mp4':'brag.mp4');
const bytes=await readFile(file);
function boxes(start=0,end=bytes.length){const out=[];for(let pos=start;pos+8<=end;){let size=bytes.readUInt32BE(pos);let header=8;if(size===1){size=Number(bytes.readBigUInt64BE(pos+8));header=16;}if(size===0)size=end-pos;if(size<header||pos+size>end)break;out.push({type:bytes.toString('ascii',pos+4,pos+8),start:pos,data:pos+header,end:pos+size,size});pos+=size;}return out;}
function child(parent,type){return boxes(parent.data,parent.end).find(b=>b.type===type);}
const top=boxes();const moov=top.find(b=>b.type==='moov');
const tracks=boxes(moov.data,moov.end).filter(b=>b.type==='trak').map(track=>{
 const mdia=child(track,'mdia'),hdlr=child(mdia,'hdlr'),mdhd=child(mdia,'mdhd'),tkhd=child(track,'tkhd');
 const kind=bytes.toString('ascii',hdlr.data+8,hdlr.data+12);
 const v=bytes[mdhd.data],timescale=bytes.readUInt32BE(mdhd.data+(v===1?20:12)),duration=v===1?Number(bytes.readBigUInt64BE(mdhd.data+24)):bytes.readUInt32BE(mdhd.data+16);
 const stbl=child(child(mdia,'minf'),'stbl'),stsd=child(stbl,'stsd'),stsz=child(stbl,'stsz');
 const codec=bytes.toString('ascii',stsd.data+12,stsd.data+16),sampleCount=bytes.readUInt32BE(stsz.data+8);
 return {kind,codec,durationSeconds:duration/timescale,sampleCount,...(kind==='vide'?{width:bytes.readUInt32BE(tkhd.end-8)/65536,height:bytes.readUInt32BE(tkhd.end-4)/65536,fps:sampleCount/(duration/timescale)}:{})};
});
console.log(JSON.stringify({tracks,bytes:bytes.length}));
if(process.argv.includes('--structure'))process.exit(0);
const server=createServer((req,res)=>{
 const range=req.headers.range;if(range){const parts=range.replace('bytes=','').split('-');const start=Number(parts[0]),end=parts[1]?Math.min(Number(parts[1]),bytes.length-1):bytes.length-1;res.writeHead(206,{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':end-start+1}).end(bytes.subarray(start,end+1));}
 else res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':bytes.length,'Accept-Ranges':'bytes','Access-Control-Allow-Origin':'*'}).end(bytes);
});server.listen(0,'127.0.0.1');await once(server,'listening');
const url=`http://127.0.0.1:${server.address().port}/brag.mp4`;
const browser=await chromium.launch({headless:true});
const pageErrors=[];
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}});page.on('pageerror',e=>pageErrors.push(e.message));
 await page.setContent('<style>body{margin:0;background:#0b0d11}video{display:block;width:1920px;height:1080px}</style><video preload="auto" playsinline muted></video>');
 const metadata=await page.evaluate(url=>new Promise((resolve,reject)=>{const video=document.querySelector('video');video.onloadeddata=()=>resolve({duration:video.duration,width:video.videoWidth,height:video.videoHeight,readyState:video.readyState});video.onerror=()=>reject(new Error('MP4 decode failed '+video.error?.message));video.src=url;}),url);
 console.log(JSON.stringify({metadata}));
 await mkdir(join(work,'decoded'),{recursive:true});
 const sampleTimes=test?[0,.5]:[0,1.5,4.8,8.5,10.4,14.6,18,19.6];
 for(const time of sampleTimes){await page.evaluate(time=>new Promise((resolve,reject)=>{const v=document.querySelector('video');const timeout=setTimeout(()=>reject(new Error('Video seek timed out at '+time+' / '+v.duration)),12000);const done=()=>{clearTimeout(timeout);requestAnimationFrame(()=>requestAnimationFrame(resolve));};if(Math.abs(v.currentTime-time)<.001){done();return;}v.onseeked=done;v.currentTime=time;}),time);await page.locator('video').screenshot({path:join(work,'decoded',`${test?'test-':''}${time}.png`)});}
 const audio=await page.evaluate(async url=>{const buffer=await fetch(url).then(r=>r.arrayBuffer());const context=new AudioContext({sampleRate:48000});const audio=await context.decodeAudioData(buffer);let peak=0,sum=0;for(let c=0;c<audio.numberOfChannels;c++)for(const x of audio.getChannelData(c)){peak=Math.max(peak,Math.abs(x));sum+=x*x;}await context.close();return {channels:audio.numberOfChannels,duration:audio.duration,sampleRate:audio.sampleRate,peakDbfs:20*Math.log10(peak),rmsDbfs:10*Math.log10(sum/(audio.length*audio.numberOfChannels)),alignmentSamples:[...audio.getChannelData(0).subarray(0,48000)]};},url);
 await writeFile(join(work,test?'test-decoded-audio.f32':'decoded-audio.f32'),Buffer.from(new Float32Array(audio.alignmentSamples).buffer));delete audio.alignmentSamples;
 const video=tracks.find(t=>t.kind==='vide');
 const checks={dimensions:metadata.width===1920&&metadata.height===1080,duration:Math.abs(metadata.duration-(test?1:20))<.12,frameCount:video.sampleCount===(test?30:600),frameRate:Math.abs(video.fps-30)<.01,h264:video.codec==='avc1',aac:tracks.some(t=>t.kind==='soun'&&t.codec==='mp4a'),audible:audio.rmsDbfs>-50,unclipped:audio.peakDbfs<-.1,fastStart:top.findIndex(b=>b.type==='moov')<top.findIndex(b=>b.type==='mdat'),noPageErrors:pageErrors.length===0,noLocalIdentity:!bytes.includes(Buffer.from('Abdul'))};
 const result={file:test?'encode-test.mp4':'brag.mp4',bytes:bytes.length,metadata,tracks,audio,checks,decodedSampleTimes:sampleTimes,pageErrors};
 await writeFile(join(work,test?'test-media-check.json':'media-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(Object.values(checks).some(v=>!v))process.exitCode=1;
}finally{await browser.close();await new Promise(r=>server.close(r));}
