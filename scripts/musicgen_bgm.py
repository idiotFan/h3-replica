#!/usr/bin/env python3
"""MusicGen BGM 生成脚本（高音质版）

向后兼容的位置参数用法::

    python3 scripts/musicgen_bgm.py "<prompt>" "<输出路径>" [时长秒] [模型]

新增可选参数::

    --candidates N        用 N 个不同随机种子生成 N 个候选（默认 1）
    --alt-prompt TEXT     追加候选 prompt 变体（可重复；候选 1 用位置参数的 prompt）
    --loop-fade SEC       结尾 SEC 秒与开头做等功率交叉淡化，产出真正可无缝循环的音频
                          （默认 2.0，传 0 关闭）
    --seed N              基准随机种子（默认 1337，候选 i 用 seed + i）
    --bitrate 192k        mp3 CBR 码率（默认 192k）
    --sample-rate N       mp3 重采样率（默认不重采样，保留模型原生采样率）
    --device auto|mps|cpu|cuda
    --candidates-dir DIR  候选文件输出目录（默认 <out_path 所在目录>/candidates）
    --promote IDX         生成完成后把第 IDX 个候选（1 起）原子安装到 out_path
    --keep-wav / --no-keep-wav   是否保留无损 wav（默认保留）

设计要点（针对"音质太差"的三个根因）：
  1. 默认模型改为立体声 medium（facebook/musicgen-stereo-medium），参数量是 small 的 5 倍，
     且是真立体声；加载失败自动降级 musicgen-medium → musicgen-small。
  2. mp3 编码从 `-qscale:a 4`（单声道下只有 ~67kbps）改为 CBR 192kbps，并保留原生采样率。
  3. 设备选择不再用 torch 版本号硬判断：实际跑一段 5 秒试生成探测 MPS 是否产出正常音频
     （非 NaN / 非静音 / 非爆音），能用就用 MPS，不能用才回落 CPU。
"""
import argparse
import gc
import math
import os
import shutil
import subprocess
import sys
import tempfile
import time

# 必须在 import torch 之前设置：EnCodec 的 aten::_weight_norm_interface 在 torch 2.1 的
# MPS 后端没实现，开了这个开关它会自动回落 CPU 执行该算子，其余仍跑在 GPU 上。
# 没有它 MPS 路径必崩（NotImplementedError），这正是原脚本"MPS 不可用"的真实原因之一。
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

# ---------------------------------------------------------------- 常量

# 降级顺序按"这台机器上真正跑得动"排：立体声优先于参数量，因为 16GB 机器上
# medium(1.5B, fp32≈6GB) 一旦进 swap 就会从 ~440 步/分 掉到 ~10 步/分（实测）。
# stereo-small 虽然只有 300M，但仍是真立体声，比 mono-medium 更值得先试。
MODEL_FALLBACKS = [
    "facebook/musicgen-stereo-medium",
    "facebook/musicgen-stereo-small",
    "facebook/musicgen-medium",
    "facebook/musicgen-small",
]
DEFAULT_MODEL = MODEL_FALLBACKS[0]
PROBE_MODEL = "facebook/musicgen-small"   # 已缓存，探测 MPS 用它最省时间
PROBE_SECONDS = 5


def log(*a):
    print(*a, flush=True)


def swap_used_gb():
    """macOS 上读当前 swap 使用量（GB）。读不到返回 None。"""
    try:
        out = subprocess.run(["sysctl", "-n", "vm.swapusage"],
                             check=True, capture_output=True, text=True).stdout
        # 形如: total = 7168.00M  used = 5879.75M  free = 1288.25M
        parts = out.split()
        for i, tok in enumerate(parts):
            if tok == "used" and i + 2 < len(parts):
                v = parts[i + 2]
                mult = {"M": 1 / 1024, "G": 1.0, "K": 1 / 1048576}.get(v[-1], 1 / 1024)
                return float(v[:-1]) * mult
    except Exception:                                         # noqa: BLE001
        return None
    return None


