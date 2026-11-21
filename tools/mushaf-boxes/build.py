#!/usr/bin/env python3
"""Build exact per-word highlight boxes for the Madinah page images the
app shows (sufone/medina-mushaf png-d150, 1240x1754), from the page ink.

Why: the bodoorzahera/Quran-coordinate boxes (and the zonetecde layout)
follow a different print: different line breaks (p6: «وَعَلَّمَ» ends
line 3 in our scan, the dataset starts line 4 with it), sometimes
different page starts (juz 30), and many lines 20-80 px off.

How (pages 3..604):
  * the 15 line slots sit on a fixed grid (centre 269.1 + 89.43*slot px,
    fitted on 8807 lines of all pages; residual p95 7 px = ink noise);
  * surah headers = slots full of the frame's grey fill; basmala = slot
    after a header (not before surah 9);
  * ayah-end medallions are found by their grey fill (211,210,210): they
    cut the page's word sequence into ayah chunks (hard anchors);
  * the word sequence is the Mushaf order (zonetecde/mushaf-layout); the
    page's first/last ayah is searched near the layout's page break so the
    medallion and header counts match the scan;
  * inside a chunk, black-ink column runs (split at thin valleys for
    touching words) are grouped into the known words by dynamic
    programming: width ~ QPC-V1 glyph advance (KFGQPC page font) * scale,
    cuts prefer wide gaps, a word never crosses a line.
Pages 1-2 (circle layout): lines found from the ink rows inside the cream
circle, same grouping.
Output: public/mushaf-boxes/NNN.json = {"v":1,"w":[[s,a,w,x0,y0,x1,y1],...]}
in image px. A page that cannot be matched gets no file (the app falls
back to the old dataset mapping).

Inputs (download first): /tmp/acc/p{n}.png, /tmp/lay/page-NNN.json,
/tmp/qpc/PNNN.woff2. Run: python3 tools/mushaf-boxes/build.py [pages]
"""
import sys, json, math, os
import numpy as np
from PIL import Image
from fontTools.ttLib import TTFont

IMG = '/tmp/acc/p{}.png'; LAY = '/tmp/lay/page-{:03d}.json'; FONT = '/tmp/qpc/P{:03d}.woff2'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'mushaf-boxes')
SLOT_C0, SLOT_DY, HALF, BOX_HALF = 269.1, 89.43, 30, 32


def slot_centre(s): return SLOT_C0 + SLOT_DY * s


def runs(mask):
    d = np.diff(np.concatenate([[0], mask.astype(np.int8), [0]]))
    return list(zip(np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]))


def load_page(p):
    im = np.asarray(Image.open(IMG.format(p)).convert('RGB')).astype(np.int16)
    ink = (im[..., 0] < 110) & (im[..., 1] < 110) & (im[..., 2] < 110)
    grey = (np.abs(im[..., 0] - 211) < 8) & (np.abs(im[..., 1] - 210) < 8) & (np.abs(im[..., 2] - 210) < 8)
    return im, ink, grey


def frame_interior(ink):
    H, W = ink.shape
    cf = ink[300:1450, :].mean(0)
    c = W // 2
    L = max([x for x in range(0, c - 250) if cf[x] > 0.3], default=0) + 4
    R = min([x for x in range(c + 250, W) if cf[x] > 0.3], default=W) - 4
    return L, R


# ---------- global word sequence ----------
_SEQ = None


def is_end_word(text):
    return any('٠' <= ch <= '٩' or ch.isdigit() for ch in text)


def global_seq():
    global _SEQ
    if _SEQ is not None: return _SEQ
    seq = []; page_start = {}
    for p in range(1, 605):
        lay = json.load(open(LAY.format(p)))
        font = TTFont(FONT.format(p)); cmap = font.getBestCmap(); hm = font['hmtx']
        page_start[p] = len(seq)
        for ln in lay['lines']:
            if ln['type'] != 'text': continue
            for w in ln['words']:
                s, a, wi = map(int, w['location'].split(':'))
                glyphs = [c for c in w['qpcV1'] if c != ' ']
                end = is_end_word(w['word'])
                if end and len(glyphs) > 1: glyphs = glyphs[:-1]  # drop the verse-number glyph
                adv = sum(hm[cmap[ord(c)]][0] for c in glyphs if ord(c) in cmap) or 2000
                seq.append(dict(s=s, a=a, w=wi, adv=adv, end=end))
    page_start[605] = len(seq)
    _SEQ = (seq, page_start)
    return _SEQ


