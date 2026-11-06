import { z } from 'zod';
import { AppError, baseUnitsSchema } from './index.ts';

export const positiveAmount = baseUnitsSchema.refine(value => BigInt(value) > 0n, 'Enter an amount greater than zero.');
export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.').refine(value => { const parsed = new Date(`${value}T00:00:00Z`); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value; }, 'Enter a valid date.');
const optionalText = (max:number) => z.string().trim().max(max).optional().default('');
export const contactInput = z.object({ name:z.string().trim().min(1).max(100),email:z.union([z.literal(''),z.email().max(254)]).optional().default(''),notes:optionalText(2000) }).strict();
export const contactUpdateInput = contactInput.extend({version:z.number().int().positive()}).strict();
export const versionInput = z.object({version:z.number().int().positive()}).strict();
export const linkInput = z.object({title:z.string().trim().min(1).max(120),amountBaseUnits:positiveAmount,expiresAt:z.iso.datetime({offset:true}).nullable().optional().default(null)}).strict();
export const linkUpdateInput = linkInput.omit({amountBaseUnits:true}).extend({version:z.number().int().positive()}).strict();
export const invoiceInput = z.object({title:z.string().trim().min(1).max(120),amountBaseUnits:positiveAmount,contactId:z.uuid().nullable().optional().default(null),dueDate:dateOnly.nullable().optional().default(null),notes:optionalText(2000)}).strict();
export const apiScope = z.enum(['checkout:create','payment:read']);
export type ApiScope = z.infer<typeof apiScope>;
export const keyInput = z.object({name:z.string().trim().min(1).max(80),scopes:z.array(apiScope).min(1).max(2).refine(value=>new Set(value).size===value.length,'Choose each permission once.')}).strict();
export const webhookInput = z.object({webhookUrl:z.url().max(500),orderApiUrl:z.url().max(500),orderReadSecret:z.string().regex(/^[A-Za-z0-9_-]{32,256}$/,'Use a private order-read secret of 32–256 letters, numbers, underscores or hyphens.').optional()}).strict();
export const noteInput=z.object({note:z.string().trim().min(3).max(2000)}).strict();
export const settingsInput=z.object({version:z.number().int().positive(),paused:z.boolean()}).strict();
export const emptyInput=z.object({}).strict();

export interface OperationFilter {page:number;pageSize:number;search:string;status:string;sort:'newest'|'oldest'|'amount-desc'|'amount-asc';from:string;to:string;offset:number}
export function operationFilter(parameters:URLSearchParams):OperationFilter {
  const today=new Date().toISOString().slice(0,10);const previous=new Date();previous.setUTCDate(previous.getUTCDate()-29);
  const parsed=z.object({page:z.coerce.number().int().min(1).max(1_000_000).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(20),search:z.string().trim().max(120).default(''),status:z.string().max(40).regex(/^[a-z_]*$/).default(''),sort:z.enum(['newest','oldest','amount-desc','amount-asc']).default('newest'),from:dateOnly.default(previous.toISOString().slice(0,10)),to:dateOnly.default(today)}).strict().parse(Object.fromEntries(parameters));
  const days=(Date.parse(`${parsed.to}T00:00:00Z`)-Date.parse(`${parsed.from}T00:00:00Z`))/86_400_000;
  if(days<0||days>365)throw new AppError('INVALID_RANGE',400,'Choose a date range of up to 366 days, with the start before the end.');
  return {...parsed,offset:(parsed.page-1)*parsed.pageSize};
}

export function csvCell(value:unknown):string {
  const text=value===null||value===undefined?'':String(value);
  const protectedText=/^[\s]*[=+\-@\t\r]/.test(text)?`'${text}`:text;
  return `"${protectedText.replaceAll('"','""')}"`;
}
export function csvLine(values:unknown[]):string { return values.map(csvCell).join(','); }
export function csvNumberCell(value:string):string {if(!/^-?(0|[1-9]\d*)(\.\d{1,6})?$/.test(value))throw new Error('Invalid exact CSV number.');return `"${value}"`;}
