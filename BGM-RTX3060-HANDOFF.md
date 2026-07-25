# BGM 重制任务 · RTX 3060 机器交接文档

> **接手对象**：在配有 RTX 3060 的 Windows 机器上执行本任务的人 / AI agent
> **文档产出**：2026-07-25，由 Mac 端交接
> **一句话任务**：用 `musicgen-stereo-large` 生成《英雄无敌 3D》网页游戏的地图探索 BGM，3 个候选，45 秒，192kbps 立体声，可无缝循环，把候选文件送回。

---

## 一、为什么要做这件事

线上游戏 https://h3.idiotfan.wang 现在的 BGM **音质很差**，用户明确反馈过。已诊断出三个叠加的原因：

| 问题 | 现状 | 影响 |
|------|------|------|
| 模型档位最低 | `musicgen-small`（300M） | 乐句连贯性差 |
| 单声道 | mono 32kHz | 先天缺乏空间感 |
| **mp3 码率只有 67kbps** | `-qscale:a 4` 在单声道下的结果 | **最致命**——把本就一般的音源又糊了一层 |

Mac 端已经把生成脚本升级好了（立体声、192kbps、无缝循环、多候选），但 **Mac 跑不动**：
- 16GB 统一内存，`stereo-medium` 实测 **123 秒才出 6 秒音频**，45 秒的曲子要 15 分钟一个
- torch 2.1 的 MPS 不支持 `autocast`，只能跑 fp32，速度直接减半
- `large`（3.3B）在 16GB 机器上根本装不下

**所以任务挪到 3060 上，并且直接上 `large`** —— 这是本次交接的核心决定。

---

## 二、目标机器要求

| 项 | 要求 | 说明 |
|----|------|------|
| 显卡 | **RTX 3060 12GB** | `stereo-large`(3.3B) fp16 约需 7GB 显存，12GB 版本从容 |
| | RTX 3060 8GB | 勉强，建议加 `--decode-chunk-frames 300` 降解码峰值 |
| | RTX 3060 6GB（笔记本版） | **跑不了 large**，退回 `stereo-medium` |
| 系统 | Windows 10 21H2+ / Windows 11 | WSL2 CUDA 直通的最低要求 |
| 环境 | **WSL2**（不要用原生 Windows/PowerShell） | 理由见下 |
| 磁盘 | 20GB 可用 | torch ~2.5GB + large 模型 ~7GB + 缓存 |
| 内存 | 16GB+ | 模型加载时会过一遍系统内存 |

### 为什么必须用 WSL2 而不是 PowerShell

- **audiocraft 是 Linux 优先的栈**。Windows 原生装它经常卡在 xformers 编译失败、torchaudio 找不到后端、ffmpeg 要手动配 PATH 这些事上，能耗掉半天
- WSL 里 `apt install ffmpeg` + `pip install audiocraft` 基本一把过
- **GPU 不吃亏**：WSL2 从 2020 年起支持 CUDA 直通（GPU-PV）。驱动装在 **Windows 宿主**，WSL 内**不要**再装显卡驱动，只装 CUDA toolkit。对 MusicGen 这种长核、带宽瓶颈的负载，开销几乎测不出来

---

## 三、环境准备

### 3.1 验证 GPU 直通

```bash
nvidia-smi
```

能看到 RTX 3060 和显存数字就说明直通正常。看不到就先在 **Windows 宿主**上装/更新 NVIDIA 驱动（不是在 WSL 里装）。

### 3.2 装依赖

```bash
sudo apt update && sudo apt install -y ffmpeg python3-venv git
```

> `ffmpeg` 是必须的——脚本靠它做 mp3 编码。没有它只会产出 wav。

```bash
mkdir -p ~/bgm && cd ~/bgm
python3 -m venv .venv
.venv/bin/pip install -U pip
.venv/bin/pip install audiocraft
```

**⚠ 关键：不要升级 torch。** `audiocraft 1.3.0` 与 `torch 2.1.x` 配套，手动升 torch 会破坏兼容性。装完确认：

```bash
.venv/bin/python -c "import torch, audiocraft; print(torch.__version__, audiocraft.__version__, torch.cuda.is_available())"
```

期望输出类似 `2.1.0 1.3.0 True`。**`True` 是关键**，False 说明 CUDA 没通，别往下走。

### 3.3 ⚠ 工作目录一定放 WSL 内部