# ---------- per line tokens ----------
def line_tokens(ink, grey, cy, L, R, half=HALF, row_span=None):
    a, b = int(cy - half), int(cy + half)
    band = ink[a:b, L:R]
    gcol = grey[a:b, L:R].sum(0)
    if row_span is not None:  # pages 1-2: per-line horizontal limits
        lo, hi = row_span
        band = band.copy(); band[:, :max(0, lo - L)] = False; band[:, max(0, hi - L):] = False
    meds = []
    for s, e in runs(gcol > 3):
        if e - s >= 18 and gcol[s:e].sum() > 300:
            meds.append((max(0, s - 5), min(R - L, e + 5)))
    cols = band.sum(0).astype(np.int32)
    for s, e in meds: cols[s:e] = 0
    units = [(s, e) for s, e in runs(cols > 0)]
    atoms = []
    for x0, x1 in units:
        c = cols[x0:x1]
        cuts = [i for i in range(3, len(c) - 3) if c[i] <= 4 and c[i] <= c[i - 1] and c[i] <= c[i + 1]
                and c[i] < max(c[max(0, i - 12):i].max(), 1) and c[i] < max(c[i + 1:i + 13].max(), 1)]
        merged = []
        for i in cuts:
            if merged and i - merged[-1] <= 3: continue
            merged.append(i)
        prev = 0
        for i in merged:
            atoms.append((L + x0 + prev, L + x0 + i, -float(c[i])))
            prev = i + 1
        atoms.append((L + x0 + prev, L + x1, 0.0))
    return atoms, [(L + s, L + e) for s, e in meds], int(cols.sum())


# ---------- DP ----------
def segment(ws, units, scale):
    """Group ink atoms (reading order, with line ids) into len(ws) words.
    units: (x0, x1, line, thin) right-to-left per line, lines in order."""
    n = len(units); k = len(ws)
    if k == 0: return [], 0.0
    if n < k: return None, None
    gap = [0.0] * n; brk = [False] * n
    for i in range(n):
        if i == 0 or units[i][2] != units[i - 1][2]: brk[i] = True; gap[i] = 99
        else:
            gap[i] = units[i - 1][0] - units[i][1]
            if gap[i] <= 1 and units[i][3] < 0: gap[i] = units[i][3] * 0.5

    def gcost(g):
        if g >= 99: return 0.0
        return max(0.0, (9.0 - g) / 9.0) * 1.2
    INF = 1e18
    dp = np.full((k + 1, n + 1), INF); bk = np.zeros((k + 1, n + 1), dtype=np.int32)
    dp[0][0] = 0
    for j in range(1, k + 1):
        P = ws[j - 1]['adv'] * scale
        lo_i, hi_i = j, n - (k - j)
        for i in range(lo_i, hi_i + 1):
            best = INF; arg = -1
            for st in range(i - 1, j - 2, -1):
                if st < i - 1 and brk[st + 1]: break
                prev = dp[j - 1][st]
                if prev >= INF: continue
                Wd = units[st][1] - units[i - 1][0]
                c = prev + 2.0 * math.log(max(Wd, 3) / P) ** 2
                if st > 0: c += gcost(gap[st])
                if c < best: best = c; arg = st
            dp[j][i] = best; bk[j][i] = arg
    if dp[k][n] >= INF: return None, None
    res = []; i = n
    for j in range(k, 0, -1):
        st = bk[j][i]
        res.append((ws[j - 1], st, i - 1))
        i = st
    return res[::-1], float(dp[k][n])


