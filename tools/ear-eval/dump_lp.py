#!/usr/bin/env python3
"""Like decode.py, but keeps the model's per-frame log-probabilities.
usage: dump_lp.py MODEL_DIR OUT_DIR wav [wav...]  -> OUT_DIR/<basename>.npy (float16, frames x 251)"""
import hashlib, sys, os, numpy as np, soundfile as sf, onnxruntime as ort, kaldi_native_fbank as knf
md=sys.argv[1]; out=sys.argv[2]; files=sys.argv[3:]; os.makedirs(out,exist_ok=True)
sess=ort.InferenceSession(f'{md}/zipformer_p_arabic_v3.int8.onnx',providers=['CPUExecutionProvider'])
ins=sess.get_inputs(); names=[i.name for i in ins]
T,SHIFT=61,48
def fbank(w):
    o=knf.FbankOptions(); o.frame_opts.dither=0; o.frame_opts.snip_edges=False; o.frame_opts.samp_freq=16000; o.mel_opts.num_bins=80; o.mel_opts.high_freq=-400
    f=knf.OnlineFbank(o); f.accept_waveform(16000,w.tolist()); f.input_finished()
    return np.stack([f.get_frame(i) for i in range(f.num_frames_ready)]).astype(np.float32)
for path in files:
    w,sr=sf.read(path,dtype='float32')
    if w.ndim>1: w=w.mean(1)
    if sr!=16000:
        n=int(len(w)*16000/sr); w=np.interp(np.linspace(0,len(w)-1,n),np.arange(len(w)),w).astype(np.float32)
    feats=fbank(w)
    st={i.name:np.zeros([1 if isinstance(d,str) else d for d in i.shape],dtype=np.int64 if 'int64' in i.type else np.float32) for i in ins[1:]}
    rows=[];pos=0
    while pos+T<=len(feats)+SHIFT and pos<len(feats):
        x=feats[pos:pos+T]
        if len(x)<T: x=np.concatenate([x,np.full((T-len(x),80),np.log(1e-10),dtype=np.float32)])
        o=sess.run(None,{names[0]:x[None],**st})
        for n,v in zip(names[1:],o[1:]): st[n]=v
        rows.append(o[0][0].astype(np.float16)); pos+=SHIFT
    np.save(os.path.join(out,hashlib.md5(path.encode()).hexdigest()+'.npy'),np.concatenate(rows))
