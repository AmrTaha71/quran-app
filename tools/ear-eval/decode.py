#!/usr/bin/env python3
"""Decode wavs like the app worker does: per-chunk parts [{s,t}] (t in seconds).
usage: decode.py MODEL_DIR OUT.jsonl wav [wav...]   (one JSON line per wav: {"f":..,"chunks":[[{s,t}..],..]})"""
import sys, json, numpy as np, soundfile as sf, onnxruntime as ort, kaldi_native_fbank as knf
md=sys.argv[1]; out=sys.argv[2]; files=sys.argv[3:]
toks=json.load(open(f'{md}/tokens.json',encoding='utf8'))
sess=ort.InferenceSession(f'{md}/zipformer_p_arabic_v3.int8.onnx',providers=['CPUExecutionProvider'])
ins=sess.get_inputs(); names=[i.name for i in ins]
T,SHIFT,BLANK=61,48,250
def fbank(w):
    o=knf.FbankOptions(); o.frame_opts.dither=0; o.frame_opts.snip_edges=False; o.frame_opts.samp_freq=16000; o.mel_opts.num_bins=80; o.mel_opts.high_freq=-400
    f=knf.OnlineFbank(o); f.accept_waveform(16000,w.tolist()); f.input_finished()
    return np.stack([f.get_frame(i) for i in range(f.num_frames_ready)]).astype(np.float32)
def run(path):
    w,sr=sf.read(path,dtype='float32')
    if w.ndim>1: w=w.mean(1)
    if sr!=16000:
        n=int(len(w)*16000/sr); w=np.interp(np.linspace(0,len(w)-1,n),np.arange(len(w)),w).astype(np.float32)
    feats=fbank(w)
    st={i.name:np.zeros([1 if isinstance(d,str) else d for d in i.shape],dtype=np.int64 if 'int64' in i.type else np.float32) for i in ins[1:]}
    chunks=[];pos=0;prev=-1;ci=0
    while pos+T<=len(feats)+SHIFT and pos<len(feats):
        x=feats[pos:pos+T]
        if len(x)<T: x=np.concatenate([x,np.full((T-len(x),80),np.log(1e-10),dtype=np.float32)])
        o=sess.run(None,{names[0]:x[None],**st})
        for n,v in zip(names[1:],o[1:]): st[n]=v
        lp=o[0][0]; nf=lp.shape[0]; ids=lp.argmax(-1); parts=[]
        for t,b in enumerate(ids):
            if b!=prev and b!=BLANK: parts.append({'s':toks[str(int(b))],'t':(ci*SHIFT+((t+0.5)/nf)*SHIFT)*0.01})
            prev=b
        chunks.append(parts); ci+=1; pos+=SHIFT
    return chunks
with open(out,'a',encoding='utf8') as fo:
    for p in files:
        fo.write(json.dumps({'f':p,'chunks':run(p)},ensure_ascii=False)+'\n'); fo.flush()
