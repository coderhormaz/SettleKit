import { chromium } from '@playwright/test';
import { writeFile, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const work = dirname(fileURLToPath(import.meta.url));
const root = resolve(work, '../..');
const stamp = '2026-11-07T05:00:00.000Z';
// Known public test roles from project memory, removed from visible captures.
const merchantWallet = '0x1A6d39216bcfCA2a93221aB2ed0e43f6561cf192';
const payer = '0x2D3C8DdC302F86C6a88E7673E0094C6730dF9A5A';
const screening = { state:'allowed', checkedAt:stamp, expiresAt:'2026-11-08T05:00:00.000Z', sourceFetchedAt:stamp, sourceHash:null, sourceAgeMs:0, reasonCodes:[] };
const merchant = { id:'fictional-fieldwork', displayName:'Fieldwork Studio', websiteOrigin:'https://fieldwork.example', ownerWallet:merchantWallet, settlementWallet:merchantWallet, settlementProvenAt:stamp, version:1, screening };
const payment = { id:'demo-payment', reference:'demo-checkout', orderId:'Fieldwork package', amountBaseUnits:'25000000', refundedBaseUnits:'0', status:'accepted', confirmationStage:'included_2_blocks', deliveryStatus:'failed', riskState:'allowed', payer, merchantWallet, txHash:'', createdAt:stamp, sourceTime:stamp, stateVersion:2 };
const overview = { grossBaseUnits:'25000000', refundedBaseUnits:'5000000', netBaseUnits:'20000000', paymentCount:1, reviewCount:0, notificationIssueCount:1, unverifiedTimestampCount:0, series:[{date:'2026-11-07',grossBaseUnits:'25000000',refundedBaseUnits:'5000000'}],range:{from:'2026-11-07',to:'2026-11-07'} };
const list = items => ({items,total:items.length,page:1,pageSize:20});
const errors = [];
const requests = [];
const captures = {};
const browser = await chromium.launch({headless:true});
try {
 const context = await browser.newContext({ viewport:{width:1440,height:1000}, deviceScaleFactor:1, locale:'en-IN', timezoneId:'Asia/Kolkata', reducedMotion:'reduce' });
 let checkoutAccepted = false;
 let recovered = false;
 await context.route('**/api/**', async route => {
  const pathname = new URL(route.request().url()).pathname;
  requests.push({path:pathname,method:route.request().method()});
  let value;
  if (pathname === '/api/auth/me') value = {merchant};
  else if (pathname === '/api/operations/overview') value = overview;
  else if (pathname === '/api/operations/payments') value = list([payment]);
  else if (pathname === '/api/operations/settings') value = {merchant,screening,settings:{paused:false,version:1},sessions:[]};
  else if (pathname === '/api/operations/webhooks') value = {...list([]),config:{webhookUrl:'https://fieldwork.example/payment-notifications',orderApiUrl:'https://fieldwork.example/order-state',configured:true,active:true,secretConfigured:true}};
  else if (pathname === '/api/operations/deliveries') value = list([{id:'fictional-notification',paymentId:payment.id,eventType:'payment.accepted',stateVersion:2,status:recovered?'delivered':'failed',attempts:recovered?2:1,errorCode:recovered?null:'endpoint_unavailable',createdAt:stamp,replayCount:0,recoveryActor:recovered?'cre':null,recoveredAt:recovered?stamp:null}]);
  else if (pathname === '/api/checkout/demo-checkout') value = {reference:'demo-checkout',amount_base_units:'25000000',merchant_name:merchant.displayName,merchant_wallet:merchantWallet,status:checkoutAccepted?'accepted':'open',payment_id:checkoutAccepted?payment.id:null,confirmation_stage:'included_2_blocks',router:null,token:'0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7',chain_id:1874,expires_at:'2099-11-07T23:59:00.000Z',return_url:'',delivery_status:checkoutAccepted?'pending':null,tx_hash:null,sponsor_buyer_gas:false};
  else { errors.push(`Unexpected fixture request: ${pathname}`); return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:{message:'Fixture endpoint not provided'}})}); }
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
 });
 await context.route('https://**/*', route => route.abort());
 const page = await context.newPage();
 page.on('pageerror', error => errors.push(error.message));

 async function capture(name, path, ready) {
  await page.goto(`http://127.0.0.1:3000${path}`, {waitUntil:'networkidle'});
  await page.getByText(ready,{exact:false}).first().waitFor();
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));});
  await page.evaluate(()=>{const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);const nodes=[];while(walk.nextNode())nodes.push(walk.currentNode);for(const node of nodes)if(node.parentElement?.tagName!=='SCRIPT')node.textContent=node.textContent.replace(/0x[a-fA-F0-9]{40,64}/g,'Demo settlement wallet').replace(/0x[a-fA-F0-9]+…[a-fA-F0-9]+/g,'Demo payer').replace(/https:\/\/fieldwork\.example[^\s]*/g,'Configured store endpoint');});
  await page.screenshot({path:join(work,`${name}-source.png`),fullPage:true});
  captures[name] = await page.evaluate(() => {
   const css = [...document.styleSheets].map(sheet=>{try{return [...sheet.cssRules].map(rule=>rule.cssText).join('\n');}catch{return '';}}).join('\n');
   const body = document.body.cloneNode(true);
   body.querySelectorAll('script,nextjs-portal').forEach(element=>element.remove());
   body.querySelectorAll('a').forEach(element=>{element.removeAttribute('href');element.removeAttribute('target');});
   body.querySelectorAll('[hidden]').forEach(element=>element.remove());
   body.querySelectorAll('input').forEach(element=>element.setAttribute('value',element.value));
   // Display only labelled stand-ins, never an invented transaction/hash.
   const walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT);
   const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
   for(const node of nodes){node.textContent=node.textContent.replace(/0x[a-fA-F0-9]{40,64}/g,'Demo settlement wallet').replace(/0x[a-fA-F0-9]+…[a-fA-F0-9]+/g,'Demo payer').replace(/https:\/\/fieldwork\.example[^\s]*/g,'Configured store endpoint');}
   body.querySelectorAll('[title]').forEach(e=>e.removeAttribute('title'));
   return {css,html:body.innerHTML,width:innerWidth,height:innerHeight};
  });
  captures[name].css=captures[name].css.replace(/url\([^)]*manrope-variable\.ttf[^)]*\)/g,'url("manrope-variable.ttf")');
 }
 await capture('checkout','/checkout/demo-checkout','Pay with your wallet');
 checkoutAccepted=true;
 await capture('accepted','/checkout/demo-checkout','Payment received');
 await capture('overview','/dashboard/overview','Gross received');
 await capture('reports','/dashboard/reports','Period net movement');
 await capture('webhooks','/dashboard/webhooks','Payment notification deliveries');
 recovered=true;
 await capture('recovered','/dashboard/webhooks','Notification recovered by CRE');
 await writeFile(join(work,'captures.json'),JSON.stringify(captures));
 await writeFile(join(work,'capture-check.json'),JSON.stringify({fixtureOnly:true,realApiWrites:0,externalRequestsBlocked:true,captures:Object.keys(captures),errors,requests},null,2));
 await copyFile(join(root,'apps/gateway/public/fonts/manrope-variable.ttf'),join(work,'manrope-variable.ttf'));
 await copyFile(join(root,'apps/gateway/public/fonts/OFL-Manrope.txt'),join(work,'OFL-Manrope.txt'));
 console.log(JSON.stringify({captured:Object.keys(captures),errors,fixtureOnly:true}));
 if(errors.length) process.exitCode=1;
} finally { await browser.close(); }
