#!/usr/bin/env python3
"""Muno459/fastconformer-quran (CTC ONNX) on the manifest. usage: fastconf_eval.py MANIFEST OUT_PREFIX"""
import sys, os, json, unicodedata, traceback
import numpy as np, soundfile as sf, onnxruntime as ort, sentencepiece as spm, torch, librosa
from huggingface_hub import hf_hub_download as dl
t = os.environ['HF_TOKEN']; R = 'Muno459/fastconformer-quran'
sess = ort.InferenceSession(dl(R, 'onnx/model.onnx', token=t), providers=['CPUExecutionProvider'])
sp = spm.SentencePieceProcessor(model_file=dl(R, 'tokenizer.model', token=t))
print([(i.name, i.shape) for i in sess.get_inputs()], [(o.name, o.shape) for o in sess.get_outputs()], sp.get_piece_size(), flush=True)
FB = torch.tensor(librosa.filters.mel(sr=16000, n_fft=512, n_mels=80, fmin=0, fmax=8000, norm='slaney', htk=False), dtype=torch.float32)
WIN = torch.hann_window(400, periodic=False)
def feats(w):
    x = torch.tensor(w, dtype=torch.float32)
    x = torch.cat([x[:1], x[1:] - 0.97 * x[:-1]])
    S = torch.stft(x, 512, 160, 400, WIN, center=True, pad_mode='constant', return_complex=True)
    p = S.abs().pow(2)
    m = torch.log(FB @ p + 2 ** -24)
    m = (m - m.mean(1, keepdim=True)) / (m.std(1, keepdim=True) + 1e-5)
    return m.numpy()
def hear(w):
    f = feats(w)[None].astype(np.float32)
    lp = sess.run(None, {'audio_signal': f, 'length': np.array([f.shape[2]], np.int64)})[0][0]
    ids = lp.argmax(-1); blank = lp.shape[1] - 1; out = []; prev = -1
    for i in ids:
        if i != prev and i != blank: out.append(int(i))
        prev = i
    return sp.decode(out)
def sk(w, strict=False):
    w = unicodedata.normalize('NFKD', w)
    if strict: w = ''.join(c for c in w if not unicodedata.category(c).startswith('M') or c in 'ًٌٍَُِّْ')
    else: w = ''.join(c for c in w if not unicodedata.category(c).startswith('M'))
    for a in 'أإآٱ': w = w.replace(a, 'ا')
    w = w.replace('ى', 'ي').replace('ة', 'ه').replace('ؤ', 'و').replace('ئ', 'ي').replace('ء', '').replace('ـ', '').replace('ٰ', '')
    return w.replace('ا', '')
def lcs_ok(ref, hv):
    n, m = len(ref), len(hv); d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for k in range(m - 1, -1, -1):
            d[i][k] = d[i + 1][k + 1] + 1 if ref[i] == hv[k] else max(d[i + 1][k], d[i][k + 1])
    ok = [False] * n; i = k = 0
    while i < n and k < m:
        if ref[i] == hv[k]: ok[i] = True; i += 1; k += 1
        elif d[i + 1][k] >= d[i][k + 1]: i += 1
        else: k += 1
    return ok
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
o = open(sys.argv[2] + '.jsonl', 'w', encoding='utf8'); shown = 0
for r in rows:
    try:
        w, sr = sf.read(r['f'], dtype='float32')
        if w.ndim > 1: w = w.mean(1)
        if sr != 16000: n = int(len(w) * 16000 / sr); w = np.interp(np.linspace(0, len(w) - 1, n), np.arange(len(w)), w).astype(np.float32)
        txt = hear(w); words = [x for x in r['text'].split() if sk(x)]
        ref = [sk(x) for x in words]; hv = [sk(x) for x in txt.split() if sk(x)]
        ok = lcs_ok(ref, hv)
        if shown < 3: shown += 1; print('HEARD', txt, '\nREF  ', r['text'], flush=True)
        errIdx = [{'i': ref.index(sk(ew)), 'types': ty, 'w': sk(ew)} for ew, ty in (r.get('errors') or {}).items() if sk(ew) in ref]
        o.write(json.dumps({'f': r['f'], 'src': r['src'], 'n': len(words), 'ok': ok, 'wrong': 0, 'errIdx': errIdx}, ensure_ascii=False) + '\n')
    except Exception as e:
        print('ERR', r['f'][-30:], repr(e)[:200], flush=True)
        if shown < 6: shown += 3; traceback.print_exc()
