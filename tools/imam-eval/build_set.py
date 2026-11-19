#!/usr/bin/env python3
"""Build the follow-the-imam test set.  usage: build_set.py WORK [PRIVATE_MANIFEST|-] [EXTRA.json]
- reciters: consecutive ayat from everyayah.com joined into one "imam" clip
  (mid-surah starts, repeated-ayah surahs), plus mosque-like noisy copies;
- the owner's own recordings (PRIVATE_MANIFEST = ear-private-tests/manifest.jsonl,
  text only) -> mapped to (surah, ayah) runs in spoken order.
Writes WORK/manifest.jsonl rows {id, f, src, segs: [[surah, a1, a2], ...]}.
Audio stays in WORK only (never committed)."""
import sys, os, json, subprocess, concurrent.futures as cf
work = sys.argv[1]; priv = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != '-' else None
# EXTRA (3rd arg): JSON list [{id, f, segs}] of clips named by ear (segs [] = not Quran:
# speech, adhan → a negative test: the follower must never lock).
extra = json.load(open(sys.argv[3], encoding='utf8')) if len(sys.argv) > 3 else []
here = os.path.dirname(os.path.abspath(__file__)); root = os.path.abspath(f'{here}/../..')
os.makedirs(f'{work}/ayah', exist_ok=True); os.makedirs(f'{work}/wav', exist_ok=True)
PASSAGES = [
    ('Alafasy_128kbps', 2, 255, 257), ('Husary_128kbps', 67, 1, 10), ('Minshawy_Murattal_128kbps', 18, 1, 8),
    ('Abdurrahmaan_As-Sudais_192kbps', 36, 1, 12), ('Saood_ash-Shuraym_128kbps', 55, 1, 16),
    ('MaherAlMuaiqly128kbps', 2, 284, 286), ('Abdul_Basit_Murattal_192kbps', 78, 1, 16),
    ('Ghamadi_40kbps', 3, 190, 194), ('Yasser_Ad-Dussary_128kbps', 59, 18, 24), ('Hudhaify_128kbps', 77, 1, 20),
    ('Abdullaah_3awwaad_Al-Juhaynee_128kbps', 25, 63, 70), ('Abu_Bakr_Ash-Shaatree_128kbps', 87, 1, 19),
    ('Abdul_Basit_Mujawwad_128kbps', 93, 1, 11), ('Abdullah_Basfar_192kbps', 23, 1, 11),
    # mutashabihat openings: 28:2 = 26:2 word for word; 40:2 ≈ 45:2/46:2; 46:1-2 = 45:1-2
    ('Husary_128kbps', 28, 1, 6), ('Alafasy_128kbps', 40, 1, 5), ('Minshawy_Murattal_128kbps', 46, 1, 5),
]
NOISY = {0: 'room_noise10', 3: 'room_noise10', 6: 'noise10', 9: 'room_noise10'}
def dl(job):
    folder, s, a = job; n = f'{s:03d}{a:03d}'; wav = f'{work}/ayah/{folder}_{n}.wav'
    if not os.path.exists(wav):
        mp3 = wav[:-4] + '.mp3'
        r = subprocess.run(['curl', '-fsS', '--retry', '3', '-m', '60', '-o', mp3, f'https://everyayah.com/data/{folder}/{n}.mp3'], capture_output=True)
        if r.returncode: return None
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', mp3, '-ac', '1', '-ar', '16000', wav], check=False); os.remove(mp3)
    return wav if os.path.exists(wav) else None
rows = []
jobs = [(f, s, a) for f, s, a1, a2 in PASSAGES for a in range(a1, a2 + 1)]
with cf.ThreadPoolExecutor(8) as ex: got = dict(zip(jobs, ex.map(dl, jobs)))
for k, (folder, s, a1, a2) in enumerate(PASSAGES):
    parts = [got[(folder, s, a)] for a in range(a1, a2 + 1)]
    if not all(parts): print('skip', folder, s, flush=True); continue
    cid = f'r{k:02d}_{s}_{a1}-{a2}'; out = f'{work}/wav/{cid}.wav'
    lst = f'{work}/wav/{cid}.txt'; open(lst, 'w').write(''.join(f"file '{p}'\n" for p in parts))
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', out], check=True)
    rows.append({'id': cid, 'f': out, 'src': folder, 'segs': [[s, a1, a2]]})
    if k in NOISY:
        subprocess.run(['python3', f'{root}/tools/ear-eval/augment.py', out, f'{work}/wav'], check=True, capture_output=True)
        p = f'{work}/wav/{cid}__{NOISY[k]}.wav'
        if os.path.exists(p): rows.append({'id': f'{cid}~{NOISY[k]}', 'f': p, 'src': folder + '+' + NOISY[k], 'segs': [[s, a1, a2]]})
# Owner's recordings: map the labelled text to ayah runs (spoken order).
if priv:
    sys.path.insert(0, here)
    verses = json.load(open(f'{root}/tools/ear-eval/verses.json', encoding='utf8'))
    def toks(t): return t.split()
    index = {}
    for s, a, t in verses: index.setdefault(' '.join(toks(t)), []).append((s, a))
    base = os.path.dirname(priv)
    for l in open(priv, encoding='utf8'):
        j = json.loads(l)
        if j.get('errors'): continue  # short clips with planted mistakes: not imam-like
        w = toks(j['text']); i = 0; segs = []
        while i < len(w):
            hit = None
            for L in range(min(len(w) - i, 140), 0, -1):
                c = index.get(' '.join(w[i:i + L]))
                if c: hit = (L, c[0]); break
            if not hit: i += 1; continue
            L, (s, a) = hit
            if segs and segs[-1][0] == s and segs[-1][2] == a - 1: segs[-1][2] = a
            else: segs.append([s, a, a])
            i += L
        rows.append({'id': 'own_' + os.path.basename(j['f'])[:-4], 'f': os.path.join(base, j['f']), 'src': 'owner', 'segs': segs})
for e in extra:
    f = e['f']
    if not f.endswith('.wav'):
        w = f'{work}/wav/{e["id"]}.wav'; subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', f, '-ac', '1', '-ar', '16000', w], check=True); f = w
    rows.append({'id': e['id'], 'f': f, 'src': e.get('src', 'owner'), 'segs': e['segs']})
open(f'{work}/manifest.jsonl', 'w', encoding='utf8').write(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows))
print(len(rows), 'clips')
