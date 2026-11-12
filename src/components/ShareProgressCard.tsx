// Shareable progress card (2026-11-06, feature #6).
// Lives in لوحتي, under the مركز الحفظ gate card. Reads the REAL
// contiguous memorized run from the start of the Mushaf
// (memorizedFromStart — the same value the gate card shows, computed
// in UserAppPage from lists.memorized); nothing here is hardcoded.
// The on-screen card is the preview; sharing renders the same design
// onto a 1080×1350 canvas (emerald + gold only) and tries the Web
// Share API with the image file first (works on iPad Safari when
// canShare accepts files). If that is unavailable or fails, it falls
// back to downloading the image + a clean share text with a copy
// button — never a dead share button, never silence.
import { useMemo, useState } from 'react';
import { Share2, Copy, Check, Download, BadgeCheck } from 'lucide-react';
import { TOTAL_VERSES } from '../lib/types';
import { JUZ_STARTS } from '../lib/quranBoundaries';
import { formatAr } from '../lib/numerals';
import { APP_URL } from '../lib/shareLinks';
import { pressFeedback } from '../lib/pressFeedback';

const EMERALD_TOP = '#073B27';
const EMERALD_BOTTOM = '#0E7A52';
const GOLD = '#D4AF37';
const GOLD_LIGHT = '#F0C85A';

// Juz j is complete when the run reaches the last ayah of that juz
// (the global ayah just before the next juz starts; 6236 for juz 30).
function completedJuzCount(run: number): number {
  let done = 0;
  for (let j = 0; j < JUZ_STARTS.length; j++) {
    const end = j + 1 < JUZ_STARTS.length ? JUZ_STARTS[j + 1].global - 1 : TOTAL_VERSES;
    if (run >= end) done = j + 1;
    else break;
  }
  return done;
}

// The juz the last memorized ayah of the run belongs to.
function juzOfAyah(globalAyah: number): number {
  let juz = 1;
  for (const s of JUZ_STARTS) {
    if (globalAyah >= s.global) juz = s.juz;
    else break;
  }
  return juz;
}

