# Phase 3 dashboard API contract

All paths begin `/api/operations`. Session cookie authentication and same-origin mutation checks apply. Strict bodies reject tenant selection and unknown fields. UUID resource IDs are tenant scoped; public references are random 64-character hex. Errors use `{error:{code,message}}`. GET responses use `Cache-Control: private, no-store`.

List query parameters: `page` (1-based), `pageSize` (1–50, default20), `search` (max120), `from`/`to` ISO dates (inclusive UTC calendar dates), `status` optional, `sort` (`newest` default, `oldest`, `amount-desc`, `amount-asc`). Lists return `{items,total,page,pageSize}`. All monetary fields are exact base-unit strings; dates ISO strings. No floating-point totals.

## Read endpoints

- `GET /overview?from=&to=` → `{grossBaseUnits,refundedBaseUnits,netBaseUnits,paymentCount,series:[{date,grossBaseUnits,refundedBaseUnits}],range:{from,to}}`. Period canonical payment inflows minus period canonical refund outflows; a period can have negative net. Source event timestamps, never checkout creation timestamps, determine dates.
- `GET /payments` → payment list. Item: `{id,reference,orderId,amountBaseUnits,refundedBaseUnits,status,confirmationStage,deliveryStatus,riskState,payer,merchantWallet,txHash,createdAt,sourceTime,stateVersion}`.
- `GET /payments/:id` → `{item,timeline,remainingRefundableBaseUnits}`; timeline items `{eventType,status,attempts,errorCode,createdAt,stateVersion}`.
- `GET /contacts` → `{id,name,email,notes,archived,version,createdAt,updatedAt}`. `GET /contacts/:id` → `{item,invoices}` (private history).
- `GET /links` → `{id,reference,title,amountBaseUnits,expiresAt,active,version,url,createdAt,paymentCount}`.
- `GET /invoices` → `{id,reference,title,amountBaseUnits,contactId,contactName,dueDate,notes,status,version,url,createdAt,paidBaseUnits,refundedBaseUnits}`. Status derived: unpaid/overdue/paid/partially_refunded/refunded/review/void. `GET /invoices/:id` → `{item,contactSnapshot,merchant}` (authenticated printable data). Public invoice metadata excludes contact/notes.
- `GET /keys` → `{id,name,prefix,scopes,revokedAt,createdAt,lastUsedAt}`; never hash/raw material.
- `GET /webhooks` → `{config:{webhookUrl,orderApiUrl,configured,active,secretConfigured},items,total,page,pageSize}`; items are nonfinancial endpoint test deliveries `{id,status,attempts,errorCode,createdAt}`.
- `GET /deliveries` → `{id,paymentId,stateVersion,eventType,status,attempts,errorCode,createdAt,replayCount}`.
- `GET /reviews` → `{items,total,page,pageSize,screening}`. Item `{id,paymentId,reference,orderId,amountBaseUnits,status,riskState,refundHold,payer,merchantWallet,stateVersion,createdAt,notes:[{id,note,createdAt}]}`. `id` is payment ID.
- `GET /audit` → `{id,kind,metadata,createdAt}`; server scrubs secrets and private provider responses from metadata.
- `GET /settings` → `{settings:{paused,version},merchant,screening,sessions:[{id,createdAt,expiresAt,current}]}`. Merchant shape matches existing `/api/merchant`; session IDs are opaque HMAC-derived references, never bearer hashes.
- `GET /reports.csv?from=&to=&status=&search=` → downloadable exact-value CSV with formula-safe text. Same canonical period formula as overview.

## Mutations

- `POST /contacts` `{name,email?,notes?}` → `{item}`.
- `PATCH /contacts/:id` `{version,name,email?,notes?}` → `{item}`.
- `POST /contacts/:id/archive` `{version}` → `{item}`. Historical invoice snapshots remain unchanged.
- `POST /links` `{title,amountBaseUnits,expiresAt?}` → `{item}`.
- `PATCH /links/:id` `{version,title,expiresAt?}` → `{item}` (issued values are immutable; edit amount by making a new link).
- `POST /links/:id/deactivate` `{version}` → `{item}`; new sessions/authorizations are blocked, existing signed payloads have a disclosed short validity window.
- `POST /invoices` `{title,amountBaseUnits,contactId?,dueDate?,notes?}` → `{item}`. `dueDate` is `YYYY-MM-DD`.
- `POST /invoices/:id/void` `{version}` → `{item}`; only unpaid/unreserved invoice can void, with outstanding authorization-window disclosure.
- `POST /keys` `{name,scopes:["checkout:create","payment:read"]}` → `{item,key}`; key shown once.
- `POST /keys/:id/revoke` `{}` → `{item}`.
- `POST /keys/:id/rotate` `{}` → `{item,key}`; atomically revokes old credential and creates replacement with same scope/name, shown once.
- `PATCH /webhooks` `{webhookUrl,orderApiUrl,orderReadSecret?}` → `{config,secret?}`; origins must match approved merchant website, local loopback only in explicit development mode. Missing secret during first configuration is generated/revealed once; later omitted order-read secret preserves existing value.
- `POST /webhooks/rotate-secret` `{}` → `{secret}`; new raw secret shown once; receiver must update its private configuration.
- `POST /webhooks/test` `{}` → `{item}`; real HMAC HTTP test, labeled nonfinancial and incapable of fulfillment.
- `POST /deliveries/:id/replay` `{}` → `{item}`; max3 manual replays, >=60sec cooldown, requires current matching accepted eligibility; does not reset policy/version/receiver safeguards.
- `POST /reviews/:paymentId/notes` `{note}` → `{item}`.
- `POST /reviews/:paymentId/resolve` `{}` → `{item}`; fresh canonical/screening/refund/order checks required; hard denials, orphaned/refunded/held payments cannot be manually overridden.
- `POST /reviews/refresh` `{}` → `{screening}`; performs current required-source evaluation, never invents a successful import.
- `PATCH /settings` `{version,paused}` → `{settings}`. Profile/settlement ownership remain the working `/api/merchant` and `/api/merchant/settlement/*` APIs.
- `POST /settings/sessions/revoke-others` `{}` → `{revoked}`. Current session retained.
- `POST /settings/sessions/:id/revoke` `{}` → `{revoked}`; session self-revoke returns subsequent401/sign-in state.

## Public collection integration

Private services export `assertCollectionPayable(sql,checkout)`, `readInternalOrder(db,merchantId,orderId,amount)` and `createCollectionCheckout(db,"link"|"invoice",reference)`. Public link URL is `/pay/:reference`, public invoice URL `/invoice/:reference`. Parent public routes call creation only after explicit buyer action; viewing a link does not create orders. Returned `{reference,checkoutUrl}` points to the existing hosted checkout. Collection orders use immutable amount/merchant snapshots and real canonical state; no external webhook configuration is needed. Store mode keeps authenticated external order reads.

Parent server-key hook calls `authenticateOperationKey(db,bearer,requiredScope)`. Once any scoped-key row exists for a merchant, legacy integration-key lookup is permanently superseded, including after all new keys are revoked. Revoking server access does not disable the separately stored webhook configuration or erase existing delivery jobs.
