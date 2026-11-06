/** Browser-only redirect helper. Server API keys never belong in this module. */
export function redirectToHostedCheckout(checkoutUrl, gatewayOrigin, allowLocal = false) {
  const approved = new URL(gatewayOrigin);
  const target = new URL(checkoutUrl, approved);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(approved.hostname);
  if (approved.username || approved.password || approved.search || approved.hash || approved.pathname !== '/' ||
      (approved.protocol !== 'https:' && !(allowLocal && local && approved.protocol === 'http:')) ||
      target.origin !== approved.origin || target.username || target.password || target.search || target.hash ||
      !/^\/checkout\/[a-f0-9]{64}$/.test(target.pathname)) {
    throw new Error('The checkout address could not be verified.');
  }
  window.location.assign(target.href);
}
