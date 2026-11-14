#!/usr/bin/env python3
"""usage: gop_eval.py gop.json OUT.json — threshold sweep: false marks on correct words vs errors caught."""
import sys, json, re
res = json.load(open(sys.argv[1], encoding='utf8'))
def norm(s):
    s = re.sub(r'[ً-ٰٟۖ-ۭـ]', '', s)
    s = re.sub('[أإآٱ]', 'ا', s).replace('ى', 'ي').replace('ة', 'ه')
    return s
clean = {'qlab_correct': [], 'sobolev': []}; err = []
for r in res:
    bad = {norm(w) for w in r['errors']}
    for i, w in enumerate(r['words']):
        sc = r['scores'][i]
        if norm(w) in bad: err.append(sc)
        elif r['src'] == 'qlab_correct' or not bad: clean[r['src']].append(sc)
out = {'clips': len(res), 'err_words': len(err), 'clean_pro': len(clean['qlab_correct']), 'clean_amateur': len(clean['sobolev']), 'rows': []}
for key in ('mean', 'min'):
    for tau in [-0.2, -0.4, -0.7, -1.0, -1.5, -2.0, -3.0, -4.0]:
        f = lambda xs: round(100 * sum(1 for x in xs if x[key] < tau) / max(1, len(xs)), 2)
        out['rows'].append({'metric': key, 'tau': tau, 'false_pro_%': f(clean['qlab_correct']), 'false_amateur_%': f(clean['sobolev']), 'caught_%': f(err)})
json.dump(out, open(sys.argv[2], 'w'), indent=1)
for r in out['rows']: print(r)
print({k: out[k] for k in ('clips', 'err_words', 'clean_pro', 'clean_amateur')})
