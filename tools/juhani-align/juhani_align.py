#!/usr/bin/env python3
"""Juhani Phase 0 tooling — fetch, align, ear-QA sample, manifest generation.

Single-file consolidation of the four Phase 0 scripts (fetch_surah.py,
align_surah.py, qa_sample.py, gen_manifest.py), merged at Amr's request
to reduce the file count. All logic is verbatim from those scripts; only
the entry points changed (one argparse dispatch at the bottom).

NOT RUN. Nothing here has been executed end-to-end. The aligner backend
(`backend_align`) is written from memory of the `ctc-forced-aligner`
README and its exact API/outputs MUST be checked before trusting any
number. See the align section.

TERMS: the app already STREAMS the Juhani hadr files from the CDN
(lib/hadr.ts). Downloading them for local alignment is a separate use:
verify the CDN/reciter terms before running this at scale. Nothing here
uploads or re-hosts audio; the only artifact that ships is the per-word
timestamp table (numbers).

Subcommands (run from the repo root):
    python tools/juhani-align/juhani_align.py fetch --juz30
        Download Juhani hadr surah files + probe HTTP range support.
        Also: fetch 78 79 80 ... for specific surahs.
    python tools/juhani-align/juhani_align.py align --juz30 [--no-basmalah]
        Forced-align each surah file to per-word timestamps + gate.
        Also: align 78 79 ... for specific surahs.
    python tools/juhani-align/juhani_align.py qa --juz30 [--n 30] [--seed 1] [--max-blur 12]
        Cut the ear-QA sample clips + QA_SHEET.md for the juz.
    python tools/juhani-align/juhani_align.py gen --juz30
        Generate src/lib/juhaniManifestJuz30.ts from the aligned +
        QA-approved data (the ONLY writer of that file).

Pipeline order: export_words.ts (a separate TypeScript file — it must
stay separate so it can import the app's tokenizer from
src/lib/expectedWords) → fetch → align → qa → human ear QA of
QA_SHEET.md → write work/qa_approved.json → gen. Nothing ships until
the sheet is fully "good". Repair-queue ayahs are simply absent from the
manifest (generated fallback), never present-but-flagged.

All state lives under tools/juhani-align/work/ (audio/, aligned/,
qa/, words.json, range_probe.json, qa_approved.json).
"""
import argparse
import hashlib
import json
import random
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

WORK = Path(__file__).parent / "work"

# ------------------------------------------------------------------
# fetch — download hadr surah files + probe HTTP range support
# ------------------------------------------------------------------

FETCH_DOC = """Download Juhani hadr surah files and probe HTTP range support.

NOT RUN. Usage:
    python tools/juhani-align/juhani_align.py fetch 78 79 80 ...   # specific surahs
    python tools/juhani-align/juhani_align.py fetch --juz30        # surahs 78..114

Output (tools/juhani-align/work/):
    audio/{surah:03d}.mp3
    range_probe.json   { "78": {"status": 206, "accept_ranges": "bytes", "content_range": "..."} }

TERMS: the app already STREAMS these files from the CDN (lib/hadr.ts).
Downloading them for local alignment is a separate use: verify the
CDN/reciter terms before running this at scale. Nothing here uploads or
re-hosts audio; the only artifact that ships is the per-word timestamp
table (numbers).
"""

EDITION = "ar.abdullahawadaljuhani"
URL = "https://cdn.islamic.network/quran/audio-surah/128/" + EDITION + "/{s}.mp3"


