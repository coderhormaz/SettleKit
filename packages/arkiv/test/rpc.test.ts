import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boundedRpcFetch } from '../src/rpc.ts';

describe('bounded public RPC transport',()=>{
  let server:Server;let origin:string;
  beforeAll(async()=>{
    server=createServer((req,res)=>{
      if(req.url==='/slow'){res.writeHead(200,{'Content-Type':'application/json'});res.write('[');const interval=setInterval(()=>res.write(' '),10);res.on('close',()=>clearInterval(interval));}
      else if(req.url==='/large'){res.end('x'.repeat(2000));}
      else{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({result:true}));}
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('No test port');origin=`http://127.0.0.1:${address.port}`;
  });
  afterAll(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
  it('preserves real JSON responses and refuses oversized RPC bodies',async()=>{
    expect(await (await boundedRpcFetch(undefined,1000)(origin+'/ok')).json()).toEqual({result:true});
    await expect(boundedRpcFetch(undefined,1000,100)(origin+'/large')).rejects.toThrow('PUBLIC_RPC_RESPONSE_LIMIT');
  });
  it('uses an absolute deadline while a response keeps streaming and rejects an elapsed overall budget',async()=>{
    const start=Date.now();await expect(boundedRpcFetch(undefined,70)(origin+'/slow')).rejects.toThrow('PUBLIC_RPC_TIMEOUT');expect(Date.now()-start).toBeLessThan(1500);
    await expect(boundedRpcFetch(Date.now()-1)(origin+'/ok')).rejects.toThrow('PUBLIC_RPC_TIMEOUT');
  });
});