# ---------------------------------------------------------------- 音频工具

def waveform_is_sane(wav):
    """判断一段生成的波形是否可用：非 NaN/Inf、非静音、非全幅爆音。"""
    import torch

    if wav is None or wav.numel() == 0:
        return False, "空张量"
    x = wav.detach().float().cpu()
    if not torch.isfinite(x).all():
        return False, "含 NaN/Inf"
    peak = x.abs().max().item()
    rms = x.pow(2).mean().sqrt().item()
    if rms < 1e-4:
        return False, f"近似静音 (rms={rms:.2e})"
    if peak > 8.0:
        return False, f"数值爆掉 (peak={peak:.2f})"
    clipped = (x.abs() > 0.995).float().mean().item()
    if clipped > 0.30:
        return False, f"严重削波 ({clipped:.0%} 样本贴顶)"
    return True, f"ok (rms={rms:.3f}, peak={peak:.3f})"


def crossfade_loop(wav, sample_rate, fade_seconds):
    """把结尾 fade_seconds 秒与开头做等功率交叉淡化，得到可无缝循环的波形。

    输入 [C, T]，输出 [C, T - fade]。循环播放时 尾→头 的拼接点连续。
    """
    import torch

    channels, total = wav.shape
    n = int(round(fade_seconds * sample_rate))
    if n <= 0 or n >= total // 2:
        return wav, 0
    body = wav[:, : total - n].clone()
    tail = wav[:, total - n:]
    t = torch.linspace(0.0, 1.0, n, dtype=body.dtype, device=body.device)
    # 等功率（sin/cos）交叉淡化，避免线性淡化在不相关素材上出现中间音量塌陷
    fade_in = torch.sin(t * (math.pi / 2))
    fade_out = torch.cos(t * (math.pi / 2))
    body[:, :n] = body[:, :n] * fade_in + tail * fade_out
    return body, n


def encode_mp3(wav_path, mp3_path, bitrate="192k", sample_rate=None):
    """CBR 编码。相比原来的 -qscale:a 4（VBR，单声道下只算出 ~67kbps）质量高一大截。"""
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", wav_path]
    if sample_rate:
        cmd += ["-ar", str(sample_rate)]
    cmd += ["-codec:a", "libmp3lame", "-b:a", bitrate, mp3_path]
    subprocess.run(cmd, check=True, capture_output=True)


def probe_mp3(path):
    """返回 (bitrate_kbps, channels, sample_rate, seconds)。ffprobe 不可用时返回 None。"""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
             "stream=bit_rate,channels,sample_rate:format=duration",
             "-of", "default=noprint_wrappers=1", path],
            check=True, capture_output=True, text=True).stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
    d = {}
    for line in out.splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            d[k.strip()] = v.strip()
    def num(key, cast, default=None):
        try:
            return cast(d[key])
        except (KeyError, ValueError, TypeError):
            return default
    br = num("bit_rate", int)
    return {
        "bitrate_kbps": round(br / 1000) if br else None,
        "channels": num("channels", int),
        "sample_rate": num("sample_rate", int),
        "seconds": round(num("duration", float, 0.0), 2),
    }


def atomic_install(src, dst):
    """先写同目录临时文件再 os.replace，避免并行进程读到写了一半的文件。"""
    dst_dir = os.path.dirname(os.path.abspath(dst)) or "."
    os.makedirs(dst_dir, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=dst_dir, prefix=".bgm_tmp_",
                               suffix=os.path.splitext(dst)[1] or ".tmp")
    os.close(fd)
    try:
        shutil.copyfile(src, tmp)
        os.chmod(tmp, 0o644)
        os.replace(tmp, dst)          # 同一文件系统内的原子重命名
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    return dst


# ---------------------------------------------------------------- 设备探测

_AUTOCAST_PATCHED = False