模型缓存和工作目录必须在 `~/`（如 `~/bgm`），**绝对不要放 `/mnt/c/`**。跨文件系统 IO 慢一个数量级，7GB 的 large 模型加载会明显卡顿。

顺便确认 `.wslconfig` 给了足够内存（默认只给物理内存的一半）。在 **Windows 宿主**的 `C:\Users\<你>\.wslconfig`：

```ini
[wsl2]
memory=16GB
```

改完 `wsl --shutdown` 重启生效。

---

## 四、拿到脚本

生成脚本已经写好并调试过，**不要重写**。两种拿法：

```bash
# 方式 A：克隆仓库（推荐，顺带拿到本文档）
cd ~/bgm && git clone https://gitee.com/idiotfan/h3-replica.git
cp h3-replica/scripts/musicgen_bgm.py .

# 方式 B：只要单个文件，让交接方直接把 scripts/musicgen_bgm.py 传过来
```

脚本已具备的能力（都调试过）：立体声模型、**192kbps CBR 编码**、`--loop-fade` 尾头等功率交叉淡化做无缝循环、`--candidates` 多候选、`--promote` 原子安装、波形健全性检查、显存不足时的分块解码。

**每个候选生成完会立即写盘**（wav + mp3 都在候选循环内落地），所以中途出问题不会全丢。

---

## 五、正式运行

### 5.1 先跑一次 6 秒冒烟测试

别一上来就跑 45 秒——先花两分钟确认链路通：

```bash
cd ~/bgm
.venv/bin/python musicgen_bgm.py \
  "epic medieval fantasy exploration theme, warm orchestral strings, solo lute melody, instrumental" \
  ./smoke/smoke.mp3 6 facebook/musicgen-stereo-large \
  --device cuda --candidates 1
```

检查产出的 mp3：**必须是 `channels: 2`、`bitrate ≈ 192kbps`**。用 `ffprobe` 确认：

```bash
ffprobe -v error -show_entries stream=channels,sample_rate -show_entries format=bit_rate -of default=noprint_wrappers=1 smoke/smoke.mp3
```

顺便记下这 6 秒花了多久，用来外推 45 秒的耗时。

### 5.2 正式生成

```bash
cd ~/bgm
nohup .venv/bin/python musicgen_bgm.py \
  "epic medieval fantasy exploration theme, warm orchestral strings, solo lute melody, soft wooden flute, gentle hand percussion, rich reverb, cinematic game soundtrack, instrumental, calm heroic mood, loopable" \
  ./out/bgm_map.mp3 45 facebook/musicgen-stereo-large \
  --device cuda \
  --candidates 3 \
  --loop-fade 2.0 \
  --bitrate 192k \
  --alt-prompt "medieval fantasy world map theme, lyrical lute and harp duet, warm strings pad, distant horn, spacious reverb, calm wandering mood, instrumental, loopable" \
  --alt-prompt "gentle fantasy adventure overworld music, celtic flute lead, soft plucked strings, light frame drum, airy orchestral bed, hopeful and unhurried, instrumental, loopable" \
  > run.log 2>&1 &

# 轮询进度
tail -f run.log
```

**预期耗时**：3060 上 `stereo-large` 大约 **3-6 分钟一个候选**，三个约 **10-20 分钟**。
（对照组：Mac MPS 跑 `stereo-medium` 是 15 分钟一个。）

如果实测远慢于此，先确认 `run.log` 里设备真的是 `cuda` 而不是悄悄回落 `cpu`。

---

## 六、本项目的 BGM 风格规范

这是**大地图探索**用的 BGM，玩家会长时间循环听，定位是**温暖、悠远、不喧宾夺主**——不能太抓耳，否则听十分钟就烦。

**必须包含的关键词**：`medieval, fantasy, orchestral, instrumental, loopable, game soundtrack`

**必须避免**：`vocals, lyrics, singing, modern, electronic, drums heavy, epic battle`（战斗 BGM 是另一个场景，本次不做）

**配器倾向**：鲁特琴 / 竖琴 / 木笛 / 柔和弦乐 / 轻手鼓，中慢速，留白多，混响宽

> 如果将来要做其他场景（本次不需要，仅供参考）：
> 战斗 = 铜管+定音鼓+快弦乐、快板；胜利 = 凯旋号角、明亮大调；城堡 = 竖琴+柔和木管、温暖安宁

