import { setTimeout } from 'node:timers/promises';
import { importCurrentOfac, ScreeningSourceError } from '@settlekit/screening';
import { backfillPublicCorrections,claimJob, completeJob, database, failJob, publishSnapshot, recordSourceFailure, refreshMerchantScreening } from '@settlekit/db';
import { deliverPayment, observePayments, recordDeliveryFailure } from './payments.ts';
import {publishArkiv,scheduleArkivRenewals} from './arkiv.ts';
const db=database();let stopping=false;let nextRefresh=0;let nextObserve=0;let nextRenew=0;
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{stopping=true;});
process.stdout.write('SettleKit worker started.\n');
try {
  while(!stopping){
    try{
      if(Date.now()>=nextRefresh){
        nextRefresh=Date.now()+3_600_000;
        try{await publishSnapshot(db,await importCurrentOfac());process.stdout.write('Required screening source refreshed.\n');}
        catch(error){await recordSourceFailure(db,error instanceof ScreeningSourceError?error.code:'SOURCE_IMPORT_FAILED');process.stderr.write('Required screening source unavailable; decisions fail closed.\n');nextRefresh=Date.now()+60_000;}
      }
      if(Date.now()>=nextObserve){nextObserve=Date.now()+5000;try{await observePayments(db);await backfillPublicCorrections(db);}catch{process.stderr.write('Chain observation unavailable; payment actions remain verified individually.\n');}}
      if(Date.now()>=nextRenew){nextRenew=Date.now()+3600000;try{await scheduleArkivRenewals(db);}catch{process.stderr.write('Public receipt renewal check unavailable; retrying on the next scheduled check.\n');}}
      const job=await claimJob(db);
      if(!job){await setTimeout(1000);continue;}
      try{
        if(job.kind==='merchant.screening'&&job.merchant_id)await refreshMerchantScreening(db,job.merchant_id);
        else if(job.kind==='payment.webhook')await deliverPayment(db,job);
        else if(job.kind==='arkiv.publish'){if(await publishArkiv(db,job)==='deferred')continue;}
        else throw new Error('UNSUPPORTED_JOB');
        await completeJob(db,job);
      }catch{await recordDeliveryFailure(db,job);await failJob(db,job,'JOB_FAILED');}
    }catch{process.stderr.write('Worker dependency temporarily unavailable; retrying safely.\n');await setTimeout(5000);}
  }
}finally{await db.pool.end();}