def patch_autocast_for_unsupported_devices():
    """让 audiocraft 在 torch 不认识的 device_type 上静默退回"无 autocast"而不是崩掉。

    torch 2.1 的 `torch.autocast(device_type='mps')` 直接抛
    `RuntimeError: User specified an unsupported autocast device_type 'mps'`，
    而 audiocraft 是在 **构造模型时**（T5Conditioner.__init__ → builders.get_lm_model）
    就 new 出 TorchAutocast 的，等拿到 MusicGen 对象再去关已经太晚了。
    这里包一层：不支持就 enabled=False（fp32 跑），从而让 MPS 至少可达。
    对 CPU/CUDA 无任何影响（只有 torch 主动报错时才生效）。
    """
    global _AUTOCAST_PATCHED
    if _AUTOCAST_PATCHED:
        return
    from audiocraft.utils import autocast as ac_mod

    orig = ac_mod.TorchAutocast.__init__

    def patched(self, enabled=True, *args, **kwargs):
        try:
            orig(self, enabled, *args, **kwargs)
        except RuntimeError as exc:
            if "unsupported autocast device_type" not in str(exc):
                raise
            orig(self, False)
    ac_mod.TorchAutocast.__init__ = patched
    _AUTOCAST_PATCHED = True


def disable_autocast(model_obj):
    """关掉所有 autocast，用 fp32 跑。

    torch 2.1 直接不认 device_type='mps'（抛 RuntimeError: User specified an unsupported
    autocast device_type 'mps'），而 audiocraft 有**两处**独立 autocast：
    MusicGen 自身 一处，T5Conditioner 内部还有一处 —— 只关前者没用。
    """
    from audiocraft.utils.autocast import TorchAutocast
    off = TorchAutocast(enabled=False)
    model_obj.autocast = off
    provider = getattr(getattr(model_obj, "lm", None), "condition_provider", None)
    for cond in getattr(provider, "conditioners", {}).values():
        if hasattr(cond, "autocast"):
            cond.autocast = TorchAutocast(enabled=False)


def _probe_once(device, autocast_on):
    """在 device 上用 small 模型跑 PROBE_SECONDS 秒，返回 (ok, detail)。"""
    from audiocraft.models import MusicGen

    m = None
    try:
        patch_autocast_for_unsupported_devices()
        m = MusicGen.get_pretrained(PROBE_MODEL, device=device)
        if not autocast_on:
            disable_autocast(m)
        m.set_generation_params(duration=PROBE_SECONDS, top_k=250)
        t0 = time.time()
        wav = m.generate(["calm orchestral strings"], progress=False)
        ok, detail = waveform_is_sane(wav[0])
        return ok, f"{detail}, {time.time() - t0:.1f}s"
    except Exception as exc:                                  # noqa: BLE001
        return False, f"{type(exc).__name__}: {exc}"[:200]
    finally:
        del m
        gc.collect()
        try:
            import torch
            if device == "mps":
                torch.mps.empty_cache()
        except Exception:                                     # noqa: BLE001
            pass


def choose_device(requested):
    """返回 (device, use_autocast, notes[])。"""
    import torch

    notes = []
    if requested and requested != "auto":
        notes.append(f"设备由命令行指定为 {requested}")
        return requested, requested != "cpu", notes

    if torch.cuda.is_available():
        notes.append("检测到 CUDA")
        return "cuda", True, notes

    if not torch.backends.mps.is_available():
        notes.append("MPS 不可用 → CPU")
        return "cpu", False, notes

    # 不再用 torch 版本号硬判断，而是真的跑一段短音频看结果是否正常
    log(f"[probe] 用 {PROBE_MODEL} 在 MPS 上试生成 {PROBE_SECONDS}s（fp32，autocast 自动降级）…")
    ok, detail = _probe_once("mps", autocast_on=False)
    notes.append(f"MPS 试生成探测: {'通过' if ok else '失败'} — {detail}")
    log(f"[probe] {notes[-1]}")
    if ok:
        return "mps", False, notes

    notes.append("MPS 试生成不合格 → 回落 CPU")
    return "cpu", False, notes


