/** Match the fixed local API/OIDC origin without broadening its allowlist. */
export function canonicalLocalAppUrl(href: string, localRuntime: boolean): string | undefined {
  if (!localRuntime) return;
  let url: URL;
  try { url = new URL(href); } catch { return; }
  if (url.protocol !== 'https:' || url.port !== '8080' || url.username || url.password ||
      !['127.0.0.1', '[::1]'].includes(url.hostname)) return;
  url.hostname = 'localhost';
  return url.href;
}
