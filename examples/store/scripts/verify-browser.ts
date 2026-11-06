import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const origin=process.env.STORE_PREVIEW_ORIGIN??'http://127.0.0.1:3200';
await mkdir('.impeccable/review',{recursive:true});
const browser=await chromium.launch({headless:true});
try{
  for(const [name,width,height]of [['desktop',1440,900],['tablet',768,1024],['mobile',390,844]] as const){
    const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin);await page.waitForLoadState('networkidle');await page.evaluate(()=>document.fonts.ready);
    await expect(page.getByRole('heading',{name:'Make room for the right problem.'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Continue to checkout'})).toBeVisible();
    await expect(page.getByText('25 USDT',{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    await page.getByRole('button',{name:'Continue to checkout'}).focus();
    await expect(page.getByRole('button',{name:'Continue to checkout'})).toBeFocused();
    await page.screenshot({path:`.impeccable/review/store-${name}.png`,fullPage:true});
    expect(errors).toEqual([]);await page.close();
    process.stdout.write(`Store ${name}: no overflow, real rendered price/CTA, keyboard focus, zero page errors.\n`);
  }
}finally{await browser.close();}
