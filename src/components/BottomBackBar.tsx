// Bottom-left back control (wave 2, W2-3). Replaces the old in-flow
// shell back buttons at the TOP of every sub-page: on iPhone the Dynamic
// Island sits there and the buttons could not be tapped.
//
// PHYSICAL left (`left`, not `start`): the owner asked for bottom-LEFT
// literally, and the page is RTL. Lifted above the safe-area inset and
// above whatever fixed bottom chrome is on screen (--bottom-chrome-h,
// see lib/bottomChrome.ts). On pages that already have the bottom nav
// (which carries الرئيسية) only ONE button is shown: the page's internal
// back target, or الرئيسية when there is none. Pages without the nav
// show the internal target plus الرئيسية.
import { BackButton, useBackTarget } from './BackButton';

export default function BottomBackBar({ hasBottomNav, onHome }: { hasBottomNav: boolean; onHome: () => void }) {
  const target = useBackTarget();
  return (
    <div
      className="fixed z-[45] flex flex-wrap items-center gap-2 pointer-events-none"
      style={{
        left: 'max(0.75rem, env(safe-area-inset-left))',
        bottom: 'calc(var(--bottom-chrome-h, env(safe-area-inset-bottom, 0px)) + 0.5rem)',
        maxWidth: 'calc(100vw - 1.5rem)',
      }}
    >
      <div className="pointer-events-auto flex flex-wrap items-center gap-2">
        {target ? (
          <>
            <BackButton label={target.label} onBack={target.onBack} />
            {!hasBottomNav && <BackButton label="الرئيسية" onBack={onHome} />}
          </>
        ) : (
          <BackButton label="الرئيسية" onBack={onHome} />
        )}
      </div>
    </div>
  );
}
