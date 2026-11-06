import 'server-only';
import {NextRequest,NextResponse} from 'next/server';
import {AppError} from '@settlekit/core';
import {publicError} from '@settlekit/core/server';
import {database,authenticateRecovery,recoveryCandidates,recoveryCurrent,requestRecovery} from '@settlekit/db';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function handle(req:NextRequest){try{
  const actor=authenticateRecovery(req.headers.get('authorization'));const db=database();const path=req.nextUrl.pathname.replace(/^\/api\/recovery\//,'');
  if(req.method==='GET'&&path==='candidates')return NextResponse.json(await recoveryCandidates(db,req.nextUrl.searchParams),{headers:{'Cache-Control':'private, no-store'}});
  if(req.method==='GET'&&path.startsWith('current/'))return NextResponse.json(await recoveryCurrent(db,path.slice(8)),{headers:{'Cache-Control':'private, no-store'}});
  if(req.method==='POST'&&path==='request'){
    if(!req.headers.get('content-type')?.startsWith('application/json'))throw new AppError('INVALID_INPUT',415,'Send JSON.');
    const reader=req.body?.getReader();if(!reader)throw new AppError('INVALID_INPUT',400,'Send a recovery request.');const chunks:Uint8Array[]=[];let size=0;
    for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4096){await reader.cancel();throw new AppError('REQUEST_TOO_LARGE',413,'This request is too large.');}chunks.push(part.value);}
    let input:unknown;try{input=JSON.parse(Buffer.concat(chunks).toString());}catch{throw new AppError('INVALID_INPUT',400,'Send valid JSON.');}
    return NextResponse.json(await requestRecovery(db,input,actor),{headers:{'Cache-Control':'private, no-store'}});
  }
  throw new AppError('NOT_FOUND',404,'This recovery action was not found.');
}catch(error){const result=publicError(error);return NextResponse.json(result.body,{status:result.status,headers:{'Cache-Control':'private, no-store'}});}}
export const GET=handle;export const POST=handle;
