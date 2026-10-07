import math
import sys

import numpy as np
import soundfile as sf


def process(in_path, out_path, osec=4.0, attack=0.02, release=0.15, target_peak=0.89):
    x, sr = sf.read(in_path, dtype="float64")
    mono = x.ndim == 1
    if mono:
        x = x[:, None]
    n, ch = x.shape
    O = int(osec * sr)
    P = n - O

     # Circular 50/50 blend so the loop tail energetically folds into its head.
    out = np.empty((P, ch), dtype=np.float64)
    idx2 = (np.arange(P) + O) % n
    for c in range(ch):
        s = x[:, c]
        out[:, c] = 0.5 * s[:P] + 0.5 * s[idx2]

     # Short attack/release clips kill residual edge transients at the wrap.
    ai_len = max(1, int(attack * sr))
    ri_len = max(1, int(release * sr))
    ai = np.linspace(0, 1, ai_len) if ai_len > 1 else np.array([1.0])
    ri = np.linspace(1, 0, ri_len) if ri_len > 1 else np.array([0.0])
    for c in range(ch):
        out[: len(ai), c] *= ai
        out[-len(ri):, c] *= ri

    peak = float(np.abs(out).max()) or 1.0
    out *= target_peak / peak

     # libsndfile wants frame-major (frames, channels) for stereo; 1-D for mono.
    payload = out[:, 0].astype(np.float32) if mono else out.astype(np.float32)
    sf.write(out_path, payload, sr, subtype="PCM_16")

    back, back_sr = sf.read(out_path, dtype="float64")
    rms_all = float(math.sqrt((back ** 2).mean()))
    jump = np.abs(back[0] - back[-1])
    seam_rms = float(math.sqrt((jump ** 2).mean()))
    return {
         "sr": back_sr,
         "loops_ms": int(back.shape[0] * 1000 / back_sr),
         "channels": back.ndim if back.ndim > 1 else 1,
         "peak_out": float(np.abs(back).max()),
         "rms": rms_all,
         "seam_ratio": seam_rms / max(rms_all, 1e-9),
     }


PAIRS = [
     ("sa3_raw/trackA_dark.wav", "public/audio/music/future-jungle-dark.wav"),
     ("sa3_raw/trackB_bright.wav", "public/audio/music/future-jungle-bright.wav"),
]

ok = True
for in_path, out_path in PAIRS:
    m = process(in_path, out_path)
    print(out_path)
    for k, v in m.items():
        print(f"    {k:>16s}: {v}")
    ok = ok and m["peak_out"] < 1.005 and m["seam_ratio"] < 0.05

sys.exit(0 if ok else 1)
