import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
const manrope=localFont({src:'../../gateway/public/fonts/manrope-variable.ttf',variable:'--font-manrope',weight:'200 800',display:'swap'});
export const metadata:Metadata={title:'SettleKit Accountant',description:'Independently query and verify public settlement records from Arkiv against Whitechain.'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en" className={manrope.variable}><body>{children}</body></html>;}
