import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';

const origin='http://127.0.0.1:3400';
await mkdir('.impeccable/review',{recursive:true});await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});
const browser=await chromium.launch({headless:true});
try{
  const gatewayPortClosed=await new Promise<boolean>(resolve=>{const socket=createConnection({host:'127.0.0.1',port:3000});socket.setTimeout(1000);socket.once('connect',()=>{socket.destroy();resolve(false);});socket.once('error',error=>resolve((error as NodeJS.ErrnoException).code==='ECONNREFUSED'));socket.once('timeout',()=>{socket.destroy();resolve(false);});});
  if(process.env.ACCOUNTANT_GATEWAY_STOPPED==='true')expect(gatewayPortClosed).toBe(true);
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});const requests:string[]=[];const errors:string[]=[];
  page.on('request',request=>requests.push(request.url()));page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);await expect(page.getByRole('heading',{name:'No receipts in this scope'})).toBeVisible({timeout:30_000});
  await expect(page.getByRole('button',{name:'Export verified CSV'})).toBeDisabled();
  await expect(page.getByText('A verified public router deployment is required to reconcile source-chain history.')).toBeVisible();
  for(const [name,width,height]of [['desktop',1440,900],['tablet',768,1024],['mobile',390,844]]as const){
    await page.setViewportSize({width,height});await page.evaluate(()=>scrollTo(0,0));await page.evaluate(()=>document.fonts.ready);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    await page.screenshot({path:`.impeccable/review/accountant-public-empty-${name}.png`,fullPage:true});
  }
  const wallet=page.getByRole('textbox',{name:'Merchant wallet'});await wallet.fill('invalid');await page.getByRole('button',{name:'Read records'}).click();
  await expect(page.getByRole('alert').filter({hasText:'Couldn’t finish the request'})).toContainText('Enter a complete merchant wallet address.');
  await wallet.fill('0x1A6d39216bcfCA2a93221aB2ed0e43f6561cf192');await wallet.focus();await page.keyboard.press('Tab');await expect(page.getByRole('combobox',{name:'Record kind'})).toBeFocused();
  const publicRequests=requests.filter(url=>url.startsWith('https://rpc.rabdi.db-chain.testnet.arkiv.network'));
  const gatewayRequests=requests.filter(url=>/^https?:\/\/(127\.0\.0\.1|localhost):3000/.test(url));
  expect(publicRequests.length).toBeGreaterThan(0);expect(gatewayRequests).toEqual([]);expect(errors).toEqual([]);
  await writeFile(new URL('../evidence/public-browser.json',import.meta.url),JSON.stringify({kind:'actual-independent-public-Arkiv-browser-read',checkedAt:new Date().toISOString(),origin,viewports:[1440,768,390],actualPublicRpcRequestCount:publicRequests.length,gatewayHistoryApiRequests:gatewayRequests.length,pageErrors:errors,returnedRows:0,privateCredentialUsed:false,signedWriteExecuted:false,gatewayPort3000Closed:gatewayPortClosed,gatewayProcessStopped:process.env.ACCOUNTANT_GATEWAY_STOPPED==='true'&&gatewayPortClosed,limitation:'Actual empty public query and responsive/validation checks. Parent stopped its verified gateway process; this script independently confirmed TCP3000refused. No signed receipt/history/completeness proof is claimed.'},null,2)+'\n');
  process.stdout.write('Actual independent accountant browser query,3viewports,validation,keyboard and no-gateway-request checks passed.\n');
}finally{await browser.close();}