# ---------------------------------------------------------------- 模型加载

def load_model(preferred, device, use_autocast, notes):
    """按 preferred → 降级链 依次尝试，返回 (model_obj, 实际模型名)。"""
    from audiocraft.models import MusicGen

    chain = [preferred] + [m for m in MODEL_FALLBACKS if m != preferred]
    last = None
    # 必须在构造模型之前打；torch 支持该 device_type 时此补丁完全不生效
    patch_autocast_for_unsupported_devices()
    for name in chain:
        gc.collect()
        log(f"[model] 加载 {name} 到 {device}（首次会下载）…")
        t0 = time.time()
        try:
            m = MusicGen.get_pretrained(name, device=device)
        except Exception as exc:                              # noqa: BLE001
            last = f"{name}: {type(exc).__name__}: {exc}"[:240]
            notes.append(f"模型 {name} 加载失败，降级 — {last}")
            log(f"[model] 失败: {last}")
            gc.collect()
            continue
        if device != "cpu" and not use_autocast:
            disable_autocast(m)
        log(f"[model] {name} 就绪，用时 {time.time() - t0:.0f}s，采样率 {m.sample_rate}Hz")
        if name != preferred:
            notes.append(f"实际使用模型 {name}（首选 {preferred} 不可用）")
        return m, name
    raise RuntimeError(f"所有模型都加载失败，最后错误: {last}")


# ---------------------------------------------------------------- 主流程

