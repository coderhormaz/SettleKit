// Minimal ISO BMFF writer for the browser's AVC/AAC output. No third-party code.
const u8=(...v)=>Buffer.from(v);
const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16BE(n);return b;};
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
const i32=n=>{const b=Buffer.alloc(4);b.writeInt32BE(n);return b;};
const zeros=n=>Buffer.alloc(n);
const cat=(...v)=>Buffer.concat(v.flat());
const box=(type,...data)=>{const content=cat(...data);return cat(u32(content.length+8),Buffer.from(type),content);};
const full=(type,version,flags,...data)=>box(type,u8(version,(flags>>16)&255,(flags>>8)&255,flags&255),...data);
const matrix=()=>cat(u32(0x10000),u32(0),u32(0),u32(0),u32(0x10000),u32(0),u32(0),u32(0),u32(0x40000000));
const descriptor=(tag,payload)=>cat(u8(tag,payload.length),payload);
const sampleTable=(samples,entry,delta,offset,video)=>box('stbl',
 full('stsd',0,0,u32(1),entry),
 full('stts',0,0,u32(1),u32(samples.length),u32(delta)),
 full('stsc',0,0,u32(1),u32(1),u32(samples.length),u32(1)),
 full('stsz',0,0,u32(0),u32(samples.length),...samples.map(s=>u32(s.data.length))),
 full('stco',0,0,u32(1),u32(offset)),
 ...(video?[full('stss',0,0,u32(samples.filter(s=>s.type==='key').length),...samples.flatMap((s,i)=>s.type==='key'?[u32(i+1)]:[]))]:[])
);
const dinf=()=>box('dinf',full('dref',0,0,u32(1),full('url ',0,1)));
function track({id,video,width,height,samples,description,offset,duration,movieDuration,skip=0}){
 const timescale=video?90000:48000,delta=video?3000:1024;
 const tkhd=full('tkhd',0,7,u32(0),u32(0),u32(id),u32(0),u32(movieDuration),zeros(8),u16(0),u16(0),u16(video?0:0x100),u16(0),matrix(),u32(video?width*65536:0),u32(video?height*65536:0));
 let entry;
 if(video)entry=box('avc1',zeros(6),u16(1),u16(0),u16(0),zeros(12),u16(width),u16(height),u32(0x480000),u32(0x480000),u32(0),u16(1),zeros(32),u16(24),u16(65535),box('avcC',description));
 else{
  const esds=full('esds',0,0,descriptor(3,cat(u16(id),u8(0),descriptor(4,cat(u8(0x40,0x15,0,0,0),u32(192000),u32(192000),descriptor(5,description))),descriptor(6,u8(2)))));
  entry=box('mp4a',zeros(6),u16(1),zeros(8),u16(2),u16(16),u16(0),u16(0),u32(48000*65536),esds);
 }
 const mdia=box('mdia',
  full('mdhd',0,0,u32(0),u32(0),u32(timescale),u32(duration??samples.length*delta),u16(0x55c4),u16(0)),
  full('hdlr',0,0,u32(0),Buffer.from(video?'vide':'soun'),zeros(12),Buffer.from(video?'VideoHandler\0':'SoundHandler\0')),
  box('minf',video?full('vmhd',0,1,u16(0),zeros(6)):full('smhd',0,0,u16(0),u16(0)),dinf(),sampleTable(samples,entry,delta,offset,video))
 );
 return box('trak',tkhd,...(!video?[box('edts',full('elst',0,0,u32(1),u32(movieDuration),i32(skip),u16(1),u16(0)))]:[]),mdia);
}
export function muxMp4(video,audio,{width=1920,height=1080,fps=30}={}){
 if(fps!==30)throw Error('This launch cut uses an exact 30 fps timebase.');
 const movieDuration=Math.round(video.samples.length/fps*1000);
 const ftyp=box('ftyp',Buffer.from('isom'),u32(512),Buffer.from('isomiso2avc1mp41'));
 const videoData=cat(...video.samples.map(s=>s.data)),audioData=cat(...audio.samples.map(s=>s.data));
 // Native encoders expose priming as a negative first timestamp when present.
 const skip=Math.max(0,Math.round(-(audio.samples[0]?.timestamp??0)*48000/1e6));
 function moov(videoOffset,audioOffset){return box('moov',
  full('mvhd',0,0,u32(0),u32(0),u32(1000),u32(movieDuration),u32(0x10000),u16(0x100),zeros(10),matrix(),zeros(24),u32(3)),
  track({id:1,video:true,width,height,samples:video.samples,description:video.description,offset:videoOffset,movieDuration}),
  track({id:2,video:false,samples:audio.samples,description:audio.description,offset:audioOffset,movieDuration,skip})
 );}
 const draft=moov(0,0),videoOffset=ftyp.length+draft.length+8;
 return cat(ftyp,moov(videoOffset,videoOffset+videoData.length),box('mdat',videoData,audioData));
}
