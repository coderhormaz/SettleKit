'use client';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowDownToLine, ArrowRight, Check, ChevronDown, CircleAlert, ExternalLink, FileSearch, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { accountingCsv, queryReceipts, reconcileCoverage, scanCoverage, summarizeVerified, verifyReceipt, type CoverageCursor, type PublicReceipt, type ReceiptEntity, type SourceConfig, type VerifiedEntity } from '@settlekit/arkiv';
import type { Address, Hex } from 'viem';

export interface ViewerConfig {writer:Address;arkivRpcUrl:string;defaultMerchant:Address;source:SourceConfig|null}
interface Filters {merchant:string;kind:''|PublicReceipt['kind'];fromDate:string;toDate:string;fromBlock:string;toBlock:string}
interface Coverage {cursor:CoverageCursor;events:PublicReceipt[];complete:boolean;scannedBlocks:string}
function units(value:string){const integer=BigInt(value);const sign=integer<0n?'-':'';const amount=integer<0n?-integer:integer;const fraction=(amount%1_000_000n).toString().padStart(6,'0').replace(/0+$/,'');return sign+(amount/1_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction?'.'+fraction:'');}
const short=(value:string)=>`${value.slice(0,8)}…${value.slice(-6)}`;
const date=(seconds:number)=>new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(seconds*1000));
function scope(filters:Filters){
  if(!/^0x[0-9a-f]{40}$/i.test(filters.merchant))throw new Error('Enter a complete merchant wallet address.');
  for(const value of [filters.fromBlock,filters.toBlock])if(value&&!/^(0|[1-9]\d{0,19})$/.test(value))throw new Error('Block numbers must be nonnegative whole numbers.');
  if(filters.fromBlock&&filters.toBlock&&BigInt(filters.fromBlock)>BigInt(filters.toBlock))throw new Error('The first block must be before the last block.');
  if(filters.fromDate&&filters.toDate&&filters.fromDate>filters.toDate)throw new Error('The start date must be before the end date.');
  return {merchant:filters.merchant.toLowerCase() as Address,kind:filters.kind||undefined,fromBlock:filters.fromBlock||undefined,toBlock:filters.toBlock||undefined,fromDate:filters.fromDate?Math.floor(Date.parse(filters.fromDate+'T00:00:00Z')/1000):undefined,toDate:filters.toDate?Math.floor(Date.parse(filters.toDate+'T23:59:59Z')/1000):undefined};
}
function failure(error:unknown){return error instanceof Error&&error.message.startsWith('Enter ')||error instanceof Error&&error.message.startsWith('The ')?error.message:'The public data source could not finish this request. Retry shortly; loaded records are preserved.';}

