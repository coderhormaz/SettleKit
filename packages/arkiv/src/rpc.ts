import { ReceiptError } from './schema.ts';

/** Browser-safe absolute fetch/body deadline; RPC payloads cannot stream forever. */
export function boundedRpcFetch(deadline?:number,timeoutMs=12_000,maxBytes=2_097_152):typeof fetch {
  return async(input,init)=>{
    const remaining=deadline===undefined?timeoutMs:Math.min(timeoutMs,deadline-Date.now());
    if(remaining<=0)throw new ReceiptError('PUBLIC_RPC_TIMEOUT');
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),remaining);
    try{
      const response=await fetch(input,{...init,signal:init?.signal?AbortSignal.any([init.signal,controller.signal]):controller.signal});
      const reader=response.body?.getReader();const parts:Uint8Array[]=[];let size=0;
      if(reader)for(;;){const result=await reader.read();if(result.done)break;size+=result.value.byteLength;if(size>maxBytes){await reader.cancel();throw new ReceiptError('PUBLIC_RPC_RESPONSE_LIMIT');}parts.push(result.value);}
      const body=new Uint8Array(size);let offset=0;for(const part of parts){body.set(part,offset);offset+=part.byteLength;}
      const headers=new Headers(response.headers);headers.delete('content-length');headers.delete('content-encoding');
      return new Response(response.status===204?null:body,{status:response.status,statusText:response.statusText,headers});
    }catch(error){if(controller.signal.aborted)throw new ReceiptError('PUBLIC_RPC_TIMEOUT');throw error instanceof ReceiptError?error:new ReceiptError('PUBLIC_RPC_UNAVAILABLE');}
    finally{clearTimeout(timer);}
  };
}
