export const sections = ['overview', 'payments', 'links', 'invoices', 'contacts', 'developers', 'webhooks', 'reports', 'risk', 'settings', 'audit'] as const;
export type Section = typeof sections[number];
export interface List<T> { items: T[]; total: number; page: number; pageSize: number }
export interface Merchant { id: string; displayName: string; websiteOrigin: string; ownerWallet: string; settlementWallet: string; settlementProvenAt: string; version: number; screening: Screening }
export interface Screening { state: string; checkedAt: string; expiresAt: string; sourceFetchedAt: string | null; sourceHash: string | null; sourceAgeMs: number | null; sourceUrl?: string; reasonCodes: string[] }
export interface Overview { grossBaseUnits: string; refundedBaseUnits: string; netBaseUnits: string; paymentCount: number; reviewCount: number; notificationIssueCount: number; unverifiedTimestampCount: number; series: Array<{ date: string; grossBaseUnits: string; refundedBaseUnits: string }>; range: { from: string; to: string } }
export interface Payment { id: string; reference: string; orderId: string; amountBaseUnits: string; refundedBaseUnits: string; status: string; confirmationStage: string; deliveryStatus: string | null; riskState: string; payer: string; merchantWallet: string; txHash: string; createdAt: string; sourceTime: string | null; stateVersion: number }
export interface PaymentDetail { item: Payment; remainingRefundableBaseUnits: string; timeline: Array<{ eventType: string; status: string; attempts: number; errorCode: string | null; createdAt: string; stateVersion: number }> }
export interface Contact { id: string; name: string; email: string; notes: string; archived: boolean; version: number; createdAt: string; updatedAt: string }
export interface PaymentLink { id: string; reference: string; title: string; amountBaseUnits: string; expiresAt: string | null; active: boolean; version: number; url: string; createdAt: string; paymentCount: number }
export interface Invoice { id: string; reference: string; title: string; amountBaseUnits: string; contactId: string | null; contactName: string | null; dueDate: string | null; notes: string; status: string; version: number; url: string; createdAt: string; paidBaseUnits: string; refundedBaseUnits: string }
export interface ApiKey { id: string; name: string; prefix: string; scopes: string[]; revokedAt: string | null; createdAt: string; lastUsedAt: string | null }
export interface WebhookConfig { webhookUrl: string; orderApiUrl: string; configured: boolean; active: boolean; secretConfigured: boolean }
export interface EndpointTest { id: string; status: string; attempts: number; errorCode: string | null; createdAt: string }
export interface Webhooks extends List<EndpointTest> { config: WebhookConfig }
export interface Delivery extends EndpointTest { paymentId: string; stateVersion: number; eventType: string; replayCount: number; recoveryActor?: string|null; recoveredAt?: string|null }
export interface Review { id: string; paymentId: string; reference: string; orderId: string; amountBaseUnits: string; status: string; riskState: string; refundHold: boolean; payer: string; merchantWallet: string; stateVersion: number; createdAt: string; notes: Array<{ id: string; note: string; createdAt: string }> }
export interface Reviews extends List<Review> { screening: Screening }
export interface Session { id: string; createdAt: string; expiresAt: string; current: boolean }
export interface Settings { settings: { paused: boolean; version: number }; merchant: Merchant; screening: Screening; sessions: Session[] }
export interface Audit { id: string; kind: string; metadata: Record<string, unknown>; createdAt: string }
