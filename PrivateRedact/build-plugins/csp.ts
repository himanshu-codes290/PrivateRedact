import type { Plugin } from 'vite';

/**
 * Production Content-Security-Policy, injected as a <meta> tag at build time.
 *
 * The policy is the enforcement half of the privacy promise: even if a
 * dependency tried to phone home, `connect-src 'self'` blocks the request.
 * Dev builds skip it because Vite's HMR client needs inline scripts and a
 * websocket. Hosts that can send real headers should mirror this policy
 * (see docs/07-deployment.md) and add `frame-ancestors 'none'`, which
 * browsers ignore inside a <meta> tag.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

export function contentSecurityPolicy(): Plugin {
  return {
    name: 'privateredact:csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler: () => [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
          injectTo: 'head-prepend',
        },
        { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head' },
      ],
    },
  };
}
