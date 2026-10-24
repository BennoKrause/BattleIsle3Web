// Chooses the user interface: the original-like desktop (840x600 windows scaled to the browser) or the
// phone interface (src/ui/mobile). `?ui=mobile` / `?ui=desktop` force one of them.

export function detectMobile(): boolean {
  const forced = new URLSearchParams(location.search).get('ui');
  if (forced === 'mobile') return true;
  if (forced === 'desktop') return false;
  // the choice made in the setup menu
  try {
    const mode = (JSON.parse(localStorage.getItem('bi3.settings') ?? '{}') as { uiMode?: string }).uiMode;
    if (mode === 'mobile') return true;
    if (mode === 'desktop') return false;
  } catch { /* storage unavailable: automatic */ }
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  // phones (touch and a small short side) and any very narrow window; tablets keep the desktop layout
  return (coarse && shortSide < 700) || window.innerWidth < 560;
}

export const isMobileUi = () => document.body.classList.contains('mobile-ui');