function juzWord(n: number): string {
  if (n === 1) return 'جزء واحد';
  if (n === 2) return 'جزءان';
  return `${formatAr(n)} أجزاء`;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w;
    if (ctx.measureText(trial).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export default function ShareProgressCard({ memorizedFromStart }: { memorizedFromStart: number }) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fallbackText, setFallbackText] = useState(false);

  const stats = useMemo(() => {
    const pct = Math.round((memorizedFromStart / TOTAL_VERSES) * 100);
    const juzDone = completedJuzCount(memorizedFromStart);
    const currentJuz = juzOfAyah(Math.max(1, memorizedFromStart));
    const headline =
      juzDone >= 30
        ? 'حفظت القرآن كاملًا'
        : juzDone > 0
          ? `حفظت ${juzWord(juzDone)} كاملة`
          : `حفظت ${formatAr(memorizedFromStart)} آية من أول المصحف`;
    return { pct, juzDone, currentJuz, headline };
  }, [memorizedFromStart]);

  const shareText =
    `${stats.headline} — ${formatAr(memorizedFromStart)} آية من أول المصحف (${formatAr(stats.pct)}٪ من القرآن الكريم)\n` +
    `احفظ القرآن بالتربيطات — تربيطات آيات القرآن:\n${APP_URL}`;

  // Draws the card onto a 1080×1350 canvas (portrait, WhatsApp-friendly).
  const renderCanvas = (): HTMLCanvasElement => {
    const W = 1080;
    const H = 1350;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, EMERALD_TOP);
    grad.addColorStop(1, EMERALD_BOTTOM);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // Gold double frame.
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 6;
    ctx.strokeRect(36, 36, W - 72, H - 72);
    ctx.lineWidth = 2;
    ctx.strokeStyle = GOLD_LIGHT;
    ctx.strokeRect(56, 56, W - 112, H - 112);
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const serif = '"Noto Naskh Arabic", "Geeza Pro", "Amiri", serif';
    // App name + tagline.
    ctx.fillStyle = GOLD_LIGHT;
    ctx.font = `700 64px ${serif}`;
    ctx.fillText('تربيطات آيات القرآن', W / 2, 190);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `400 44px ${serif}`;
    ctx.fillText('احفظ القرآن بالتربيطات', W / 2, 268);
    // Gold divider with a diamond.
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 220, 330);
    ctx.lineTo(W / 2 - 30, 330);
    ctx.moveTo(W / 2 + 30, 330);
    ctx.lineTo(W / 2 + 220, 330);
    ctx.stroke();
    ctx.fillStyle = GOLD;
    ctx.save();
    ctx.translate(W / 2, 330);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-13, -13, 26, 26);
    ctx.restore();
    // Headline (wrapped to the frame).
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 88px ${serif}`;
    const lines = wrapLines(ctx, stats.headline, W - 200);
    let y = 500;
    for (const line of lines) {
      ctx.fillText(line, W / 2, y);
      y += 112;
    }
    // Ayah count + percent.
    ctx.fillStyle = GOLD_LIGHT;
    ctx.font = `700 58px ${serif}`;
    ctx.fillText(
      `${formatAr(memorizedFromStart)} آية من ${formatAr(TOTAL_VERSES)} — ${formatAr(stats.pct)}٪`,
      W / 2,
      y + 60,
    );
    // Progress bar.
    const barX = 140;
    const barW = W - 280;
    const barY = y + 150;
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    roundRect(ctx, barX, barY, barW, 28, 14);
    ctx.fill();
    if (stats.pct > 0) {
      ctx.fillStyle = GOLD;
      roundRect(ctx, barX, barY, Math.max(28, (barW * stats.pct) / 100), 28, 14);
      ctx.fill();
    }
    // Current juz.
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `400 48px ${serif}`;
    ctx.fillText(
      stats.juzDone >= 30 ? 'تقبّل الله منك وثبّت حفظك' : `أنت الآن في الجزء ${formatAr(stats.currentJuz)}`,
      W / 2,
      barY + 110,
    );
    // App link at the bottom.
    ctx.fillStyle = GOLD_LIGHT;
    ctx.font = `400 40px ${serif}`;
    ctx.fillText('rawabit-alziker-alhakim.vercel.app', W / 2, H - 150);
    return canvas;
  };

  const canvasToFile = (): Promise<File> =>
    new Promise((resolve, reject) => {
      try {
        const canvas = renderCanvas();
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('toBlob returned null'));
            return;
          }
          resolve(new File([blob], 'hifz-progress.png', { type: 'image/png' }));
        }, 'image/png');
      } catch (e) {
        reject(e);
      }
    });

  const downloadFile = (file: File) => {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (older iPad / denied permission): show
      // the text so the user can copy it by hand instead of failing.
      setFallbackText(true);
    }
  };

  const share = async () => {
    if (busy) return;
    setBusy(true);
    setStatus('');
    setFallbackText(false);
    try {
      const file = await canvasToFile();
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean; share?: (d: ShareData) => Promise<void> };
      if (typeof nav.canShare === 'function' && typeof nav.share === 'function' && nav.canShare({ files: [file] })) {
        try {
          await nav.share({ files: [file], title: 'تقدّمي في حفظ القرآن', text: shareText });
          setStatus('تمت المشاركة ✓');
          return;
        } catch (e) {
          // User cancelled the sheet: not an error, just stop quietly.
          if (e instanceof DOMException && e.name === 'AbortError') return;
          // Any other share failure falls through to download + text.
        }
      }
      // Web Share with files is not available here (older iPad Safari
      // or a browser without file sharing): save the image and hand
      // the user the text to paste alongside it.
      downloadFile(file);
      setFallbackText(true);
      setStatus('تم تحميل صورة البطاقة — شاركها من معرض الصور، والنص تحت جاهز للنسخ.');
    } catch {
      setStatus('تعذّر إنشاء صورة البطاقة — جرّب نسخ النص بدلًا منها.');
      setFallbackText(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-5 rounded-2xl overflow-hidden shadow-lg">
      {/* On-screen preview — the same emerald + gold design the image carries. */}
      <div className="grad-emerald-door text-white p-5">
        <div className="rounded-2xl border-2 border-[rgba(212,175,55,0.85)] p-5 text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <BadgeCheck className="w-5 h-5 text-amber-300" />
            <p className="font-bold font-display-ar text-lg text-amber-200">تربيطات آيات القرآن</p>
          </div>
          <p className="text-2xl font-bold font-display-ar leading-relaxed">{stats.headline}</p>
          <p className="text-amber-100 mt-1">
            {formatAr(memorizedFromStart)} آية من {formatAr(TOTAL_VERSES)} — {formatAr(stats.pct)}٪
          </p>
          <div className="h-3 bg-white/25 rounded-full overflow-hidden mt-4">
            <div
              className="h-full bg-amber-400 rounded-full transition-all"
              style={{ width: `${Math.max(stats.pct, stats.pct > 0 ? 2 : 0)}%` }}
            />
          </div>
          <p className="text-sm text-emerald-50 mt-3">
            {stats.juzDone >= 30 ? 'تقبّل الله منك وثبّت حفظك' : `أنت الآن في الجزء ${formatAr(stats.currentJuz)}`}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 mt-4">
          <button
            onClick={() => void share()}
            onPointerDown={pressFeedback}
            disabled={busy}
            className="btn-3d-amber flex-1 flex items-center justify-center gap-2 py-3 bg-amber-500 text-white font-bold rounded-xl disabled:opacity-60"
          >
            <Share2 className="w-5 h-5" /> {busy ? 'جارٍ تجهيز البطاقة…' : 'شارك بطاقة تقدّمك'}
          </button>
          <button
            onClick={() => void copyText()}
            onPointerDown={pressFeedback}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-white/15 text-white font-semibold rounded-xl border border-white/30"
          >
            {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
            {copied ? 'تم النسخ ✓' : 'نسخ نص المشاركة'}
          </button>
        </div>
        {status && <p className="text-sm text-emerald-50 font-semibold mt-3 text-center">{status}</p>}
        {fallbackText && (
          <div className="mt-3 bg-white/10 border border-white/25 rounded-xl p-3">
            <p className="text-sm text-white leading-relaxed whitespace-pre-line" dir="rtl">{shareText}</p>
            <button
              onClick={() => void copyText()}
              className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-amber-200 hover:text-amber-100"
            >
              <Download className="w-4 h-4" /> انسخ النص من هنا
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
