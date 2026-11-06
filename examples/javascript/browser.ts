// Browser-safe: this module has no server credentials, Node imports or payment-acceptance logic.
export function redirectToHostedCheckout(checkoutUrl: string, gatewayOrigin: string, allowLocal = false): void {
  const approved = new URL(gatewayOrigin); const target = new URL(checkoutUrl);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(approved.hostname);
  if (approved.username || approved.password || approved.hash || approved.search || approved.pathname !== '/' || (approved.protocol !== 'https:' && !(allowLocal && loopback && approved.protocol === 'http:')) || target.origin !== approved.origin || target.username || target.password || target.hash || target.search || !/^\/checkout\/[a-f0-9]{64}$/.test(target.pathname)) throw new Error('The hosted checkout address could not be verified.');
  window.location.assign(target.href);
}
