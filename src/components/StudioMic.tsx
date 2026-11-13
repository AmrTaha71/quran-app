// Studio-microphone emoji (🎙) as a drop-in for lucide's <Mic />: same
// className sizing (w-N h-N), colour classes are ignored (emoji is coloured).
export default function StudioMic({ className = '' }: { className?: string }) {
  const m = /\bw-(\d+(?:\.\d+)?)\b/.exec(className);
  const px = m ? Number(m[1]) * 4 : 20;
  const cls = className.split(/\s+/).filter((c) => /^(w|h|shrink|flex-shrink|ml|mr|mx)-/.test(c)).join(' ');
  return <span aria-hidden className={`inline-flex items-center justify-center leading-none ${cls}`} style={{ fontSize: px * 0.95 }}>🎙️</span>;
}
