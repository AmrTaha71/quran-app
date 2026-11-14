#!/usr/bin/env python3
"""Fetch real-error data. usage: real_fetch.py OUT_DIR  -> OUT/manifest.jsonl + wavs
rows: {f, text, src, errors:{word:[types]}, riwayah}"""
import sys, os, json, io, glob
import numpy as np, soundfile as sf
from huggingface_hub import snapshot_download, hf_hub_download
out = sys.argv[1]; os.makedirs(out + '/wav', exist_ok=True)
man = open(out + '/manifest.jsonl', 'w', encoding='utf8')
def emit(f, text, src, errors, riw='Hafs'):
    man.write(json.dumps({'f': f, 'text': text, 'src': src, 'errors': errors, 'riwayah': riw}, ensure_ascii=False) + '\n')
# 1) sobolev210: human recitations reviewed word by word
mode = os.environ.get('SRC', 'all')
if mode in ('all', 'sobolev'):
    p = snapshot_download('sobolev210/quran-recitation-errors', repo_type='dataset')
    n = 0
    for l in open(p + '/metadata.jsonl', encoding='utf8'):
        if not l.strip(): continue
        j = json.loads(l)
        if j.get('riwayah') != 'Hafs': continue
        f = os.path.join(p, j['file_name'])
        if not os.path.exists(f): continue
        emit(f, j['text'], 'sobolev', j.get('errors') or {}); n += 1
    print('sobolev hafs clips', n, flush=True)
# 2) Quran-Lab: correct recitation by professionals (false-mark test)
if mode in ('all', 'qlab'):
    import pyarrow.parquet as pq
    lim = int(os.environ.get('QL_LIMIT', '500')); n = 0
    for cfg in ['correct_t1p_test', 'correct_t1p_dev', 'correct_t1']:
        fp = hf_hub_download('Quran-Lab/quran-tajweed-benchmark', f'data/{cfg}/test-00000-of-00001.parquet', repo_type='dataset')
        t = pq.read_table(fp, columns=['id', 'audio', 'uthmani', 'duration']).to_pylist()
        for r in t:
            if n >= lim: break
            if r['duration'] > 25: continue
            w, sr = sf.read(io.BytesIO(r['audio']['bytes']), dtype='float32')
            if w.ndim > 1: w = w.mean(1)
            f = f"{out}/wav/ql_{r['id']}.wav"; sf.write(f, w, sr)
            emit(f, r['uthmani'], 'qlab_correct', {}); n += 1
    print('qlab clips', n, flush=True)
man.close()
