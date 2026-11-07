import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile,writeFile } from 'node:fs/promises';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { muxMp4 } from './mp4.mjs';
const work=dirname(fileURLToPath(import.meta.url));
const test=process.argv.includes('--test');
const frameCount=test?30:600;
const server=createServer(async(req,res)=>{
 try{const pathname=new URL(req.url,'http://localhost').pathname;let bytes,type;
  if(pathname==='/'){bytes=Buffer.from('<title>SettleKit native encoder</title>');type='text/html';}
  else if(pathname==='/music.wav'){bytes=await readFile(join(work,'music.wav'));type='audio/wav';}
  else if(pathname.startsWith('/frame/')){const n=Number(pathname.slice(7));if(!Number.isInteger(n)||n<0||n>=frameCount)throw Error();bytes=await readFile(test?resolve(work,'../brag.jpg'):join(work,'frames',`${String(n).padStart(4,'0')}.jpg`));type='image/jpeg';}
  else throw Error();res.writeHead(200,{'Content-Type':type}).end(bytes);
 }catch{res.writeHead(404).end();}
});server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();
 await page.goto(base);
 await page.exposeFunction('progress',value=>console.log(JSON.stringify(value)));
 const result=await page.evaluate(async({count,seconds})=>{
  const video={samples:[],description:null},audio={samples:[],description:null},errors=[];
  const pack=(target,chunk,metadata)=>{const data=new Uint8Array(chunk.byteLength);chunk.copyTo(data);target.samples.push({data:[...data],timestamp:chunk.timestamp,duration:chunk.duration,type:chunk.type});if(metadata.decoderConfig?.description)target.description=[...new Uint8Array(metadata.decoderConfig.description)];};
  const encoder=new VideoEncoder({output:(chunk,meta)=>pack(video,chunk,meta),error:e=>errors.push(e.message)});
  encoder.configure({codec:'avc1.420028',width:1920,height:1080,bitrate:8000000,framerate:30,latencyMode:'realtime',avc:{format:'avc'}});
  for(let i=0;i<count;i++){
   const bitmap=await createImageBitmap(await fetch('/frame/'+i).then(r=>r.blob()));
   const timestamp=Math.round(i*1e6/30),duration=Math.round((i+1)*1e6/30)-timestamp;
   const frame=new VideoFrame(bitmap,{timestamp,duration});encoder.encode(frame,{keyFrame:i%60===0});frame.close();bitmap.close();
   if(encoder.encodeQueueSize>8)await new Promise(resolve=>{const check=()=>{if(encoder.encodeQueueSize<=4){encoder.removeEventListener('dequeue',check);resolve();}};encoder.addEventListener('dequeue',check);});
   if(i%120===0)await window.progress({nativeEncoded:i,total:count});
  }
  await encoder.flush();encoder.close();
  const context=new AudioContext({sampleRate:48000});const decoded=await context.decodeAudioData(await fetch('/music.wav').then(r=>r.arrayBuffer()));
  const aac=new AudioEncoder({output:(chunk,meta)=>pack(audio,chunk,meta),error:e=>errors.push(e.message)});
  aac.configure({codec:'mp4a.40.2',sampleRate:48000,numberOfChannels:2,bitrate:192000});
  const samples=Math.round(seconds*48000);
  for(let offset=0;offset<samples;offset+=1024){const n=Math.min(1024,samples-offset);const planar=new Float32Array(n*2);planar.set(decoded.getChannelData(0).subarray(offset,offset+n));planar.set(decoded.getChannelData(1).subarray(offset,offset+n),n);const data=new AudioData({format:'f32-planar',sampleRate:48000,numberOfFrames:n,numberOfChannels:2,timestamp:Math.round(offset*1e6/48000),data:planar});aac.encode(data);data.close();}
  await aac.flush();aac.close();await context.close();
  return {video,audio,errors};
 },{count:frameCount,seconds:frameCount/30});
 if(result.errors.length)throw Error(result.errors.join('; '));
 for(const part of [result.video,result.audio]){part.description=Buffer.from(part.description);for(const sample of part.samples)sample.data=Buffer.from(sample.data);}
 const mp4=muxMp4(result.video,result.audio);
 await writeFile(resolve(work,test?'encode-test.mp4':'../brag.mp4'),mp4);
 const report={encoder:'Chromium WebCodecs H.264/AAC',frames:result.video.samples.length,audioPackets:result.audio.samples.length,firstVideoTimestamp:result.video.samples[0].timestamp,firstAudioTimestamp:result.audio.samples[0].timestamp,lastAudioTimestamp:result.audio.samples.at(-1).timestamp,videoDescription:[...result.video.description],audioDescription:[...result.audio.description],bytes:mp4.length,errors:result.errors,test};
 await writeFile(join(work,test?'native-test-check.json':'native-encode-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();await new Promise(r=>server.close(r));}
