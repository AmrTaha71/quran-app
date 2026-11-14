#!/usr/bin/env python3
"""HisnLabs/tajweed-v2 on the same manifest. usage: hisn_eval.py MANIFEST OUT_PREFIX
Writes OUT_PREFIX-<cfg>.jsonl rows compatible with summarize_real.py."""
import sys, os, json, re, unicodedata, inspect
import numpy as np, soundfile as sf
from huggingface_hub import snapshot_download
d = snapshot_download('HisnLabs/tajweed-v2'); sys.path.insert(0, d)
print(os.listdir(d), flush=True)
import inference, imam
print(inspect.getsource(inference)[:2500], flush=True)
print(inspect.signature(imam.listen), inspect.signature(imam.recited), flush=True)
from inference import hear
def norm(w):
    w = unicodedata.normalize('NFKD', w)
    w = ''.join(c for c in w if not unicodedata.category(c).startswith('M') and c not in 'ـٰۖۗۚۛۜ۟۠ۡۢۤۥۦ')
    for a in 'أإآٱ': w = w.replace(a, 'ا')
    return w.replace('ى', 'ي').replace('ة', 'ه').replace('ؤ', 'و').replace('ئ', 'ي').replace('ء', '')
CFG = {'a': (0.3, 0.7), 'b': (0.15, 0.5), 'c': (0.5, 0.9)}
outs = {k: open(f'{sys.argv[2]}-{k}.jsonl', 'w', encoding='utf8') for k in CFG}
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
lim = int(os.environ.get('LIMIT', '0')) or len(rows)
bad = 0
for r in rows[:lim]:
    try:
        w, sr = sf.read(r['f'], dtype='float32')
        if w.ndim > 1: w = w.mean(1)
        if sr != 16000:
            n = int(len(w) * 16000 / sr); w = np.interp(np.linspace(0, len(w) - 1, n), np.arange(len(w)), w).astype(np.float32)
        words = [x for x in r['text'].split() if norm(x)]
        heard, probs, times = hear(w, riwaya='hafs')
        ref = imam.recited(words, heard, riwaya='hafs')
        dn = [norm(x) for x in words]
        errIdx = []
        for ew, types in (r.get('errors') or {}).items():
            nn = norm(ew)
            if nn in dn: errIdx.append({'i': dn.index(nn), 'types': types, 'w': nn})
        for k, (mp, mj) in CFG.items():
            res = imam.listen(ref, heard, heard_probs=probs, heard_times=times, min_prob=mp, min_prob_jali=mj, langs=('en',))
            ok = [bool(x['ok']) for x in res]
            if len(ok) != len(words): ok = (ok + [False] * len(words))[:len(words)]; bad += 1
            outs[k].write(json.dumps({'f': r['f'], 'src': r['src'], 'n': len(words), 'ok': ok, 'wrong': 0, 'errIdx': errIdx}, ensure_ascii=False) + '\n')
    except Exception as e:
        print('ERR', r['f'], repr(e)[:300], flush=True)
print('len-mismatch', bad)
