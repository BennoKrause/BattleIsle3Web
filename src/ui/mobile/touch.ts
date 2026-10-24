// Touch / pointer input of the map: one finger drags the map, a short touch without movement is a tap
// (select / target a field), two fingers zoom (pinch) and drag.

export interface TouchHooks {
  getZoom(): number;
  /** Zooms keeping the canvas point (ax, ay) fixed. */
  setZoom(zoom: number, ax: number, ay: number): void;
  pan(dx: number, dy: number): void;
  tap(clientX: number, clientY: number): void;
}

export function installTouchMap(canvas: HTMLCanvasElement, hooks: TouchHooks) {
  const pointers = new Map<number, { x: number; y: number }>();
  let panning = false;
  let startTime = 0, startX = 0, startY = 0;
  let pinch: { dist: number; zoom: number } | null = null;

  const scale = () => canvas.getBoundingClientRect().width / canvas.width;
  const dist = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const mid = () => { const [a, b] = [...pointers.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) { panning = false; startTime = performance.now(); startX = e.clientX; startY = e.clientY; }
    if (pointers.size === 2) { pinch = { dist: dist(), zoom: hooks.getZoom() }; panning = true; }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    const before = pointers.size === 2 ? mid() : null;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 1) {
      if (!panning && Math.hypot(e.clientX - startX, e.clientY - startY) > 8) panning = true;
      if (panning) hooks.pan(dx / scale(), dy / scale());
    } else if (pointers.size === 2 && pinch && before) {
      const now = mid(), r = canvas.getBoundingClientRect(), k = scale();
      hooks.pan((now.x - before.x) / k, (now.y - before.y) / k);
      hooks.setZoom(pinch.zoom * (dist() / pinch.dist), (now.x - r.left) / k, (now.y - r.top) / k);
    }
  });
  const up = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    const wasSingle = pointers.size === 1;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (wasSingle && !panning && performance.now() - startTime < 600) hooks.tap(e.clientX, e.clientY);
    if (!pointers.size) panning = false;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); pinch = null; panning = false; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect(), k = scale();
    hooks.setZoom(hooks.getZoom() * (e.deltaY < 0 ? 1.15 : 1 / 1.15), (e.clientX - r.left) / k, (e.clientY - r.top) / k);
  }, { passive: false });
}
