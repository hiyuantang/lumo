// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo } from 'react';
import { blockPinchZoom } from '../shell/pinchZoom';

export function HtmlPreview({ text, name }: { text: string; name: string }) {
  const document = useMemo(() => {
    const parsed = new DOMParser().parseFromString(text, 'text/html');
    parsed.querySelectorAll('meta[http-equiv], base, script, iframe, frame, object, embed').forEach((element) => element.remove());
    parsed.querySelectorAll('a, area').forEach((element) => {
      for (const attribute of ['href', 'xlink:href']) {
        if (!element.getAttribute(attribute)?.startsWith('#')) element.removeAttribute(attribute);
      }
      element.removeAttribute('target');
    });
    const nonce = crypto.randomUUID();
    const guard = parsed.createElement('script');
    guard.setAttribute('nonce', nonce); guard.textContent = `(${blockPinchZoom.toString()})(document);`;
    parsed.documentElement.style.setProperty('touch-action', 'pan-x pan-y', 'important');
    parsed.body.style.setProperty('touch-action', 'pan-x pan-y', 'important');
    const policy = parsed.createElement('meta');
    policy.httpEquiv = 'Content-Security-Policy';
    policy.content = `default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'; script-src 'nonce-${nonce}'`;
    const viewport = parsed.createElement('meta');
    viewport.name = 'viewport'; viewport.content = 'width=device-width, initial-scale=1';
    parsed.head.prepend(policy, viewport);
    parsed.head.append(guard);
    return '<!doctype html>' + parsed.documentElement.outerHTML;
  }, [text]);
  return <iframe className="preview-html" title={`Preview of ${name}`} data-testid="preview-html" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={document}/>;
}