def probe(surah: int) -> dict:
    req = urllib.request.Request(URL.format(s=surah), headers={"Range": "bytes=0-1023"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return {
            "status": r.status,
            "accept_ranges": r.headers.get("Accept-Ranges"),
            "content_range": r.headers.get("Content-Range"),
            "content_type": r.headers.get("Content-Type"),
        }


def download(surah: int) -> Path:
    dest = WORK / "audio" / f"{surah:03d}.mp3"
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 10_000:
        return dest
    with urllib.request.urlopen(URL.format(s=surah), timeout=300) as r, open(dest, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    return dest


def fetch_main(ns: argparse.Namespace) -> None:
    surahs = list(range(78, 115)) if ns.juz30 else list(ns.surahs)
    if not surahs:
        sys.exit(FETCH_DOC)
    probes_path = WORK / "range_probe.json"
    probes = json.loads(probes_path.read_text()) if probes_path.exists() else {}
    for s in surahs:
        try:
            probes[str(s)] = probe(s)
        except Exception as e:  # noqa: BLE001
            probes[str(s)] = {"status": None, "error": str(e)}
        try:
            p = download(s)
            print(f"surah {s}: {p.stat().st_size/1e6:.1f} MB, probe={probes[str(s)].get('status')}")
        except Exception as e:  # noqa: BLE001
            print(f"surah {s}: DOWNLOAD FAILED {e}")
    WORK.mkdir(parents=True, exist_ok=True)
    probes_path.write_text(json.dumps(probes, indent=1))

# ------------------------------------------------------------------
# align — per-word timestamps for hadr surah files + gate
# ------------------------------------------------------------------

ALIGN_DOC = """Phase 0: per-word timestamps for Juhani's hadr surah files.

NOT RUN. The aligner backend (`backend_align`) is the ONLY tool-specific
part and is written from memory of the `ctc-forced-aligner` README
(MMS CTC model, language 'ara'); its exact API/outputs MUST be checked
by the implementer before trusting anything. The tool is the
implementer's choice per the spec — swap `backend_align` for any aligner
that returns one (start, end[, score]) per input word, in order.

Usage:
    python tools/juhani-align/juhani_align.py align 78 79 ...        # needs work/words.json + work/audio/NNN.mp3
    python tools/juhani-align/juhani_align.py align --juz30
    python tools/juhani-align/juhani_align.py align 78 --no-basmalah # if the audio has NO spoken basmalah

Output: work/aligned/{surah:03d}.json
    {
      "surah": 78, "preamble_words": 4,
      "ayahs": {
        "78:1": {"words": [[s,e],...], "conf": [..], "flags": [...],
                 "ok": true, "reasons": []},
        ...
      },
      "repair_queue": ["78:7", ...]      # ayahs that did NOT pass the gate
    }

GATE (blocking): an ayah is `ok` only if EVERY word passes all checks.
Failing ayahs go to the repair queue and are NEVER shipped as windows:
a misaligned window plays cleanly and teaches the WRONG words.
`ok` is necessary, NOT sufficient: every juz still needs the stratified
ear sample (subcommand qa) before activation.
"""

BASMALAH = "بسم الله الرحمن الرحيم".split()

# ---- gate thresholds (tunable, record the values used in the output) ----
MIN_BACKEND_SCORE = None      # set a float when the backend exposes calibrated per-word scores
MIN_SEC_PER_CHAR = 0.025      # faster than this = squeezed word (mis-alignment symptom)
MAX_SEC_PER_CHAR = 0.60       # slower than this = absorbed silence / neighbour
MAX_INTRA_AYAH_GAP_S = 2.5    # pause between consecutive words inside one ayah
MIN_WORD_S = 0.04
RATE_TOLERANCE = 0.5          # ayah letters/sec within +-50% of the surah median


def n_letters(w: str) -> int:
    return len(re.sub(r"[^\u0621-\u064A]", "", w))


def nun_or_lam_boundary(prev: str, nxt: str) -> bool:
    """Heuristic flag for boundaries where hadr blurs the word edge
    (idgham / iqlab / lam assimilation). Flagged ayahs are MANDATORY ear QA."""
    if prev.endswith("ن") and nxt and nxt[0] in "يرملونب":
        return True
    base = prev.lstrip("وف")
    if base in ("قل", "بل", "هل") and nxt and nxt[0] in "رل":
        return True
    return False


# ONNX alignment model (ctc-forced-aligner >= 1.0, ONNX build): ~1.26 GB download
# on first use. Kept OUTSIDE the repo at the package's own default location
# (same as AlignmentSingleton), so no gitignore change is needed.
MODEL_PATH = Path.home() / "ctc_forced_aligner" / "model.onnx"

_SESSION_CACHE: dict = {}


def _load_session():
    """Load (once per process) the ONNX alignment session + tokenizer."""
    if "session" not in _SESSION_CACHE:
        from ctc_forced_aligner import MODEL_URL, Tokenizer, ensure_onnx_model  # type: ignore
        import onnxruntime  # type: ignore

        ensure_onnx_model(str(MODEL_PATH), MODEL_URL)
        opts = onnxruntime.SessionOptions()
        opts.intra_op_num_threads = 2  # tight-RAM VM: uncapped threads spiked peak RSS past 2.3 GB
        opts.inter_op_num_threads = 1
        _SESSION_CACHE["session"] = onnxruntime.InferenceSession(
            str(MODEL_PATH), opts, providers=["CPUExecutionProvider"]
        )
        _SESSION_CACHE["tokenizer"] = Tokenizer()
    return _SESSION_CACHE["session"], _SESSION_CACHE["tokenizer"]


def backend_align(audio_path: Path, words: list[str]) -> list[dict]:
    """Return [{'start': sec, 'end': sec, 'score': float|None}, ...] aligned 1:1 to `words`.

    VERIFIED 2026-11-05 against installed ctc-forced-aligner 1.0.2 (ONNX build),
    onnxruntime 1.31.1, unidecode 1.4.0 (torch 2.15.0+cpu installed but NOT used
    by this path). Smoke test: surah 114 (basmalah + 6 ayahs, 24 words) aligned
    end-to-end, 24/24 words, monotonic, ~21 s warm / ~40 s cold on this 4-CPU VM,
    peak RSS ~2.3 GB.

    Real API (differs from the from-memory sketch this replaced):
      * NO `load_alignment_model` exists in 1.0.2. The model is ONNX:
        `ensure_onnx_model(path, MODEL_URL)` downloads model.onnx (~1.26 GB,
        huggingface.co/deskpai/ctc_forced_aligner) once, then
        `onnxruntime.InferenceSession(path)` + `Tokenizer()`.
      * `load_audio(path)` takes NO dtype/device args; default returns a 1-D
        float32 numpy array at 16 kHz. (The old call passed model.dtype/device
        and would have produced a 2-D torch tensor that generate_emissions
        rejects with `audio_waveform must be a 1D array`.)
      * `generate_emissions(session, wav, batch_size=4)` — first arg is the
        ONNX session, not a torch model. Returns (emissions, stride_ms).
      * `preprocess_text(text, romanize=True, language="ara")` — signature as
        sketched. romanize=True is REQUIRED for Arabic: the vocab is Latin-only,
        so Arabic goes through `unidecode` — which is NOT a declared dependency
        of ctc-forced-aligner 1.0.2 and must be installed separately
        (`pip install unidecode`; same for `audioread`, needed by librosa for mp3).
      * `get_alignments(emissions, tokens, tokenizer)` -> (segments, scores, blank),
        `get_spans(tokens, segments, blank)`, and
        `postprocess_results(text_starred, spans, stride, scores)` — all as sketched,
        except postprocess_results ALREADY drops '<star>' entries itself, so the
        extra filter below is belt-and-braces only.
    Scores are sums of per-frame log-probs (negative, duration-dependent), NOT
    calibrated per-word confidences — that is why MIN_BACKEND_SCORE stays None.
    A partial/corrupt model.onnx (e.g. after a killed download) is NOT detected
    by ensure_onnx_model; delete it and re-run if session load fails.
    """
    try:
        from ctc_forced_aligner import (  # type: ignore
            MODEL_URL, Tokenizer, ensure_onnx_model, generate_emissions,
            get_alignments, get_spans, load_audio, postprocess_results,
            preprocess_text,
        )
        import onnxruntime  # type: ignore
    except ImportError as e:  # noqa: BLE001
        raise SystemExit("install: pip install ctc-forced-aligner onnxruntime unidecode audioread  (" + str(e) + ")")

    session, tokenizer = _load_session()
    wav = load_audio(str(audio_path))
    emissions, stride = generate_emissions(session, wav, batch_size=4)
    tokens_starred, text_starred = preprocess_text(" ".join(words), romanize=True, language="ara")
    segments, scores, blank = get_alignments(emissions, tokens_starred, tokenizer)
    spans = get_spans(tokens_starred, segments, blank)
    results = postprocess_results(text_starred, spans, stride, scores)
    results = [r for r in results if r.get("text") != "<star>"]  # already dropped upstream; defensive
    if len(results) != len(words):
        raise RuntimeError(f"aligner returned {len(results)} words for {len(words)} inputs")
    return [{"start": float(r["start"]), "end": float(r["end"]), "score": r.get("score")} for r in results]


def check_surah(surah: int, ayah_keys: list[str], words_by_ayah: dict, timings: list[dict], preamble: int) -> dict:
    ayahs: dict = {}
    repair: list[str] = []
    pos = preamble
    # median letters/sec over the whole surah, for the per-ayah rate check
    rates = []
    for k in ayah_keys:
        ws = words_by_ayah[k]["norm"]
        seg = timings[pos:pos + len(ws)]
        pos += len(ws)
        if seg:
            dur = seg[-1]["end"] - seg[0]["start"]
            if dur > 0:
                rates.append(sum(n_letters(w) for w in ws) / dur)
    rates.sort()
    median_rate = rates[len(rates) // 2] if rates else 0.0

    pos = preamble
    for k in ayah_keys:
        norm = words_by_ayah[k]["norm"]
        seg = timings[pos:pos + len(norm)]
        pos += len(norm)
        reasons: list[str] = []
        flags: list[str] = []
        conf: list[float] = []
        prev_end = None
        for i, (w, t) in enumerate(zip(norm, seg)):
            s, e = t["start"], t["end"]
            d = e - s
            spc = d / max(1, n_letters(w))
            if d < MIN_WORD_S:
                reasons.append(f"w{i}:too-short")
            if spc < MIN_SEC_PER_CHAR:
                reasons.append(f"w{i}:squeezed")
            if spc > MAX_SEC_PER_CHAR:
                reasons.append(f"w{i}:stretched")
            if prev_end is not None:
                if s < prev_end - 1e-3:
                    reasons.append(f"w{i}:overlap")
                if s - prev_end > MAX_INTRA_AYAH_GAP_S:
                    reasons.append(f"w{i}:big-gap")
            score = t.get("score")
            if score is not None:
                conf.append(float(score))
                if MIN_BACKEND_SCORE is not None and score < MIN_BACKEND_SCORE:
                    reasons.append(f"w{i}:low-score")
            else:
                conf.append(1.0 if not reasons else 0.0)
            if i > 0 and nun_or_lam_boundary(norm[i - 1], w):
                flags.append(f"blur-boundary:{i - 1}-{i}")
            prev_end = e
        if seg and median_rate > 0:
            dur = seg[-1]["end"] - seg[0]["start"]
            rate = sum(n_letters(w) for w in norm) / dur if dur > 0 else 0
            if not (median_rate * (1 - RATE_TOLERANCE) <= rate <= median_rate * (1 + RATE_TOLERANCE)):
                reasons.append("ayah-rate-outlier")
        if len(seg) != len(norm):
            reasons.append("word-count-mismatch")
        ok = not reasons
        if not ok:
            repair.append(k)
        ayahs[k] = {
            "words": [[round(t["start"], 3), round(t["end"], 3)] for t in seg],
            "conf": [round(c, 3) for c in conf],
            "flags": flags,
            "ok": ok,
            "reasons": reasons,
        }
    return {"ayahs": ayahs, "repair_queue": repair}


def align_main(ns: argparse.Namespace) -> None:
    surahs = list(range(78, 115)) if ns.juz30 else list(ns.surahs)
    if not surahs:
        sys.exit(ALIGN_DOC)
    no_basmalah = ns.no_basmalah
    words = json.loads((WORK / "words.json").read_text())
    (WORK / "aligned").mkdir(parents=True, exist_ok=True)
    for s in surahs:
        audio = WORK / "audio" / f"{s:03d}.mp3"
        if not audio.exists():
            print(f"surah {s}: no audio, skipped")
            continue
        keys = sorted((k for k in words if k.startswith(f"{s}:")), key=lambda k: int(k.split(":")[1]))
        # Spoken basmalah precedes the first ayah of every surah except 1 and 9
        # (in surah 1 it IS ayah 1 and is already in the text).
        preamble_words = [] if (s in (1, 9) or no_basmalah) else BASMALAH
        flat = list(preamble_words)
        for k in keys:
            flat.extend(words[k]["norm"])
        timings = backend_align(audio, flat)
        out = {"surah": s, "preamble_words": len(preamble_words), "no_basmalah": no_basmalah}
        out.update(check_surah(s, keys, words, timings, len(preamble_words)))
        (WORK / "aligned" / f"{s:03d}.json").write_text(json.dumps(out, ensure_ascii=False))
        ok = sum(1 for k in keys if out["ayahs"][k]["ok"])
        print(f"surah {s}: {ok}/{len(keys)} ayahs pass the gate; repair queue {len(out['repair_queue'])}")

# ------------------------------------------------------------------
# qa — per-juz ear-QA sample (clips + QA_SHEET.md)
# ------------------------------------------------------------------

QA_DOC = """Build the per-juz EAR-QA sample (local files only, never shipped).

NOT RUN. Needs ffmpeg on PATH. Usage:
    python tools/juhani-align/juhani_align.py qa --juz30 [--n 30] [--seed 1]

For a stratified sample of gate-passing ayahs it cuts the EXACT window
the app would play (same derivation as src/lib/juhaniCorr.ts, mirrored
below) plus a +0.5s "spill probe" version, so the listener hears whether
the next word leaks in at the window END. Even-indexed words sit LAST in
their window (refUnitForWord prefers the middle, then last), so the
sample deliberately over-represents END-edge cases.

Always included: every ayah carrying a `blur-boundary` flag (idgham /
iqlab: hadr blurs those word edges) up to --max-blur, then a spread
over surahs and ayah lengths, then the first/last ayah of each surah.

Output: work/qa/{juz}/ clips + QA_SHEET.md (tick-box sheet with the
window's words, expected text, and clip names). The juz activates ONLY
when the sheet is fully ticked 'good'. Failures -> repair queue, not a
shrug.
"""


def ref_unit(n: int, w: int) -> tuple[int, int]:
    """Mirror of refUnitForWord in src/lib/refWordUnits.ts (0-based, inclusive)."""
    if n <= 0:
        return 0, -1
    w = min(max(w, 0), n - 1)
    cands = [s for s in range(0, w + 1, 2) if w <= s + 2]
    start = cands[0] if cands else 0
    for s in cands:
        if w - s == 1:
            start = s
            break
        if w - s == 2:
            start = s
    return start, min(start + 2, n - 1)


def cut(src: Path, t0: float, t1: float, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t0:.3f}", "-to", f"{t1:.3f}", "-i", str(src), "-c:a", "libmp3lame", "-q:a", "2", str(dest)],
        check=True,
    )


def qa_main(ns: argparse.Namespace) -> None:
    n_target = ns.n
    seed = ns.seed
    max_blur = ns.max_blur
    juz = "juz30"
    surahs = list(range(78, 115)) if ns.juz30 else []
    if not surahs:
        sys.exit(QA_DOC)
    rng = random.Random(seed)
    words = json.loads((WORK / "words.json").read_text())

    pool, blur = [], []
    for s in surahs:
        p = WORK / "aligned" / f"{s:03d}.json"
        if not p.exists():
            continue
        data = json.loads(p.read_text())
        for k, a in data["ayahs"].items():
            if not a["ok"]:
                continue
            pool.append((s, k))
            if a["flags"]:
                blur.append((s, k))
    picked: list[tuple[int, str, str]] = []  # (surah, key, why)
    seen = set()

    def add(s: int, k: str, why: str) -> None:
        if (s, k) not in seen and len(picked) < n_target + max_blur:
            seen.add((s, k))
            picked.append((s, k, why))

    rng.shuffle(blur)
    for s, k in blur[:max_blur]:
        add(s, k, "blur-boundary (mandatory)")
    for s in surahs:  # first + last ayah of each surah
        keys = sorted((k for (ss, k) in pool if ss == s), key=lambda x: int(x.split(":")[1]))
        if keys:
            add(s, keys[0], "first-of-surah")
            add(s, keys[-1], "last-of-surah")
    rest = [x for x in pool if x not in seen]
    rng.shuffle(rest)
    for s, k in rest:
        if len(picked) >= n_target:
            break
        add(s, k, "spread")

    sheet = ["# Juhani window ear-QA sheet — " + juz, "",
             "For each row: play the EXACT clip, then the +0.5s probe. 'good' = the three words are complete and NO part of the next word is audible at the end (and nothing of the previous word at the start).", ""]
    for s, k, why in picked:
        data = json.loads((WORK / "aligned" / f"{s:03d}.json").read_text())
        a = data["ayahs"][k]
        n = len(a["words"])
        orig = words[k]["orig"]
        # one END-edge case (an even word >= 2, last in its window) + one middle case
        cases = []
        evens = [w for w in range(2, n, 2)]
        if evens:
            cases.append(("end-edge", rng.choice(evens)))
        odds = [w for w in range(1, n, 2)]
        if odds:
            cases.append(("middle", rng.choice(odds)))
        if not cases:
            cases.append(("short", 0))
        for tag, w in cases:
            u0, u1 = ref_unit(n, w)
            t0, t1 = a["words"][u0][0], a["words"][u1][1]
            base = f"{k.replace(':', '_')}_w{w}_{tag}"
            audio = WORK / "audio" / f"{s:03d}.mp3"
            out_dir = WORK / "qa" / juz
            cut(audio, t0, t1, out_dir / f"{base}.mp3")
            cut(audio, t0, t1 + 0.5, out_dir / f"{base}_probe.mp3")
            sheet.append(f"- [ ] **{k}** word {w} ({tag}; {why}; flags={a['flags']}) window words {u0}-{u1}: «{' '.join(orig[u0:u1 + 1])}»")
            sheet.append(f"  - clips: `{base}.mp3`, `{base}_probe.mp3`  ({t0:.3f}s–{t1:.3f}s)")
            sheet.append("  - verdict: good / spill-end / clipped-start / clipped-end / wrong-words")
    out = WORK / "qa" / juz / "QA_SHEET.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(sheet))
    print(f"wrote {out} ({len(picked)} ayahs)")


# ------------------------------------------------------------------
# gen — generate src/lib/juhaniManifestJuz30.ts (ONLY writer of it)
# ------------------------------------------------------------------

GEN_DOC = """Generate src/lib/juhaniManifestJuz30.ts (the ONLY writer of that file).

NOT RUN. Usage (from repo root):
    python tools/juhani-align/juhani_align.py gen --juz30

Inputs (tools/juhani-align/work/):
    aligned/{surah:03d}.json   from subcommand align
    range_probe.json           from subcommand fetch
    qa_approved.json           HUMAN-written:  {"juz30": {"approved": true, "by": "Amr", "date": "YYYY-MM-DD",
                                                          "exclude_ayahs": ["78:7", ...],
                                                          "adjustments": [{"ayah": "78:3", "word_index": 0,
                                                                           "start_delta": -0.25, "old_start": 9.12,
                                                                           "new_start": 8.87, ...}]}}
                               The juz is emitted ONLY if approved is true. exclude_ayahs = ayahs
                               that failed the ear sample or were pulled afterwards. adjustments =
                               ear-QA start shifts, applied to the aligned timing after the gate;
                               each one asserts old_start matches the aligned value and aborts on
                               any mismatch (never silently applied to the wrong word).
Rules (all blocking, none overridable by flags):
  * only ayahs with ok == true and not excluded;
  * only surahs whose range probe returned 206;
  * nothing is emitted if qa_approved.juz30.approved is not true ->
    the generated file is the dark stub (empty exports).
"""

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src" / "lib" / "juhaniManifestJuz30.ts"
JUZ30 = list(range(78, 115))


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:8] if p.exists() else "missing"


def gen_main(ns: argparse.Namespace) -> None:
    if not ns.juz30:
        sys.exit(GEN_DOC)
    qa_path = WORK / "qa_approved.json"
    qa = json.loads(qa_path.read_text()).get("juz30", {}) if qa_path.exists() else {}
    approved = bool(qa.get("approved"))
    exclude = set(qa.get("exclude_ayahs", []))
    adjustments = qa.get("adjustments", [])
    probes = json.loads((WORK / "range_probe.json").read_text()) if (WORK / "range_probe.json").exists() else {}

    timings: dict[str, list[float]] = {}
    range_ok: list[int] = []
    repair_total = 0
    if approved:
        for s in JUZ30:
            p = WORK / "aligned" / f"{s:03d}.json"
            pr = probes.get(str(s), {})
            if not p.exists() or pr.get("status") != 206:
                continue
            data = json.loads(p.read_text())
            repair_total += len(data["repair_queue"])
            kept = 0
            for k, a in data["ayahs"].items():
                if not a["ok"] or k in exclude:
                    continue
                flat: list[float] = []
                for st, en in a["words"]:
                    flat.extend([st, en])
                timings[k] = flat
                kept += 1
            if kept:
                range_ok.append(s)

    # Ear-QA start adjustments (qa_approved.json "adjustments"): shift the
    # named word's start by start_delta. Applied AFTER the gate, so only
    # shipped ayahs are touched; each adjustment asserts the recorded
    # old_start matches the aligned value and aborts on ANY mismatch —
    # never silently applied to the wrong word. Needed for every juz,
    # not just Juz 30 (future ear-QA rounds will add more).
    applied = 0
    if approved:
        for adj in adjustments:
            k = adj["ayah"]
            wi = int(adj["word_index"])
            row = adj.get("row", "-")
            if k not in timings:
                sys.exit(f"gen: adjustment {k} word {wi} ({row}) targets an ayah not in the manifest — aborting")
            flat = timings[k]
            if wi < 0 or 2 * wi + 1 >= len(flat):
                sys.exit(f"gen: adjustment {k} word {wi} ({row}) out of range ({len(flat) // 2} words) — aborting")
            cur = flat[2 * wi]
            if abs(cur - adj["old_start"]) > 0.001:
                sys.exit(f"gen: adjustment {k} word {wi} ({row}): aligned start {cur} != recorded old_start {adj['old_start']} — aborting")
            if abs((adj["old_start"] + adj["start_delta"]) - adj["new_start"]) > 0.001:
                sys.exit(f"gen: adjustment {k} word {wi} ({row}): old_start + start_delta != new_start — aborting")
            flat[2 * wi] = adj["new_start"]
            applied += 1

    lines = [
        "// GENERATED by tools/juhani-align/juhani_align.py (subcommand gen) — do not hand-edit.",
        f"// QA approved: {approved} (by {qa.get('by', '-')}, {qa.get('date', '-')}). Ayahs: {len(timings)}. Start adjustments applied: {applied}. Repair queue (not shipped): {repair_total}.",
        f"// Hashes: words {sha(WORK / 'words.json')}, qa_approved {sha(qa_path)}, range_probe {sha(WORK / 'range_probe.json')}.",
        "// Per-word [start,end] seconds in the hadr surah file, flat. Only QA-passed ayahs appear.",
        "// KILL SWITCH: delete an ayah key (or a surah below) and push.",
        "export const JUHANI_TIMINGS_JUZ30: Record<string, number[]> = {",
    ]
    for k in sorted(timings, key=lambda x: tuple(int(i) for i in x.split(":"))):
        lines.append(f"  '{k}': [{','.join(repr(v) for v in timings[k])}],")
    lines.append("};")
    lines.append("")
    lines.append(f"export const JUHANI_RANGE_OK_SURAHS_JUZ30: number[] = [{', '.join(str(s) for s in range_ok)}];")
    lines.append("")
    OUT.write_text("\n".join(lines))
    print(f"wrote {OUT} ({len(timings)} ayahs, {len(range_ok)} surahs, approved={approved}, adjustments={applied})")


# ------------------------------------------------------------------
# CLI dispatch — one entry point for the four subcommands
# ------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="juhani_align.py",
        description="Juhani Phase 0 tooling: fetch, align, ear-QA sample, manifest generation.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_fetch = sub.add_parser("fetch", help="Download hadr surah files + probe HTTP range support.")
    p_fetch.add_argument("--juz30", action="store_true", help="Surahs 78..114 (Juz 30).")
    p_fetch.add_argument("surahs", nargs="*", type=int, help="Specific surah numbers (e.g. 78 79 80).")
    p_fetch.set_defaults(func=fetch_main)

    p_align = sub.add_parser("align", help="Forced-align surah files to per-word timestamps + gate.")
    p_align.add_argument("--juz30", action="store_true", help="Surahs 78..114 (Juz 30).")
    p_align.add_argument("--no-basmalah", action="store_true", help="Audio has NO spoken basmalah preamble.")
    p_align.add_argument("surahs", nargs="*", type=int, help="Specific surah numbers (e.g. 78 79).")
    p_align.set_defaults(func=align_main)

    p_qa = sub.add_parser("qa", help="Cut the ear-QA sample clips + QA_SHEET.md.")
    p_qa.add_argument("--juz30", action="store_true", help="Surahs 78..114 (Juz 30).")
    p_qa.add_argument("--n", type=int, default=30, help="Target sample size (default 30).")
    p_qa.add_argument("--seed", type=int, default=1, help="Random seed (default 1).")
    p_qa.add_argument("--max-blur", type=int, default=12, help="Max blur-boundary ayahs forced in (default 12).")
    p_qa.set_defaults(func=qa_main)

    p_gen = sub.add_parser("gen", help="Generate src/lib/juhaniManifestJuz30.ts.")
    p_gen.add_argument("--juz30", action="store_true", help="Juz 30 (surahs 78..114).")
    p_gen.set_defaults(func=gen_main)

    return parser


def main(argv=None) -> None:
    args = build_parser().parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
