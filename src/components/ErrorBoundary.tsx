// 2026-11-12 (review A1): error boundary. Without it, one render error
// unmounts the whole tree and leaves a blank screen. It catches render
// and lifecycle errors only (not async or event-handler errors; those go
// to the local error log through installGlobalErrorLog, 10.3).
//
// 10.4 (2026-11-26):
// - `page` mode wraps ONE page inside the app shell: a crash there keeps
//   the shell (bottom bar, listening/adhkar audio wrappers) alive and
//   offers «أعد تحميل الصفحة دي بس» (remounts just that page).
// - The top-level mode counts «ارجع للرئيسية» tries this session; after
//   two it stops offering it (it would loop) and offers a reload and
//   «امسح بيانات الجلسة المؤقتة وأعد التحميل» instead.
// - Every catch goes to the local error log (no user data).
import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';
import { logError } from '../lib/errorReporting';

type Props = { children: ReactNode; page?: string };
type State = { error: Error | null; resetKey: number };

const TRIES_KEY = 'quran-error-home-tries';
function homeTries(): number { try { return Number(sessionStorage.getItem(TRIES_KEY) || '0') || 0; } catch { return 0; } }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Content-free: the message and component stack only, no user data.
    console.error('[ErrorBoundary]', error.message, info.componentStack);
    logError(this.props.page ? `render:${this.props.page}` : 'render', error);
  }

  private goHome = () => {
    try { sessionStorage.setItem(TRIES_KEY, String(homeTries() + 1)); } catch { /* ignore */ }
    window.location.hash = '';
    this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }));
  };

  private retryPage = () => {
    this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }));
  };

  private reload = () => {
    window.location.reload();
  };

  private clearSessionAndReload = () => {
    try { sessionStorage.clear(); } catch { /* ignore */ }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>;
    const btn = 'w-full py-3 rounded-xl font-bold';
    if (this.props.page) {
      return (
        <div dir="rtl" role="alert" className="min-h-[60dvh] flex items-center justify-center p-6 text-[#30064E]">
          <div className="max-w-sm w-full text-center space-y-4">
            <h1 className="text-xl font-bold">حصلت مشكلة في الصفحة دي</h1>
            <p className="text-base leading-relaxed text-[#3A065F]">باقي التطبيق شغال. جرّب تفتح الصفحة تاني.</p>
            <div className="flex flex-col gap-3">
              <button type="button" onClick={this.retryPage} className={`${btn} bg-[#3A065F] text-white`}>أعد تحميل الصفحة دي بس</button>
              <button type="button" onClick={this.reload} className={`${btn} bg-white border border-[#3A065F] text-[#3A065F]`}>إعادة تحميل التطبيق</button>
            </div>
          </div>
        </div>
      );
    }
    const looping = homeTries() >= 2;
    return (
      <div dir="rtl" role="alert" className="min-h-[100dvh] flex items-center justify-center p-6 bg-[#f7f5ef] text-[#30064E] font-sans">
        <div className="max-w-sm w-full text-center space-y-4">
          <h1 className="text-xl font-bold">حصلت مشكلة في الشاشة دي</h1>
          <p className="text-base leading-relaxed text-[#3A065F]">
            {looping
              ? 'المشكلة اتكررت. أعد تحميل التطبيق، ولو فضلت امسح بيانات الجلسة المؤقتة (تقدّمك ومحفوظك مش هيتمسحوا).'
              : 'التطبيق لسه شغال. ارجع للرئيسية، ولو المشكلة فضلت اعمل إعادة تحميل.'}
          </p>
          <div className="flex flex-col gap-3">
            {!looping && (
              <button type="button" onClick={this.goHome} className={`${btn} bg-[#3A065F] text-white`}>ارجع للرئيسية</button>
            )}
            <button type="button" onClick={this.reload} className={`${btn} ${looping ? 'bg-[#3A065F] text-white' : 'bg-white border border-[#3A065F] text-[#3A065F]'}`}>إعادة التحميل</button>
            {looping && (
              <button type="button" onClick={this.clearSessionAndReload} className={`${btn} bg-white border border-[#3A065F] text-[#3A065F]`}>امسح بيانات الجلسة المؤقتة وأعد التحميل</button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
