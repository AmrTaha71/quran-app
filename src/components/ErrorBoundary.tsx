// 2026-11-12 (review A1): top-level error boundary. Without it, one render
// error unmounts the whole tree and leaves a blank screen. It catches render
// and lifecycle errors only (not async or event-handler errors).
// Recovery is a plain reset: clear the hash route (back to Home) and render
// the children again. Nothing is stored, so there is nothing to lose.
import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Content-free: the message and component stack only, no user data.
    console.error('[ErrorBoundary]', error.message, info.componentStack);
  }

  private goHome = () => {
    window.location.hash = '';
    this.setState({ error: null });
  };

  private reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div dir="rtl" role="alert" className="min-h-[100dvh] flex items-center justify-center p-6 bg-[#f7f5ef] text-[#064e3b] font-sans">
        <div className="max-w-sm w-full text-center space-y-4">
          <h1 className="text-xl font-bold">حصلت مشكلة في الشاشة دي</h1>
          <p className="text-base leading-relaxed text-[#065f46]">
            التطبيق لسه شغال. ارجع للرئيسية، ولو المشكلة فضلت اعمل إعادة تحميل.
          </p>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={this.goHome}
              className="w-full py-3 rounded-xl bg-[#065f46] text-white font-bold"
            >
              ارجع للرئيسية
            </button>
            <button
              type="button"
              onClick={this.reload}
              className="w-full py-3 rounded-xl bg-white border border-[#065f46] text-[#065f46] font-bold"
            >
              إعادة التحميل
            </button>
          </div>
        </div>
      </div>
    );
  }
}