def assign(words, slots):
    """slots: list of (line_y, atoms, meds) in reading order. Returns boxes or error."""
    stream = []  # ('u', x0, x1, li, thin) / ('m',)
    for li, (yc, atoms, meds) in enumerate(slots):
        toks = [('u', x0, x1, li, th) for x0, x1, th in atoms] + [('m', x0, x1, li, 0) for x0, x1 in meds]
        toks.sort(key=lambda t: -t[2])
        stream += toks
    n_med = sum(1 for t in stream if t[0] == 'm')
    n_end = sum(1 for w in words if w['end'])
    if n_med != n_end: return None, f'medallions {n_med} != ayah ends {n_end}', None
    wchunks = []; cur = []
    for w in words:
        cur.append(w)
        if w['end']: wchunks.append(cur); cur = []
    wchunks.append(cur)
    tchunks = []; cur = []
    for t in stream:
        if t[0] == 'm': tchunks.append(cur); cur = []
        else: cur.append((t[1], t[2], t[3], t[4]))
    tchunks.append(cur)
    tot_ink = sum(u[1] - u[0] for c in tchunks for u in c)
    tot_adv = sum(w['adv'] for w in words)
    scale = tot_ink / max(1, tot_adv)
    out = []; cost = 0.0
    for ws, us in zip(wchunks, tchunks):
        if not ws and not us: continue
        if not ws or not us: return None, 'empty chunk', None
        res, c = segment(ws, us, scale)
        if res is None: return None, 'segment failed', None
        cost += c
        for w, st, en in res:
            li = us[st][2]
            yc = slots[li][0]
            out.append([w['s'], w['a'], w['w'], int(us[en][0]), int(round(yc - BOX_HALF)), int(us[st][1]), int(round(yc + BOX_HALF))])
    return out, None, cost


def build_page(p):
    if p <= 2: return build_title_page(p)
    seq, pstart = global_seq()
    im, ink, grey = load_page(p)
    L, R = frame_interior(ink)
    slot_data = []
    headers = []
    for s in range(15):
        c = slot_centre(s); a, b = int(c - HALF), int(c + HALF)
        if grey[a:b, L:R].sum() > 12000: headers.append(s); slot_data.append(None); continue
        atoms, meds, inksum = line_tokens(ink, grey, c, L, R)
        slot_data.append((c, atoms, meds, inksum))
    # a header on the last slot (its surah starts on the next page) owns no
    # words here
    while headers and headers[-1] >= 14: headers.pop()
    # candidate starts/ends around the layout page break (ayah boundaries)
    st0, en0 = pstart[p], pstart[p + 1]
    def ayah_starts_near(i, rng=8):
        cands = {i}
        j = i; cnt = 0
        while j > 0 and cnt < rng:
            j -= 1
            if seq[j]['w'] == 1: cands.add(j); cnt += 1
        j = i; cnt = 0
        while j < len(seq) - 1 and cnt < rng:
            j += 1
            if seq[j]['w'] == 1: cands.add(j); cnt += 1
        return sorted(cands)
    best = None; errs = []
    # the layout's own page break first; search around it only if the scan
    # disagrees (different medallion / header count)
    pairs = [(st0, en0)] + ([] if os.environ.get('FORCE_LAYOUT_BREAK') else [(a, b) for a in ayah_starts_near(st0) for b in ayah_starts_near(en0) if (a, b) != (st0, en0)])
    if os.environ.get('CHAIN_ST'):  # start fixed (= word after the previous page's last box), end searched
        cs = int(os.environ['CHAIN_ST'])
        pairs = [(cs, e) for e in range(max(cs + 1, en0 - 70), min(len(seq), en0 + 70))]
    for pi, (st, en) in enumerate(pairs):
        if pi > 0 and best is not None and best[2] == st0 and best[3] == en0 and not os.environ.get('CHAIN_ST'): break
        if True:
            if en <= st: continue
            words = seq[st:en]
            # surah starts inside the page
            ss = [i for i, w in enumerate(words) if w['a'] == 1 and w['w'] == 1]
            nh = len(headers)
            if len(ss) < nh or len(ss) > nh + 1: continue
            if len(ss) == nh + 1 and ss[0] != 0: continue
            if not seq_headers_ok(words, ss, headers): continue
            bas = set()
            # last nh surah starts have their header on this page
            for h, si in zip(headers, ss[len(ss) - nh:]):
                if words[si]['s'] != 9: bas.add(h + 1)
            if len(ss) == nh + 1 and words[0]['s'] not in (1, 9):
                bas.add(0)
            slots = [(d[0], d[1], d[2]) for s, d in enumerate(slot_data) if d is not None and s not in bas and d[3] > 200]
            out, err, cost = assign(words, slots)
            if err: errs.append(err); continue
            # penalise moving the page break: prefer the layout's own break
            cost += 0.5 * ((st != st0) + (en != en0))
            if best is None or cost < best[1]: best = (out, cost, st, en)
    if best is None: return None, 'no match: ' + (errs[0] if errs else 'header/surah mismatch')
    return best[0], None