---

## 七、验收标准

产出的候选必须同时满足：

| 项 | 标准 | 怎么查 |
|----|------|--------|
| 声道 | **立体声（2）** | `ffprobe` |
| 码率 | **≥192kbps** | `ffprobe` |
| 时长 | 45 秒（±1s） | `ffprobe` |
| 无削波 | 峰值 < 1.0，无爆音 | 波形检查或耳听 |
| 无异常静音 | 开头结尾不能有长静音 | 耳听 |
| **循环接缝** | 首尾相接处**听不出突变** | **把文件循环播放两遍听**，这是最容易翻车的一项 |
| 风格符合 | 温暖、悠远、不喧宾夺主 | 耳听，对照第六节 |

**最重要的一条：一定要循环播放着听至少 3 分钟。** 游戏里是 `loop = true` 无限循环，很多曲子单听 45 秒很好、循环起来就暴露出接缝突兀或旋律太抓耳听腻的问题。

---

## 八、交付方式

**只需要交回音频文件，不需要碰游戏代码、不需要部署。**

1. 把 3 个候选的 **mp3**（`out/candidates/` 下）打包送回
2. 附上 `run.log`（有耗时、设备、参数记录）
3. 如果你自己听下来有明显偏好，说一下推荐哪个及理由——但**最终选哪个由 Mac 端定**

Mac 端拿到后会做客观评估（频谱带宽、动态范围、LUFS、循环接缝连续性、立体声宽度）再择优，然后接入游戏并部署。

---

## 九、避坑清单

**Mac 端踩过的坑，CUDA 上不适用**（别浪费时间）：MPS 不支持 autocast、`aten::_weight_norm_interface` 算子缺失、fp32 强制回落——这些都是 Apple Silicon 特有的，CUDA 上一个都不会遇到。脚本里那些 MPS 绕过逻辑在 CUDA 上会自动跳过。

**这台机器上要注意的**：

1. **确认真的在用 GPU**。`run.log` 开头会打印设备。跑起来后另开终端 `nvidia-smi` 看显存占用和 GPU 利用率，占用接近 0 就是在跑 CPU
2. **large 显存不够时**：加 `--decode-chunk-frames 300`（降低 EnCodec 解码峰值显存）。还不够就退 `facebook/musicgen-stereo-medium`，如实说明
3. **不要升级 torch**。看到 pip 提示有新版也别升
4. **别把工作目录放 `/mnt/c/`**（见 3.3）
5. **首次运行会下载约 7GB 模型**，看网速可能要一二十分钟，这是正常的，不是卡住了
6. **`--loop-fade 2.0` 不要关掉**。关了就没有无缝循环，游戏里每 45 秒会"咔"一下

---

## 十、关于 MusicGen 本身的天花板（重要预期管理）

MusicGen 是 2023 年的模型，**即使 `large` 也只到"能听、不出戏"的水平**，达不到商业游戏 OST 的质感。上 `large` 相比 `medium` 是明显提升，但不要期待脱胎换骨。

如果三个候选出来仍然不满意，比起继续堆算力，这两个方向更有效——可以在回执里给出你的判断：

- **换模型**：Stable Audio Open（音质明显更好，但显存要求更高，3060 12GB 可以试）
- **换来源**：直接用免费商用的中世纪奇幻 BGM 素材库（质量下限比 AI 生成高得多，这对一个网页小游戏可能是性价比最高的选择）

---

## 附：一行速查

```bash
# 环境自检
nvidia-smi && .venv/bin/python -c "import torch;print(torch.__version__, torch.cuda.is_available())"

# 冒烟（6秒，两分钟内出结果）
.venv/bin/python musicgen_bgm.py "<prompt>" ./smoke/s.mp3 6 facebook/musicgen-stereo-large --device cuda

# 正式（45秒×3候选，10-20分钟）
nohup .venv/bin/python musicgen_bgm.py "<prompt>" ./out/bgm_map.mp3 45 \
  facebook/musicgen-stereo-large --device cuda --candidates 3 --loop-fade 2.0 --bitrate 192k \
  --alt-prompt "<变体1>" --alt-prompt "<变体2>" > run.log 2>&1 &

# 验收
ffprobe -v error -show_entries stream=channels,sample_rate -show_entries format=bit_rate,duration \
  -of default=noprint_wrappers=1 out/candidates/*.mp3
```