def build_parser():
    p = argparse.ArgumentParser(
        description="MusicGen BGM 生成（立体声 / 高码率 / 无缝循环 / 多候选）",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("prompt", help="文本 prompt")
    p.add_argument("out_path", nargs="?", default="art/audio/bgm.mp3",
                   help="最终输出路径（默认 art/audio/bgm.mp3）")
    p.add_argument("duration", nargs="?", type=float, default=30.0, help="时长秒（默认 30）")
    p.add_argument("model", nargs="?", default=DEFAULT_MODEL,
                   help=f"模型名（默认 {DEFAULT_MODEL}）")
    p.add_argument("--candidates", type=int, default=1, help="生成候选数量（默认 1）")
    p.add_argument("--alt-prompt", action="append", default=[],
                   help="候选 2/3/… 的 prompt 变体，可重复")
    p.add_argument("--loop-fade", type=float, default=2.0,
                   help="尾→头交叉淡化秒数，0 关闭（默认 2.0）")
    p.add_argument("--seed", type=int, default=1337, help="基准随机种子（默认 1337）")
    p.add_argument("--bitrate", default="192k", help="mp3 CBR 码率（默认 192k）")
    p.add_argument("--sample-rate", type=int, default=None,
                   help="mp3 重采样率；默认不重采样，保留模型原生采样率")
    p.add_argument("--device", default="auto", choices=["auto", "cpu", "mps", "cuda"])
    p.add_argument("--candidates-dir", default=None,
                   help="候选输出目录（默认 <out_path 目录>/candidates）")
    p.add_argument("--promote", type=int, default=None,
                   help="把第 N 个候选（1 起）原子安装到 out_path")
    p.add_argument("--keep-wav", dest="keep_wav", action="store_true", default=True)
    p.add_argument("--no-keep-wav", dest="keep_wav", action="store_false")
    p.add_argument("--top-k", type=int, default=250)
    p.add_argument("--cfg-coef", type=float, default=3.0)
    p.add_argument("--temperature", type=float, default=1.0)
    p.add_argument("--tag", default="bgm", help="候选文件名前缀（默认 bgm）")
    p.add_argument("--swap-guard-gb", type=float, default=18.0,
                   help="生成中 swap 超过此值就判定为内存颠簸并中止本候选（默认 18GB，0 关闭）。"
                        "16GB 机器上 medium fp32 进 swap 后速度会掉 40 倍，硬等没有意义")
    return p


def main():
    args = build_parser().parse_args()
    notes = []

    out_path = os.path.abspath(args.out_path)
    out_dir = os.path.dirname(out_path) or "."
    cand_dir = os.path.abspath(args.candidates_dir or os.path.join(out_dir, "candidates"))
    os.makedirs(cand_dir, exist_ok=True)

    n_cand = max(1, args.candidates)
    prompts = [args.prompt] + list(args.alt_prompt)
    fade = max(0.0, args.loop_fade)
    # 交叉淡化会削掉 fade 秒，因此多生成 fade 秒以保证成品时长达标
    gen_duration = args.duration + fade

    log("=== MusicGen BGM 生成 ===")
    log(f"候选数: {n_cand}   目标时长: {args.duration}s（生成 {gen_duration}s，尾部 {fade}s 用于交叉淡化）")
    log(f"候选目录: {cand_dir}")
    log(f"编码: libmp3lame CBR {args.bitrate}"
        + (f"，重采样 {args.sample_rate}Hz" if args.sample_rate else "，保留原生采样率"))
    log("")

    if shutil.which("ffmpeg") is None:
        log("警告：ffmpeg 不可用，只会产出 wav")
        notes.append("ffmpeg 不可用，未产出 mp3")

    try:
        import torch
        from audiocraft.data.audio import audio_write
    except ImportError as exc:
        log(f"错误：依赖缺失 — {exc}")
        sys.exit(1)

    device, use_autocast, dev_notes = choose_device(args.device)
    notes.extend(dev_notes)
    log(f"[device] 最终设备: {device}（autocast={'on' if use_autocast and device != 'cpu' else 'off'}，torch {torch.__version__}）")

    model_obj, model_name = load_model(args.model, device, use_autocast, notes)
    stereo = "stereo" in model_name
    model_obj.set_generation_params(
        duration=gen_duration, top_k=args.top_k,
        cfg_coef=args.cfg_coef, temperature=args.temperature)

    results, failed = [], []
    i = 0
    while i < n_cand:
        idx = i + 1
        seed = args.seed + i
        prompt = prompts[i] if i < len(prompts) else prompts[-1]
        stem = f"{args.tag}_{idx:02d}_seed{seed}"
        log("")
        log(f"--- 候选 {idx}/{n_cand}  seed={seed} ---")
        log(f"prompt: {prompt}")
        t0 = time.time()
        i += 1
        try:
            torch.manual_seed(seed)
            if device == "cuda":
                torch.cuda.manual_seed_all(seed)
            gc.collect()
            wav = model_obj.generate([prompt], progress=True)
            gen_s = time.time() - t0

            audio = wav[0].detach().cpu().float()      # [C, T]
            ok, detail = waveform_is_sane(audio)
            if not ok:
                raise RuntimeError(f"生成的波形不合格: {detail}")

            if fade > 0:
                audio, cut = crossfade_loop(audio, model_obj.sample_rate, fade)
                log(f"[loop] 尾 {fade}s 等功率交叉淡化到开头，裁掉 {cut} 采样点 → 可无缝循环")

            wav_path = os.path.join(cand_dir, stem + ".wav")
            # strategy=loudness + 不开压缩器：统一响度但不引入 pumping；BGM 留 16dB headroom
            # add_suffix=True → 实际落盘为 <stem>.wav，与上面的 wav_path 一致
            audio_write(os.path.join(cand_dir, stem), audio, model_obj.sample_rate,
                        format="wav", strategy="loudness", loudness_headroom_db=16,
                        loudness_compressor=False, add_suffix=True)
            if not os.path.exists(wav_path):
                raise RuntimeError(f"audio_write 未产出预期文件: {wav_path}")
            secs = audio.shape[-1] / model_obj.sample_rate

            mp3_path = None
            if shutil.which("ffmpeg"):
                mp3_path = os.path.join(cand_dir, stem + ".mp3")
                encode_mp3(wav_path, mp3_path, args.bitrate, args.sample_rate)

            info = probe_mp3(mp3_path) if mp3_path else None
            entry = {
                "index": idx, "seed": seed, "prompt": prompt,
                "wav": wav_path if args.keep_wav else None,
                "mp3": mp3_path,
                "seconds": round(secs, 2),
                "gen_seconds": round(gen_s, 1),
                "channels": (info or {}).get("channels", audio.shape[0]),
                "sample_rate": (info or {}).get("sample_rate", model_obj.sample_rate),
                "bitrate_kbps": (info or {}).get("bitrate_kbps"),
            }
            if not args.keep_wav and os.path.exists(wav_path):
                os.remove(wav_path)
            results.append(entry)
            log(f"[ok] {secs:.1f}s / 生成耗时 {gen_s:.0f}s / {entry['channels']}ch "
                f"{entry['sample_rate']}Hz / mp3 {entry['bitrate_kbps']}kbps")
            log(f"     wav: {wav_path}")
            log(f"     mp3: {mp3_path}")
        except Exception as exc:                              # noqa: BLE001
            msg = f"候选 {idx} (seed={seed}) 失败: {type(exc).__name__}: {exc}"[:300]
            log(f"[fail] {msg}")
            gc.collect()
            # GPU 上炸了（多半是显存/统一内存不够）就永久退到 CPU，并**重试当前这个候选**
            # （不能直接跳过，否则请求 N 个只会拿到 N-1 个）
            if device != "cpu":
                log("[fail] 非 CPU 设备生成失败，重新在 CPU 上加载模型并重试本候选…")
                notes.append(f"候选 {idx} 在 {device} 上失败（{type(exc).__name__}），改用 CPU 重试")
                i -= 1                       # 回退索引，下一轮重跑同一个候选
                try:
                    del model_obj
                except NameError:
                    pass
                gc.collect()
                device, use_autocast = "cpu", False
                model_obj, model_name = load_model(args.model, device, use_autocast, notes)
                stereo = "stereo" in model_name
                model_obj.set_generation_params(
                    duration=gen_duration, top_k=args.top_k,
                    cfg_coef=args.cfg_coef, temperature=args.temperature)
            else:
                # 已经在 CPU 上了，没有更保守的退路，如实记为失败
                failed.append(msg)

    installed = None
    if results:
        pick = None
        if args.promote:
            pick = next((r for r in results if r["index"] == args.promote), None)
            if pick is None:
                failed.append(f"--promote {args.promote} 未找到对应候选")
        elif n_cand == 1:
            pick = results[0]                                  # 兼容旧行为：单个就直接落盘
        if pick:
            src = pick["mp3"] if out_path.endswith(".mp3") and pick["mp3"] else pick["wav"]
            if src:
                installed = atomic_install(src, out_path)
                log("")
                log(f"[install] 原子安装候选 {pick['index']} → {installed}")

    log("")
    log("=== 完成 ===")
    log(f"设备: {device}   模型: {model_name}   立体声: {stereo}")
    log(f"成功 {len(results)} / 失败 {len(failed)}")
    for r in results:
        log(f"  #{r['index']} seed={r['seed']} {r['seconds']}s {r['channels']}ch "
            f"{r['sample_rate']}Hz {r['bitrate_kbps']}kbps -> {r['mp3']}")
    for f in failed:
        log(f"  FAIL {f}")

    # 机器可读摘要，便于上层脚本 / agent 解析
    import json
    log("")
    log("###JSON###")
    log(json.dumps({
        "device": device, "model": model_name, "stereo": stereo,
        "installed": installed, "candidates": results,
        "failed": failed, "notes": notes,
    }, ensure_ascii=False))

    if not results:
        sys.exit(2)


if __name__ == "__main__":
    main()