def seq_headers_ok(words, ss, headers):
    # headers must appear in order before the text lines of their surah; a
    # cheap check: the number of headers is <= surah starts (done by caller)
    return True


def build_title_page(p):
    """Pages 1-2: text inside the cream circle; lines from the ink rows."""
    seq, pstart = global_seq()
    im, ink, grey = load_page(p)
    cream = (im[..., 0] >= 250) & (im[..., 1] >= 250) & (np.abs(im[..., 2] - 229) <= 4)
    H, W = ink.shape
    # the cream circle: vertical extent from the cream rows, centre column
    # from the widest row (a stray cream strip at the image edge is ignored)
    ys_, xs_ = np.nonzero(cream[400:1400, 60:W - 60]); ys_ = ys_ + 400; xs_ = xs_ + 60
    y0c, y1c = np.percentile(ys_, [0.1, 99.9])
    cy = (y0c + y1c) / 2; r = (y1c - y0c) / 2
    row = np.nonzero(cream[int(cy), 60:W - 60])[0] + 60
    cx = (row.min() + row.max()) / 2
    spans = {}
    for y in range(int(cy - r) + 1, int(cy + r)):
        dx = math.sqrt(max(0.0, r * r - (y - cy) ** 2)) - 18
        if dx > 20: spans[y] = (int(cx - dx), int(cx + dx))
    ys = sorted(spans)
    top, bot = ys[0], ys[-1]
    inner = np.zeros_like(ink)
    for y, (lo, hi) in spans.items():
        inner[y, lo:hi] = ink[y, lo:hi]
    prof = inner.sum(1).astype(float)
    sp = np.convolve(prof, np.ones(21) / 21, 'same')
    pk = [i for i in range(top + 30, bot - 30) if sp[i] == sp[max(0, i - 35):i + 36].max() and sp[i] > sp.max() * 0.25]
    pk2 = []
    for i in pk:
        if pk2 and i - pk2[-1] < 50: continue
        pk2.append(i)
    lines = []
    for y in pk2:
        a, b = int(y - 26), int(y + 26)
        w = prof[a:b]
        yc = a + float((w * np.arange(len(w))).sum() / max(1, w.sum()))
        lo = min(spans.get(int(yc - 26), (W, 0))[0], spans.get(int(yc + 26), (W, 0))[0], spans.get(int(yc), (W, 0))[0])
        hi = max(spans.get(int(yc - 26), (W, 0))[1], spans.get(int(yc + 26), (W, 0))[1], spans.get(int(yc), (W, 0))[1])
        atoms, meds, inksum = line_tokens(inner, grey, yc, 0, W, half=26)
        atoms = [t for t in atoms if t[0] >= lo - 2 and t[1] <= hi + 2]
        meds = [m for m in meds if m[0] >= lo - 30 and m[1] <= hi + 30]
        lines.append((yc, atoms, meds))
    words = seq[pstart[p]:pstart[p + 1]]
    if p == 2 and lines: lines = lines[1:]  # the basmala line of al-Baqarah sits inside the circle
    out, err, cost = assign(words, lines)
    if err: return None, f'title page: {err} ({len(lines)} lines)'
    # title-page lines are tighter: box = line centre +- 27 px
    for b in out:
        yc = (b[4] + b[6]) / 2
        b[4] = int(round(yc - 27)); b[6] = int(round(yc + 27))
    return out, None


def _one(p):
    try:
        return p, build_page(p)
    except Exception as e:  # keep going; report
        return p, (None, f'error {e!r}')


if __name__ == '__main__':
    from multiprocessing import Pool
    pages = [int(a) for a in sys.argv[1:]] or list(range(1, 605))
    os.makedirs(OUT, exist_ok=True)
    fails = []
    global_seq()
    with Pool(2) as pool:
        results = pool.map(_one, pages)
    for p, (out, err) in results:
        if err:
            fails.append((p, err)); print('FAIL', p, err, flush=True)
            path = os.path.join(OUT, f'{p:03d}.json')
            if os.path.exists(path): os.remove(path)
            continue
        with open(os.path.join(OUT, f'{p:03d}.json'), 'w') as f:
            json.dump({'v': 1, 'w': out}, f, separators=(',', ':'))
    print('done', len(pages) - len(fails), 'fails', len(fails), [f[0] for f in fails])
