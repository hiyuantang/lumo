// SPDX-License-Identifier: AGPL-3.0-only
export function blockPinchZoom(target: Document) {
  const wheel = (event: WheelEvent) => { if (event.ctrlKey) event.preventDefault(); };
  const gesture = (event: Event) => event.preventDefault();
  target.addEventListener('wheel', wheel, { capture: true, passive: false });
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) target.addEventListener(type, gesture, { capture: true, passive: false });
  return () => {
    target.removeEventListener('wheel', wheel, true);
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) target.removeEventListener(type, gesture, true);
  };
}
