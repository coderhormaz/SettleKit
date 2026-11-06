import { test,expect, type Page } from '@playwright/test';
import { generatePrivateKey,privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { mkdir } from 'node:fs/promises';

async function installWallet(page:Page){
  const account=privateKeyToAccount(generatePrivateKey());
  await page.exposeFunction('testWalletRequest',async(request:{method:string;params?:unknown[]})=>{
    if(['eth_accounts','eth_requestAccounts'].includes(request.method))return [account.address];
    if(request.method==='eth_chainId')return '0x752';
    if(['wallet_switchEthereumChain','wallet_addEthereumChain'].includes(request.method))return null;
    if(['wallet_requestPermissions','wallet_getPermissions'].includes(request.method))return [{parentCapability:'eth_accounts'}];
    if(request.method==='personal_sign')return account.signMessage({message:{raw:request.params![0] as Hex}});
    throw new Error(`Unsupported test-wallet method ${request.method}`);
  });
  await page.addInitScript(()=>{
    const bridge=window as unknown as {testWalletRequest:(request:unknown)=>Promise<unknown>;ethereum:unknown};
    bridge.ethereum={isMetaMask:true,request:(request:unknown)=>bridge.testWalletRequest(request),on:()=>{},removeListener:()=>{}};
  });
  return account.address;
}

test('wallet absence, safe error and mobile/desktop first-use layouts',async({page})=>{
  await page.goto('/');await expect(page.getByRole('button',{name:'Connect & verify wallet'})).toBeVisible();
  await mkdir('.impeccable/review',{recursive:true});
  for(const [name,width,height] of [['desktop',1440,900],['tablet',768,1024],['mobile',390,844]] as const){await page.setViewportSize({width,height});await page.screenshot({path:`.impeccable/review/${name}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  await page.getByRole('button',{name:'Connect & verify wallet'}).click();await expect(page.getByRole('region',{name:'Merchant onboarding'}).getByRole('alert')).toContainText('wallet');
});

test('actual signed login, private persistence, validation, CSRF and logout',async({page})=>{
  await installWallet(page);await page.setViewportSize({width:1440,height:1000});await page.goto('/');
  await page.getByRole('button',{name:'Connect & verify wallet'}).click();await expect(page.getByLabel('Business name')).toBeVisible();
  await page.getByLabel('Business name').focus();await page.keyboard.press('Tab');await expect(page.getByLabel('Website origin')).toBeFocused();
  await page.getByRole('button',{name:'Save business details'}).click();await expect(page.getByLabel('Business name')).toHaveAttribute('aria-invalid','true');
  await page.getByLabel('Business name').fill('Juniper Studio · browser test');await page.getByLabel('Website origin').fill('https://juniper.example');await page.getByRole('button',{name:'Save business details'}).click();await expect(page.getByRole('status').filter({hasText:'saved'})).toBeVisible();
  await page.reload();await expect(page.getByLabel('Business name')).toHaveValue('Juniper Studio · browser test');await expect(page.getByLabel('Website origin')).toHaveValue('https://juniper.example');
  const forbidden=await page.request.patch('/api/merchant',{headers:{Origin:'https://attacker.example'},data:{displayName:'Must not persist',websiteOrigin:'https://attacker.example'}});expect(forbidden.status()).toBe(403);
  const forgedTenant=await page.request.patch('/api/merchant',{headers:{Origin:'http://127.0.0.1:3100'},data:{displayName:'Must not persist',websiteOrigin:'https://attacker.example',merchantId:'00000000-0000-0000-0000-000000000000'}});expect(forgedTenant.status()).toBe(400);
  await page.screenshot({path:'.impeccable/review/authenticated-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.impeccable/review/authenticated-mobile.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('button',{name:'Connect & verify wallet'})).toBeVisible();expect((await page.request.get('/api/auth/me')).status()).toBe(401);
});

test('session expiry preserves saved business and gives a usable sign-in path',async({page})=>{
  await installWallet(page);await page.goto('/');await page.getByRole('button',{name:'Connect & verify wallet'}).click();await expect(page.getByLabel('Business name')).toBeVisible();
  await page.route('**/api/merchant',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:{code:'SESSION_EXPIRED',message:'Your session expired.'}})}));
  await page.getByLabel('Business name').fill('Session state test');await page.getByLabel('Website origin').fill('https://session.example');await page.getByRole('button',{name:'Save business details'}).click();
  await expect(page.getByRole('region',{name:'Merchant onboarding'}).getByRole('alert')).toContainText('session expired');await expect(page.getByRole('button',{name:'Connect & verify wallet'})).toBeVisible();
});
