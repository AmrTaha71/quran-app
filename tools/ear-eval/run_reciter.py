#!/usr/bin/env python3
"""Per-reciter pipeline: download everyayah audio -> 16k wav -> augment -> decode -> judge (real app code).
usage: run_reciter.py FOLDER WORKDIR   (env APP_ROOT = repo root, JUDGE=path to judge.mjs)
Audio stays in WORKDIR only (never committed). Writes WORKDIR/result.json (small table)."""
import sys, os, json, subprocess, concurrent.futures as cf
folder, work = sys.argv[1], sys.argv[2]
root = os.environ.get('APP_ROOT', '.'); here = f'{root}/tools/ear-eval'
os.makedirs(f'{work}/mp3', exist_ok=True); os.makedirs(f'{work}/wav', exist_ok=True); os.makedirs(f'{work}/aug', exist_ok=True)
SETS = [(1,1,7),(2,1,10),(18,1,10),(36,1,12),(55,1,10),(67,1,10),(68,1,12),(78,1,10),(93,1,11),(94,1,8),(103,1,3),(105,1,5),(106,1,4),(107,1,7),(108,1,3),(112,1,4),(113,1,5),(114,1,6)]
verses = [(s,a) for s,x,y in SETS for a in range(x,y+1)]
aug_set = verses[::7]  # ~12 verses get every augmentation
def dl(v):
    s,a = v; n = f'{s:03d}{a:03d}'; mp3 = f'{work}/mp3/{n}.mp3'; wav = f'{work}/wav/{n}.wav'
    if not os.path.exists(wav):
        r = subprocess.run(['curl','-fsS','--retry','3','-m','60','-o',mp3,f'https://everyayah.com/data/{folder}/{n}.mp3'],capture_output=True)
        if r.returncode: return None
        subprocess.run(['ffmpeg','-v','error','-y','-i',mp3,'-ac','1','-ar','16000',wav],check=False)
        os.remove(mp3)
    return (v, wav) if os.path.exists(wav) else None
with cf.ThreadPoolExecutor(8) as ex: got = [g for g in ex.map(dl, verses) if g]
print(folder, 'downloaded', len(got), '/', len(verses), flush=True)
man = []; files = []; meta = {}
for (s,a), wav in got:
    files.append(wav); man.append({'f': wav, 'surah': s, 'a1': a, 'a2': a, 'nmut': 12}); meta[wav] = 'clean'
    if (s,a) in aug_set:
        subprocess.run(['python3', f'{here}/augment.py', wav, f'{work}/aug'], check=True, capture_output=True)
        stem = os.path.basename(wav)[:-4]
        for v in ['quiet','soft','loud','noise20','noise10','noise5','room','room_noise10','quiet_noise10']:
            p = f'{work}/aug/{stem}__{v}.wav'
            if os.path.exists(p): files.append(p); man.append({'f': p, 'surah': s, 'a1': a, 'a2': a, 'nmut': 6}); meta[p] = v
dec = f'{work}/dec.jsonl'; open(dec,'w').close()
subprocess.run(['python3', f'{here}/decode.py', f'{root}/public/models/quranlab', dec] + files, check=True)
mf = f'{work}/man.jsonl'; open(mf,'w').write('\n'.join(json.dumps(m, ensure_ascii=False) for m in man)+'\n')
res = f'{work}/judge.jsonl'; open(res,'w').close()
subprocess.run(['node', os.environ.get('JUDGE','/tmp/judge.mjs'), dec, mf, res], check=True, env={**os.environ,'APP_ROOT':root})
agg = {}; accs = []
for l in open(res):
    r = json.loads(l); v = meta[r['f']]; g = agg.setdefault(v, {'files':0,'words':0,'ok':0,'wrongTok':0,'mut':{}})
    if r['mut'] is None: g['files']+=1; g['words']+=r['n']; g['ok']+=r['okN']; g['wrongTok']+=r['wrong']
    else:
        t = g['mut'].setdefault(r['mut'].split('#')[0], [0,0]); t[0]+=1; t[1]+= 0 if r['mutAccepted'] else 1  # [tested, caught]
        if r['mutAccepted'] and 'acc' in r and v == 'clean': accs.append({'m': r['mut'], **r['acc']})
decmap = {}
for l in open(dec):
    j = json.loads(l); decmap[j['f']] = j['chunks']
det = []
for l in open(res):
    x = json.loads(l)
    if x['mut'] is None and meta[x['f']]=='clean' and (x.get('miss') or x.get('wt')): det.append({'s': x['s'], 'miss': x['miss'], 'wt': x['wt'], **({'chunks': decmap[x['f']]} if len([d for d in det if 'chunks' in d]) < 8 and x['miss'] else {})})
json.dump({'reciter': folder, 'acc': accs[:400], 'detail': det, 'variants': agg}, open(f'{work}/result.json','w'), ensure_ascii=False)
print('done', folder)
