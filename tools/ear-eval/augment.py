#!/usr/bin/env python3
"""Internal robustness augmentation for speech-recognizer testing.

Reads a mono 16 kHz wav and writes augmented variants to OUT_DIR as
<stem>__<variant>.wav (float32, clipped to [-1, 1]).

Usage:
  python3 augment.py IN.wav OUT_DIR
  python3 augment.py --list
  python3 augment.py --selftest
"""
import argparse
import os
import sys
import tempfile
import zlib

import numpy as np
import soundfile as sf

SR = 16000
RT60 = 0.45  # seconds
VARIANTS = [
    "clean",
    "quiet",
    "soft",
    "loud",
    "noise20",
    "noise10",
    "noise5",
    "room",
    "room_noise10",
    "quiet_noise10",
]
NOISE_SNRS = {"noise20": 20.0, "noise10": 10.0, "noise5": 5.0,
              "room_noise10": 10.0, "quiet_noise10": 10.0}


def read_mono(path):
    x, sr = sf.read(path, dtype="float32", always_2d=False)
    if sr != SR:
        raise ValueError(f"{path}: expected {SR} Hz, got {sr} Hz")
    if x.ndim == 2:
        x = x.mean(axis=1).astype(np.float32)
    return x


def clip(x):
    return np.clip(x, -1.0, 1.0).astype(np.float32)


def speech_mask(x):
    """Samples whose smoothed envelope exceeds 10% of the peak envelope."""
    win = max(1, int(0.010 * SR))  # 10 ms moving average of |x|
    env = np.convolve(np.abs(x), np.ones(win, dtype=np.float32) / win, mode="same")
    peak = env.max() if env.size else 0.0
    if peak <= 0:
        return np.zeros(x.shape, dtype=bool)
    return env > 0.1 * peak


def speech_rms(x):
    mask = speech_mask(x)
    part = x[mask] if mask.any() else x
    return float(np.sqrt(np.mean(part.astype(np.float64) ** 2))) if part.size else 0.0


def white_pink_noise(n, rng):
    """Equal-power mix of white and pink-ish (1/sqrt(f) shaped) noise, unit RMS."""
    white = rng.standard_normal(n)
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, d=1.0 / SR)
    f[0] = f[1] if f.size > 1 else 1.0
    pink = np.fft.irfft(spec / np.sqrt(f), n)
    white /= np.sqrt(np.mean(white ** 2)) + 1e-12
    pink /= np.sqrt(np.mean(pink ** 2)) + 1e-12
    mix = (white + pink) / np.sqrt(2.0)
    return mix / (np.sqrt(np.mean(mix ** 2)) + 1e-12)


def add_noise(x, snr_db, seed):
    rng = np.random.default_rng(seed)
    rms = speech_rms(x)
    if rms <= 0:
        return x.copy()
    noise = white_pink_noise(x.size, rng)
    noise *= rms / (10.0 ** (snr_db / 20.0))
    return clip(x + noise.astype(np.float32))


def room_ir(seed):
    """Synthetic exponentially decaying noise impulse response, RT60 = RT60 s."""
    rng = np.random.default_rng(seed)
    n = int(RT60 * SR)
    t = np.arange(n) / SR
    decay = np.exp(-6.907755 * t / RT60)  # -60 dB at RT60
    ir = rng.standard_normal(n) * decay
    ir[0] = 1.0  # direct path
    return ir.astype(np.float64)


def room(x, seed):
    ir = room_ir(seed)
    n = x.size
    nfft = 1 << int(np.ceil(np.log2(n + ir.size - 1)))
    y = np.fft.irfft(np.fft.rfft(x.astype(np.float64), nfft) * np.fft.rfft(ir, nfft), nfft)[:n]
    peak_in = float(np.max(np.abs(x))) if n else 0.0
    peak_out = float(np.max(np.abs(y))) if n else 0.0
    if peak_out > 0:
        y *= peak_in / peak_out
    return clip(y.astype(np.float32))


def make_variants(x, seed):
    """Return dict variant_name -> float32 array (same length as x)."""
    out = {}
    out["clean"] = clip(x)
    out["quiet"] = clip(x * 0.15)
    out["soft"] = clip(x * 0.4)
    out["loud"] = clip(x * 3.0)
    out["noise20"] = add_noise(x, 20.0, seed)
    out["noise10"] = add_noise(x, 10.0, seed)
    out["noise5"] = add_noise(x, 5.0, seed)
    out["room"] = room(x, seed)
    out["room_noise10"] = add_noise(out["room"], 10.0, seed)
    out["quiet_noise10"] = add_noise(out["quiet"], 10.0, seed)
    return out


def stem_seed(stem):
    return zlib.crc32(stem.encode("utf-8")) & 0xFFFFFFFF


def augment_file(in_wav, out_dir):
    stem = os.path.splitext(os.path.basename(in_wav))[0]
    x = read_mono(in_wav)
    os.makedirs(out_dir, exist_ok=True)
    written = []
    for name, y in make_variants(x, stem_seed(stem)).items():
        path = os.path.join(out_dir, f"{stem}__{name}.wav")
        sf.write(path, y, SR, subtype="FLOAT")
        written.append(path)
    return written


def selftest():
    with tempfile.TemporaryDirectory() as tmp:
        t = np.arange(2 * SR) / SR
        rng = np.random.default_rng(0)
        x = (0.5 * np.sin(2 * np.pi * 220 * t) + 0.05 * rng.standard_normal(t.size))
        x = x.astype(np.float32)
        in_wav = os.path.join(tmp, "synth.wav")
        sf.write(in_wav, x, SR, subtype="FLOAT")
        out_dir = os.path.join(tmp, "out")
        paths = augment_file(in_wav, out_dir)
        names = {os.path.basename(p) for p in paths}
        assert len(paths) == len(VARIANTS), f"expected {len(VARIANTS)} files, got {len(paths)}"
        for v in VARIANTS:
            assert f"synth__{v}.wav" in names, f"missing variant {v}"
        for p in paths:
            y, sr = sf.read(p, dtype="float32")
            assert sr == SR, f"{p}: sr {sr}"
            assert y.shape[0] == x.size, f"{p}: length {y.shape[0]} != {x.size}"
            assert not np.isnan(y).any(), f"{p}: NaN"
            assert np.all(np.abs(y) <= 1.0), f"{p}: out of [-1,1]"
        # Reproducibility: same seed -> identical noise output.
        again = augment_file(in_wav, os.path.join(tmp, "out2"))
        a, _ = sf.read(os.path.join(out_dir, "synth__noise10.wav"), dtype="float32")
        b, _ = sf.read(os.path.join(tmp, "out2", "synth__noise10.wav"), dtype="float32")
        assert np.array_equal(a, b), "noise10 not reproducible"
    print("OK")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("in_wav", nargs="?", help="mono 16 kHz input wav")
    ap.add_argument("out_dir", nargs="?", help="output directory")
    ap.add_argument("--list", action="store_true", help="print variant names and exit")
    ap.add_argument("--selftest", action="store_true", help="run self-test and exit")
    args = ap.parse_args(argv)

    if args.list:
        print("\n".join(VARIANTS))
        return 0
    if args.selftest:
        selftest()
        return 0
    if not args.in_wav or not args.out_dir:
        ap.error("IN.wav and OUT_DIR are required")
    for p in augment_file(args.in_wav, args.out_dir):
        print(p)
    return 0


if __name__ == "__main__":
    sys.exit(main())
