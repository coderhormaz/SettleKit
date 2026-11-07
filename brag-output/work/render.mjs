import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { dirname,join,extname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const work=dirname(fileURLToPath(import.meta.url));
const output=resolve(work,'..');
const full=process.argv.includes('--render');
const ffmpeg=join(process.env.LOCALAPPDATA,'ms-playwright','ffmpeg-1013','ffmpeg-win64.exe');
const errors=[];
const mime={'.html':'text/html','.ttf':'font/ttf','.jpg':'image/jpeg','.json':'application/json'};
const server=createServer(async(req,res)=>{
 try {const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||'video.html';const path=resolve(work,relative);if(!path.startsWith(work+'\\')&&!path.startsWith(work+'/')){res.writeHead(403).end();return;}const content=await readFile(path);res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream'}).end(content);}catch{res.writeHead(404).end();}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
console.log(JSON.stringify({stage:'loading',fullRender:full}));
const browser=await chromium.launch({headless:true});
let encoder;
try {
 const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/video.html',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>document.fonts.status==='loaded'&&[...document.querySelectorAll('iframe')].every(f=>f.contentDocument?.readyState==='complete'&&f.contentDocument.fonts.status==='loaded'),null,{timeout:30000});
 console.log(JSON.stringify({stage:'fonts-and-product-frames-ready'}));
 const seek=async t=>page.evaluate(async t=>{window.seek(t);await new Promise(requestAnimationFrame);},t);
 await mkdir(join(work,'stills'),{recursive:true});
 const times=[1.5,2.93,3.12,4.8,6.94,7.12,8.5,10.4,11.93,12.12,14.6,15.93,16.12,18];
 if(!full){
  for(const t of times){await seek(t);await page.screenshot({path:join(work,'stills',`${String(t).replace('.','_')}.jpg`),type:'jpeg',quality:94});}
  await seek(4.8);await page.screenshot({path:join(output,'brag.jpg'),type:'jpeg',quality:97});
  const bounds=await page.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,fonts:document.fonts.status,iframes:[...document.querySelectorAll('iframe')].map(f=>({source:f.getAttribute('src'),fonts:f.contentDocument.fonts.status,scriptCount:f.contentDocument.scripts.length})),fixtureDisclosure:document.querySelector('.top-note').textContent}));
  await writeFile(join(work,'still-check.json'),JSON.stringify({times,errors,...bounds},null,2));
  console.log(JSON.stringify({stills:times.length,errors,...bounds}));
 }else{
  await mkdir(join(work,'frames'),{recursive:true});
  const log=await import('node:fs').then(m=>m.createWriteStream(join(work,'vp9-encode.log')));
  encoder=spawn(ffmpeg,['-y','-hide_banner','-f','image2pipe','-vcodec','mjpeg','-framerate','30','-i','pipe:0','-an','-c:v','libvpx-vp9','-b:v','6500k','-crf','14','-deadline','realtime','-cpu-used','6','-row-mt','1','-pix_fmt','yuv420p',join(work,'silent.webm')],{windowsHide:true,stdio:['pipe','ignore','pipe']});
  encoder.stderr.pipe(log);encoder.stdin.on('error',e=>errors.push(e.message));
  const finish=once(encoder,'close');
  const poster=await readFile(join(output,'brag.jpg'));
  for(let i=0;i<600;i++){
   await seek(i/30);
   const buffer=i===0?poster:await page.screenshot({type:'jpeg',quality:95});
   await writeFile(join(work,'frames',`${String(i).padStart(4,'0')}.jpg`),buffer);
   if(!encoder.stdin.write(buffer))await once(encoder.stdin,'drain');
   if(i%90===0)console.log(JSON.stringify({frame:i,total:600,percent:Math.round(i/6)}));
  }
  encoder.stdin.end();const [code]=await finish;log.end();
  await writeFile(join(work,'render-check.json'),JSON.stringify({frames:600,frameRate:30,duration:20,posterReplacesFrameZero:true,encoderExit:code,pageErrors:errors},null,2));
  console.log(JSON.stringify({rendered:600,encoderExit:code,errors}));if(code||errors.length)process.exitCode=1;
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