export function Accountant({config}:{config:ViewerConfig}){
  const initial:Filters={merchant:config.defaultMerchant,kind:'',fromDate:'',toDate:'',fromBlock:config.source?.deploymentBlock??'',toBlock:''};
  const [filters,setFilters]=useState(initial);const [active,setActive]=useState(initial);const [results,setResults]=useState<VerifiedEntity[]>([]);
  const [cursor,setCursor]=useState<Hex|null>(null);const [loaded,setLoaded]=useState(false);const [busy,setBusy]=useState<'query'|'verify'|'scan'|null>(null);
  const [message,setMessage]=useState('Read public records to begin.');const [error,setError]=useState<string|null>(null);const [queryHead,setQueryHead]=useState<string|null>(null);
  const [coverage,setCoverage]=useState<Coverage|null>(null);const [expanded,setExpanded]=useState<string|null>(null);const initialized=useRef(false);const stop=useRef(false);
  const summary=useMemo(()=>summarizeVerified(results),[results]);
  const covered=useMemo(()=>coverage?reconcileCoverage(coverage.events,summary.records.filter(entity=>active.kind===''||entity.receipt.kind===active.kind),coverage.complete,cursor===null):null,[coverage,summary.records,cursor,active.kind]);
  async function read(next=false){
    if(busy)return;setError(null);let query:ReturnType<typeof scope>;
    const chosen=next?active:filters;try{query=scope(chosen);}catch(cause){setError(failure(cause));return;}
    setBusy('query');setMessage('Reading owner-filtered receipts directly from Arkiv…');
    try{
      const page=await queryReceipts({...query,writer:config.writer,arkivRpcUrl:config.arkivRpcUrl,...(next&&cursor?{cursor}:{}),pageSize:25});
      setBusy('verify');setMessage(`Checking ${page.entities.length} public record${page.entities.length===1?'':'s'} against source-chain evidence…`);
      const checked:VerifiedEntity[]=[];
      for(let start=0;start<page.entities.length;start+=3){
        const batch=page.entities.slice(start,start+3);
        checked.push(...await Promise.all(batch.map(entity=>config.source?verifyReceipt(entity,{...config.source,writer:config.writer}):Promise.resolve({entity,status:'unavailable' as const,reason:'SOURCE_DEPLOYMENT_UNAVAILABLE'}))));
        setMessage(`Verified ${Math.min(start+3,page.entities.length)} of ${page.entities.length} loaded records.`);
      }
      setResults(previous=>next?[...previous,...checked]:checked);setCursor(page.nextCursor);setQueryHead(page.readAtBlock);setLoaded(true);
      if(!next){setActive(chosen);setCoverage(null);setExpanded(null);}
      setMessage(page.entities.length===0?'No public receipts match these filters.':`${page.entities.length} records read. Source verification results are shown below.`);
    }catch(cause){setError(failure(cause));setMessage('Public query did not complete.');}finally{setBusy(null);}
  }
  useEffect(()=>{if(!initialized.current){initialized.current=true;void read();}},[]);
  function submit(event:FormEvent){event.preventDefault();void read();}
  function change(name:keyof Filters,value:string){setFilters(previous=>({...previous,[name]:value}));}
  async function scan(){
    if(busy||!config.source)return;setError(null);setBusy('scan');stop.current=false;
    try{
      const query=scope(active);let current=coverage;
      for(let n=0;n<10&&!stop.current;n++){
        const batch=await scanCoverage(config.source,{...query,cursor:current?.cursor,maxBlocks:200});
        current={cursor:batch.cursor,events:[...(current?.events??[]),...batch.events.filter(receipt=>!query.kind||receipt.kind===query.kind)],complete:batch.complete,scannedBlocks:batch.scannedBlocks};
        setCoverage(current);setMessage(`Source coverage: ${batch.scannedBlocks} blocks scanned through ${BigInt(batch.cursor.nextBlock)-1n}.`);
        if(batch.complete)break;
      }
    }catch(cause){setError(failure(cause));}finally{setBusy(null);}
  }
  function csv(){
    const blob=new Blob([accountingCsv(summary.records)],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='settlekit-available-verified-records.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <><a className="skip" href="#records">Skip to records</a><header className="masthead"><a className="brand" href="/" aria-label="SettleKit Accountant home"><span className="brand-mark"><ArrowRight size={18}/></span>SettleKit <span className="brand-section">Accountant</span></a><span className="environment">Rabdi + Whitechain <span>Testnet</span></span></header>
    <main><div className="page-heading"><div><h1>Receipts you can verify.</h1><p>Public accounting, read independently from the payment gateway.</p></div><button className="secondary" onClick={csv} disabled={!summary.records.length||busy!==null}><ArrowDownToLine size={16}/>Export verified CSV</button></div>
      <form className="filters" onSubmit={submit} aria-label="Receipt filters"><fieldset disabled={busy!==null}><div className="filter-top"><label className="merchant">Merchant wallet<input name="merchant" value={filters.merchant} onChange={event=>change('merchant',event.target.value)} spellCheck={false} autoComplete="off" placeholder="0x…"/></label><label>Record kind<select value={filters.kind} onChange={event=>change('kind',event.target.value)}><option value="">All records</option><option value="payment">Payments</option><option value="refund">Refunds</option><option value="correction">Corrections</option></select></label><button className="primary" type="submit">{busy==='query'||busy==='verify'?<LoaderCircle className="spin" size={16}/>:<RefreshCw size={16}/>}Read records</button></div><div className="filter-range"><label>From date · UTC<input type="date" value={filters.fromDate} onChange={event=>change('fromDate',event.target.value)}/></label><label>Through date · UTC<input type="date" value={filters.toDate} onChange={event=>change('toDate',event.target.value)}/></label><label>From block<input inputMode="numeric" value={filters.fromBlock} onChange={event=>change('fromBlock',event.target.value)} placeholder="Deployment block"/></label><label>Through block<input inputMode="numeric" value={filters.toBlock} onChange={event=>change('toBlock',event.target.value)} placeholder="Latest accepted block"/></label></div></fieldset><p className="filter-help">Filters apply when you read records. Amounts describe available verified activity in this scope, not a wallet balance.</p></form>
      {error&&<div className="notice error" role="alert"><CircleAlert size={17}/><div><strong>Couldn’t finish the request</strong><p>{error}</p></div></div>}
      <section className="totals" aria-label="Available verified totals"><div><span>Gross received</span><strong>{loaded?units(summary.grossBaseUnits):'—'}<small>USDT</small></strong></div><div><span>Refunded</span><strong>{loaded?units(summary.refundedBaseUnits):'—'}<small>USDT</small></strong></div><div><span>Net activity</span><strong>{loaded?units(summary.netBaseUnits):'—'}<small>USDT</small></strong></div></section>
      <section className="coverage" aria-labelledby="coverage-heading"><div className="coverage-top"><div><h2 id="coverage-heading">History coverage</h2><p>{!config.source?'A verified public router deployment is required to reconcile source-chain history.':covered?.complete?'The loaded public records match the scanned source range.':'Verify a stated Whitechain range to find receipts missing from the available public records.'}</p></div>{config.source&&loaded&&<button className="secondary" disabled={busy!==null} onClick={()=>void scan()}>{busy==='scan'?<LoaderCircle className="spin" size={16}/>:<ShieldCheck size={16}/>} {coverage&&!coverage.complete?'Continue scan':'Reconcile range'}</button>}{busy==='scan'&&<button className="text-button" onClick={()=>{stop.current=true;}}>Stop after batch</button>}</div>
        {coverage&&<><dl className="coverage-facts"><div><dt>Stated range</dt><dd>{coverage.cursor.fromBlock}–{coverage.cursor.toBlock}</dd></div><div><dt>Scanned blocks</dt><dd>{coverage.scannedBlocks}</dd></div><div><dt>Source events</dt><dd>{covered?.sourceEvents}</dd></div><div><dt>Missing / unavailable</dt><dd>{covered?.missing.length}</dd></div></dl><p className={covered?.complete?'coverage-result complete':'coverage-result'}>{covered?.complete?<Check size={15}/>:<CircleAlert size={15}/>} {covered?.complete?'Range reconciled at the displayed source anchor.':!coverage.complete?'Scan is partial. Continue to cover the remaining range.':cursor?'More Arkiv pages remain. Load them before treating apparent gaps as final.':covered?.missing.length?'Some source events have no available verified record. Receipts may be unwritten, expired or removed.':'Records and source scan do not fully agree; review before treating this as complete history.'}</p></>}
        <p className="coverage-note">An Arkiv query alone does not establish completeness. Expiry, deletion and provider availability can create gaps. “Included in 2 blocks” is soft confirmation, not finality.</p></section>
      <section id="records" className="records" aria-labelledby="records-heading"><div className="records-heading"><div><h2 id="records-heading">Public receipts <span>{loaded?summary.records.length:'—'}</span></h2><p aria-live="polite">{message}</p></div>{queryHead&&<span className="read-head">Arkiv read block {queryHead}</span>}</div>
        {!results.length?<div className="empty"><FileSearch size={30}/><h3>{busy?'Reading public records…':loaded?'No receipts in this scope':'Read independently. Verify precisely.'}</h3><p>{loaded?'No matching owned records were returned. This does not mean no payments occurred.':'Choose a merchant and read the public ledger. Source evidence determines which records count.'}</p></div>:<div className="table-wrap"><table><thead><tr><th>Record</th><th>Amount</th><th>Source block</th><th>Verification</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{results.map((result,index)=><ReceiptRow key={result.entity.entityKey+index} result={result} open={expanded===result.entity.entityKey} toggle={()=>setExpanded(previous=>previous===result.entity.entityKey?null:result.entity.entityKey)}/>)}</tbody></table></div>}
        {(summary.rejected>0||summary.unavailable>0||summary.duplicateCount>0)&&<p className="record-note">{summary.rejected} rejected · {summary.unavailable} unavailable · {summary.duplicateCount} duplicate copies excluded from totals. Corrections never add money.</p>}
        {cursor&&<div className="pagination"><button className="secondary" disabled={busy!==null} onClick={()=>void read(true)}>Load next 25 records</button><span>Totals cover loaded verified records only.</span></div>}
      </section>
      <footer><div><ShieldCheck size={16}/><p>Reads Arkiv and Whitechain directly. No gateway history API or private database.</p></div><p>Trusted creator and owner <code>{config.writer}</code><br/>Receipt retention: 90 days, with deliberate renewal. Availability is not perpetual.</p></footer>
    </main></>;
}
function ReceiptRow({result,open,toggle}:{result:VerifiedEntity;open:boolean;toggle:()=>void}){
  const {receipt,entityKey}=result.entity;
  return <><tr><td data-label="Record"><span className="record-kind">{receipt.kind}</span><span className="record-date">{date(receipt.sourceTimestamp)} UTC</span></td><td data-label="Amount" className="amount">{units(receipt.amountBaseUnits)} <span>USDT</span></td><td data-label="Source block"><span>{receipt.blockNumber}</span><span className="record-date"><a href={`https://explorer.testnet.whitechain.io/tx/${receipt.txHash}`} target="_blank" rel="noreferrer">{short(receipt.txHash)} <ExternalLink size={11}/></a></span></td><td data-label="Verification"><span className={`status ${result.status}`}>{result.status==='verified'?<Check size={13}/>:<CircleAlert size={13}/>} {result.status}</span></td><td className="detail-control"><button className="icon-button" aria-label={`${open?'Hide':'Show'} ${receipt.kind} receipt details`} aria-expanded={open} onClick={toggle}><ChevronDown size={16} className={open?'rotated':''}/></button></td></tr>{open&&<tr className="detail-row"><td colSpan={5}><dl className="detail-list"><div><dt>Verification reason</dt><dd>{result.reason.replaceAll('_',' ').toLowerCase()}</dd></div><div><dt>Entity</dt><dd><a href={`https://rabdi.explorer.arkiv.network/entity/${entityKey}`} target="_blank" rel="noreferrer">{entityKey}<ExternalLink size={12}/></a></dd></div><div><dt>Source transaction / log</dt><dd>{receipt.txHash} / {receipt.logIndex}</dd></div><div><dt>Source block hash</dt><dd>{receipt.blockHash}</dd></div><div><dt>Merchant / payer</dt><dd>{receipt.merchant}<br/>{receipt.payer}</dd></div><div><dt>Arkiv expiry block</dt><dd>{result.entity.expiresAt} · read at {result.entity.readAtBlock}</dd></div></dl></td></tr>}</>;
}
