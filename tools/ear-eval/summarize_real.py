#!/usr/bin/env python3
import sys, json, collections
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
S = collections.defaultdict(lambda: collections.Counter())
byt = collections.defaultdict(lambda: [0, 0])
bad = []
for r in rows:
    s = r['src']; c = S[s]; c['clips'] += 1
    c['words'] += r['n']; c['ok'] += sum(r['ok']); c['wrong'] += r['wrong']
    err_i = {e['i'] for e in r['errIdx']}
    if not r['errIdx']:
        c['clean_clips'] += 1; c['clean_words'] += r['n']; c['clean_notok'] += r['n'] - sum(r['ok']); c['clean_wrong'] += r['wrong']
        if r['wrong'] or sum(r['ok']) < r['n']: c['clean_clips_flagged'] += 1
    else:
        c['err_clips'] += 1
        c['other_words'] += r['n'] - len(err_i); c['other_notok'] += sum(1 for k in range(r['n']) if k not in err_i and not r['ok'][k])
        for e in r['errIdx']:
            caught = not r['ok'][e['i']]
            for t in e['types']: byt[t][0] += 1; byt[t][1] += caught
            c['err_words'] += 1; c['err_caught'] += caught
            if not caught: bad.append((r['f'].split('/')[-2:], e))
out = {k: dict(v) for k, v in S.items()}
out['by_type'] = {k: {'n': v[0], 'caught': v[1], 'pct': round(100 * v[1] / v[0], 1)} for k, v in byt.items()}
out['missed_examples'] = bad[:40]
json.dump(out, open(sys.argv[2], 'w'), ensure_ascii=False, indent=1)
print(json.dumps(out, ensure_ascii=False)[:3000])
