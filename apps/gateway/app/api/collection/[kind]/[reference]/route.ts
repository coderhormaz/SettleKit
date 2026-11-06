import 'server-only';
import {NextRequest,NextResponse} from 'next/server';
import {AppError} from '@settlekit/core';
import {publicError,requireMutationOrigin} from '@settlekit/core/server';
import {database} from '@settlekit/db';
import {createCollectionCheckout,publicCollection} from '../../../../../../../packages/db/src/operations.ts';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function handle(req:NextRequest){try{
  const match=req.nextUrl.pathname.match(/^\/api\/collection\/(link|invoice)\/([a-f0-9]{64})$/);if(!match)throw new AppError('NOT_FOUND',404,'This collection could not be found.');
  const kind=match[1] as 'link'|'invoice';const reference=match[2];const db=database();
  if(req.method==='GET')return NextResponse.json(await publicCollection(db,kind,reference),{headers:{'Cache-Control':'private, no-store'}});
  requireMutationOrigin(req.headers.get('origin'));
  // This public action accepts no price, party, domain, tenant or invoice override.
  const length=Number(req.headers.get('content-length')??'0');if(length>16)throw new AppError('INVALID_INPUT',400,'This action does not accept payment parameters.');
  const reader=req.body?.getReader();let total=0;const chunks:Uint8Array[]=[];if(reader){for(;;){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>16){await reader.cancel();throw new AppError('INVALID_INPUT',400,'This action does not accept payment parameters.');}chunks.push(part.value);}}
  const raw=Buffer.concat(chunks).toString('utf8').trim();if(raw&&raw!=='{}')throw new AppError('INVALID_INPUT',400,'This action does not accept payment parameters.');
  return NextResponse.json(await createCollectionCheckout(db,kind,reference),{headers:{'Cache-Control':'private, no-store'}});
}catch(error){const result=publicError(error);return NextResponse.json(result.body,{status:result.status,headers:{'Cache-Control':'private, no-store'}});}}
export const GET=handle;export const POST=handle;
