import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const store=process.env.STORE_ORIGIN??'http://127.0.0.1:3200';
const gateway=process.env.APP_ORIGIN??'http://127.0.0.1:3000';
await mkdir('.impeccable/review',{recursive:true});
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(store);await page.waitForLoadState('networkidle');
  const orderResponse=page.waitForResponse(response=>response.url()===`${store}/api/orders`&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Continue to checkout'}).click();
  const response=await orderResponse;expect(response.status()).toBe(201);
  await page.waitForURL(new RegExp(`${gateway.replaceAll('.','\\.')}/checkout/[a-f0-9]{64}$`));await page.waitForLoadState('networkidle');
  const reference=new URL(page.url()).pathname.split('/').pop()!;
  const checkout=await (await page.request.get(`${gateway}/api/checkout/${reference}`)).json() as {amount_base_units:string;return_url:string};
  const created={id:new URL(checkout.return_url).searchParams.get('order')!,reference,amount_base_units:checkout.amount_base_units};
  expect(created.amount_base_units).toBe('25000000');
  const text=await page.locator('body').innerText();
  expect(text).toMatch(/25/);expect(text).toMatch(/not.*deployed|not.*ready|unavailable|operator|setup|configured|pending/i);
  for(const [name,width,height]of [['desktop',1440,900],['tablet',768,1024],['mobile',390,844]] as const){
    await page.setViewportSize({width,height});await page.evaluate(()=>scrollTo(0,0));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    await page.screenshot({path:`.impeccable/review/store-actual-checkout-${name}.png`,fullPage:true});
  }
  await page.goto(`${store}/?order=${created.id}`);await page.waitForLoadState('networkidle');
  await expect(page.getByText('Awaiting verified payment',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Open checkout'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Download workbook'})).toBeHidden();
  for(const [name,width,height]of [['desktop',1440,900],['tablet',768,1024],['mobile',390,844]] as const){
    await page.setViewportSize({width,height});await page.evaluate(()=>scrollTo(0,0));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    await page.screenshot({path:`.impeccable/review/store-actual-pending-${name}.png`,fullPage:true});
  }
  await writeFile(new URL('../evidence/browser-flow.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),kind:'actual-local-HTTP-browser-and-Neon',orderId:created.id,checkoutReference:created.reference,amountBaseUnits:created.amount_base_units,viewports:[1440,768,390],storeState:'pending',downloadAvailable:false,routerDeployed:false,paymentExecuted:false,pageErrors:errors},null,2)+'\n');
  expect(errors).toEqual([]);process.stdout.write('Actual browser store→checkout→pending return passed at three viewports. No payment executed.\n');
}finally{await browser.close();}
