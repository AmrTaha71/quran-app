#!/usr/bin/env python3
"""Forced-alignment scoring (the app knows the ayah, so score the audio against it).
usage: gop.py MODEL_DIR LP_DIR MANIFEST OUT.json
For every clip: tokenise the reference phoneme script of its ayah, CTC-Viterbi align it
to the saved log-probs, score every word, then sweep thresholds against the labelled
errors (sobolev) and the correct recitations (qlab) to compare with the greedy judge."""
import hashlib, sys, os, re, json, numpy as np
md, lpd, man, out = sys.argv[1:5]
toks = json.load(open(f'{md}/tokens.json', encoding='utf8'))
inv = {v: int(k) for k, v in toks.items() if v != '<blank>'}
BLANK = 250
maxlen = max(len(v) for v in inv)
ref = json.load(open(f'{md}/quran_text2phoneme.json', encoding='utf8'))
def norm(s):
    s = re.sub(r'[ً-ٰٟۖ-ۭـ࣓-ࣿ]', '', s)
    s = re.sub('[أإآٱ]', 'ا', s).replace('ى', 'ي').replace('ة', 'ه')
    return re.sub(r'\s+', ' ', s).strip()
byk = {}
for k, v in ref.items(): byk.setdefault(norm(k), v)
def tokenise(w):
    ids = []; i = 0
    while i < len(w):
        for L in range(min(maxlen, len(w) - i), 0, -1):
            if w[i:i + L] in inv: ids.append(inv[w[i:i + L]]); i += L; break
        else: i += 1
    return ids
def viterbi(lp, seq):
    T, S = lp.shape[0], 2 * len(seq) + 1
    ext = [BLANK] * S
    for i, t in enumerate(seq): ext[2 * i + 1] = t
    NEG = -1e9
    dp = np.full((T, S), NEG, dtype=np.float32); bp = np.zeros((T, S), dtype=np.int8)
    dp[0, 0] = lp[0, BLANK]
    if S > 1: dp[0, 1] = lp[0, ext[1]]
    for t in range(1, T):
        for s in range(S):
            best, b = dp[t - 1, s], 0
            if s >= 1 and dp[t - 1, s - 1] > best: best, b = dp[t - 1, s - 1], 1
            if s >= 2 and ext[s] != BLANK and ext[s] != ext[s - 2] and dp[t - 1, s - 2] > best: best, b = dp[t - 1, s - 2], 2
            dp[t, s] = best + lp[t, ext[s]]; bp[t, s] = b
    s = S - 1 if S == 1 or dp[T - 1, S - 1] >= dp[T - 1, S - 2] else S - 2
    path = [0] * T
    for t in range(T - 1, -1, -1):
        path[t] = s; s -= bp[t, s]
    return path, ext
rows = [json.loads(l) for l in open(man, encoding='utf8')]
res = []
for r in rows:
    p = os.path.join(lpd, hashlib.md5(r['f'].encode()).hexdigest() + '.npy')
    if not os.path.exists(p): continue
    key = norm(r['text']); ph = byk.get(key)
    if ph is None: continue
    words = ph.split(' ')
    tw = r['text'].split()
    if len(words) != len(tw): continue
    lp = np.load(p).astype(np.float32)
    lp = lp - np.logaddexp.reduce(lp, axis=1, keepdims=True)
    seqs = [tokenise(w) for w in words]
    flat = [t for s in seqs for t in s]
    if len(flat) * 1 > lp.shape[0]: continue
    path, ext = viterbi(lp, flat)
    # per word: best target log-prob of each token over the frames it owns, minus best competitor
    scores = []; pos = 0
    own = {}
    for t, s in enumerate(path):
        if s % 2 == 1: own.setdefault((s - 1) // 2, []).append(t)
    for si, s in enumerate(seqs):
        vals = []
        for k in range(pos, pos + len(s)):
            fr = own.get(k, [])
            if not fr: vals.append(-20.0); continue
            tgt = max(lp[t, flat[k]] for t in fr)
            vals.append(float(tgt))
        pos += len(s)
        scores.append({'mean': float(np.mean(vals)) if vals else -20.0, 'min': float(np.min(vals)) if vals else -20.0})
    if r['src']=='sobolev' and len([1 for q in res if q['src']=='sobolev'])<8:
        g=[];prev=-1
        for t in lp.argmax(1):
            if t!=prev and t!=BLANK: g.append(toks[str(int(t))])
            prev=t
        print('DBG',os.path.basename(r['f']),'T',lp.shape[0],'ntok',len(flat),'maxlp',round(float(lp.max(1).mean()),2),'| ref:',ph,'| heard:',''.join(g),'| word means',[round(x['mean'],1) for x in scores],flush=True)
    res.append({'src': r['src'], 'n': len(words), 'errors': r.get('errors') or {}, 'scores': scores, 'words': tw})
json.dump(res, open(out, 'w', encoding='utf8'), ensure_ascii=False)
print('clips scored', len(res), 'of', len(rows))
