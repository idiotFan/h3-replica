# 英雄无敌 3D · 美术规范（v1）

> 目标：在保持 Web 可玩性能的前提下，把观感从“程序化 demo”提升到“可出品的低多边形中世纪策略游戏”。  
> 工具：**Blender（主）** → **glTF/GLB** → Three.js  
> 不推荐本项目主用 Maya（成本高，Web 管线无额外收益）。

---

## ⚠️ 阅读须知（2026-07-25 补注）

**本文 §1 – §12 是 v1 规范，针对的是「Blender 手工建模 → 导出 glb」的管线。**
2026-07-24~25 起，项目的 **17 个角色资产**（15 兵种 + 2 英雄）已经改由
**Meshy AI 生成 → `scripts/compress_assets.mjs` 压缩** 的新管线产出，
只剩 **5 个建筑**（`castle_player` / `castle_enemy` / `mine_sawmill` / `mine_ore` / `mine_gold`）
还走 v1 的 Blender 管线。

因此下面这些章节对 Meshy 资产**不再适用或需要改读**：

| 章节 | v1 说法 | Meshy + 压缩管线的实际情况 |
|------|---------|---------------------------|
| §2.1 Blender 导出朝向检查清单 | 手工在 Blender 里校朝向 | Meshy 靠 prompt 里的 `side profile view facing left` 约束；有偏差时在 `js/assets/manifest.js` 给该 key 加 `rotY` |
| §3 面数预算 | 表格里的区间 | **单一事实来源已改成 `js/assets/manifest.js` 的 `polyBudget`**，压缩管线直接读它做 meshopt 简化。改面数预算 = 改 `polyBudget` |
| §4.1 贴图尺寸 | 手工出图时的目标 | 由压缩管线参数强制：普通单位 **512**、英雄/龙 **1024**、metallicRoughness **256**；格式 **webp**（`EXT_texture_webp`） |
| §4.2 Emissive | 「仅眼睛、魔法、夜间窗户；强度克制」 | 对 Meshy 资产**一律关闭**——Meshy 导出 `emissiveFactor=[1,1,1]` + `emissiveTexture`，会顶穿 `main.js` 的 Bloom `threshold 0.85` 把整个模型糊成一团光。压缩管线删贴图 + 归零，`manifest.js` 的 `SINGLE_MESH_EMISSIVE=0` 运行时再兜一层 |
| §4.3 / §7.1 队伍色 `TeamColor` 命名 | 靠网格名分部位染色 | **对 Meshy 资产必然失效**：它们的 node/mesh/material 名全是 `null`。改走 `manifest.js` 的 `singleMesh:true` → `factory.js` 整体色调偏移（`SINGLE_MESH_TINT=0.25`）+ 强化底座阵营光环。`factory.js` 的 `detectSingleMesh()` 会按「网格全无名」在运行时自愈，标记漏改也不会退化成没有队伍色 |
| §6 动画规范 | `idle/walk/attack/hit/death` 五段 + 骨骼根 `Root` | **Meshy 资产 `animations` 为空数组，没有 armature**。当前全部用代码模拟（颠簸/晃动/呼吸），见 `HANDOVER.md` §六。这一节仍是**将来接真骨骼动画时的目标规范**，不是现状描述 |
| §7 目录 `art/src/` | Blender 源文件 `.blend` | 实际目录是 **`art/_src/`**，存的是 Meshy 原件 glb（154MB，`.gitignore` + `deploy.sh` 双重排除，**是唯一副本**） |
| §9.3 包体目标 | P0 <3MB / P1 <12MB / P2 <25MB | 已达成且大幅优于目标，实测见下方 §13 |
| §10 Blender 检查表 | 每资源导出前逐项检查 | 只对 5 个建筑适用；角色资产的对应检查见 §13 |

**新增资产时先看 §13，再回来看 §1 – §12 的风格/调色/验收部分（那些仍然完全适用）。**

---

## 1. 风格定位

| 项 | 规范 |
|----|------|
| 大方向 | **风格化低多边形中世纪**（Stylized Low-poly Medieval） |
| 参考感 | 《英雄无敌3》可读性 + 现代低模手办感（非写实） |
| 禁止 | 写实皮肤毛孔、照片贴图、赛博/二次元混搭、过亮 PBR 金属拉丝 |
| 关键词 | 剪影清晰、色块干净、边线利落、略微 Q 版比例 |

### 1.1 角色比例
- 头身比约 **1:3.5 ~ 1:4**（比写实略 Q，比完全卡通更严肃）
- 武器、旗帜、坐骑轮廓要“远距离可辨”
- 战场单位站立包围盒高度目标：**1.0 ~ 1.4 世界单位**（龙 1.6~2.0）

---

## 2. 世界单位与对齐

当前游戏逻辑单位保持不变：

| 对象 | 规范 |
|------|------|
| 大地图一格 | `TILE = 2` 世界单位 |
| 战场六边形 | 外接半径约 `0.96`，单位站立高度 `UNIT_Y ≈ 0.14` |
| 朝向 | **+Z 为正面**（导出时 Blender 需校对：Blender -Y 前 → glTF +Z 前） |
| 原点 | 角色原点在**脚底中心**；建筑原点在**底座中心地面** |
| 缩放 | 导入后视觉高度不符合上表时，在 loader 里统一 `scale`，禁止每个资源随意缩放 |

### 2.1 Blender 导出朝向检查清单
1. 角色面朝 **-Y**（Blender 视图）
2. Apply All Transforms（Ctrl+A）
3. 导出 glTF：
   - Format: **glTF Binary (.glb)**
   - Transform: **+Y Up**
   - Geometry: Apply Modifiers ✅
   - Compression：可选 Draco（移动端再开）

---

## 3. 面数预算（硬指标）

| 资产类型 | 三角面上限 | 说明 |
|----------|------------|------|
| 步兵/射手 | **800 ~ 1,500** | 枪兵、弓箭手、骷髅、兽人 |
| 精英近战 | **1,500 ~ 2,500** | 剑士、十字军、狼 |
| 骑乘单位 | **2,500 ~ 4,000** | 英雄、骑士、精英骑士 |
| 飞行单位 | **2,000 ~ 3,500** | 狮鹫、幽灵、皇家狮鹫 |
| Boss 龙 | **4,000 ~ 6,000** | 黑龙；再高必须做 LOD |
| 城堡（玩家/敌方） | **3,000 ~ 6,000** | 可拆主楼+塔为多 mesh |
| 矿场/装饰建筑 | **800 ~ 2,000** | 锯木厂、矿坑、金矿 |
| 地图拾取物 | **100 ~ 400** | 金币、木材、宝箱 |
| 战场障碍 | **200 ~ 600** | 石头、树桩 |
| 树木（单棵） | **200 ~ 500** | 尽量复用 2~3 个变体 |

> 原则：**宁肯少面数 + 好贴图，也不要高模无动画。**

### 3.1 LOD（第二阶段）
- `*_lod0.glb` 全细节（镜头近）
- `*_lod1.glb` 约 40% 面数（大地图远景）
- 大地图单位默认 lod1，战场用 lod0

---

## 4. 贴图与材质

### 4.1 贴图尺寸
| 资产 | 反照率/ORM | 法线 |
|------|------------|------|
| 英雄/Boss | 1024 | 1024（可无） |
| 常规单位 | 512 | 512 或无 |
| 建筑 | 1024 | 可选 |
| 道具/装饰 | 256~512 | 无 |

- 格式：导出嵌入 glb 内（PNG/WebP 源文件另存 `art/src/`）
- 必须 **2 的幂**
- 单单位尽量 **1 套材质 / 1~2 张贴图**（合图）

### 4.2 PBR 约定（Three.js `MeshStandardMaterial`）
| 通道 | 规范 |
|------|------|
| BaseColor | 主色，避免过曝；暗部靠灯光不是靠把贴图涂黑 |
| Roughness | 布料 0.7~0.9，金属盔甲 0.35~0.55，石头 0.8~1.0 |
| Metalness | 布/肉/木 = 0；金属部件 0.7~1.0 |
| Emissive | 仅眼睛、魔法、夜间窗户；强度克制 |
| Alpha | 尽量不用；半透明仅幽灵 |

### 4.3 风格化着色补充
- 主光偏暖，环境光偏冷青（与现有日夜循环一致）
- 允许轻微 **色块分区**（盔甲深/浅分块），不要照片噪点
- 队伍色：玩家 **蓝 `#2c5fa8`**，敌方 **红 `#8a2a2a`**  
  → 披风/旗/镶边用这组色，便于战场辨识

---

## 5. 调色板（主色）

| 用途 | 色值 |
|------|------|
| UI 金 | `#ffd76b` / `#c8a951` |
| 玩家蓝 | `#2c5fa8` / `#3b82f6` |
| 敌方红 | `#8a2a2a` / `#ef4444` |
| 草地 | `#4c7a45` ~ `#5da24a` |
| 海水 | `#2e6f9e` |
| 岩石 | `#8a8d91` |
| 木材 | `#6b4f2a` / `#8a6b3d` |
| 皮肤 | `#e8c39e` |
| 幽灵青 | `#afc3de` + emissive `#4ac8df` |
| 龙暗红 | `#7a1f1f` / 腹 `#a8503a` |

---

## 6. 动画规范

### 6.1 必须动画（单位）
| 片段名 | 时长 | 循环 | 说明 |
|--------|------|------|------|
| `idle` | 1.5~2.5s | ✅ | 呼吸/轻微重心 |
| `walk` | 0.6~0.9s | ✅ | 战场移动；骑乘用马步 |
| `attack` | 0.5~0.8s | ❌ | 出招点约 40%~50% 处 |
| `hit` | 0.25~0.4s | ❌ | 受击闪避/后仰 |
| `death` | 0.6~1.0s | ❌ | 倒地；最后一帧可 hold |
| `victory` | 可选 | ❌ | 仅英雄 |

### 6.2 命名
- 动画名全小写英文：`idle` / `walk` / `attack` / `hit` / `death`
- 骨骼根节点：`Root`
- 不要导出多余 NLA 轨道

### 6.3 与现有战斗逻辑对接
当前战斗仍可用补间位移；接入 glTF 后：
- 移动开始 → `walk`
- 攻击补间接触帧 → `attack`
- `applyDamage` → 目标 `hit`
- `killStack` → `death` 播完再移除

---

## 7. 文件与命名规范

```
art/
  src/                  # Blender 源文件 .blend（可不进发布包）
  export/               # 导出的 .glb
    units/
      pikeman.glb
      pikeman2.glb
      archer.glb
      ...
    heroes/
      hero_player.glb
      hero_enemy.glb
    buildings/
      castle_player.glb
      castle_enemy.glb
      mine_sawmill.glb
      mine_ore.glb
      mine_gold.glb
    props/
      pickup_gold.glb
      pickup_chest.glb
      tree_01.glb
      rock_01.glb
  textures/             # 源贴图（可选）
```

### 7.1 与代码 key 对齐（必须）
文件名（不含扩展名）= `config.js` 的单位 key：

| glb | 游戏 key |
|-----|----------|
| `pikeman.glb` | `pikeman` |
| `pikeman2.glb` | `pikeman2` |
| `archer.glb` | `archer` |
| `griffin.glb` | `griffin` |
| `swordsman.glb` | `swordsman` |
| `champion.glb` | `champion` |
| `wolf.glb` | `wolf` |
| `skeleton.glb` | `skeleton` |
| `orc.glb` | `orc` |
| `ghost.glb` | `ghost` |
| `dragon.glb` | `dragon` |
| `hero_player.glb` | 玩家英雄 |
| `hero_enemy.glb` | 敌方英雄 |

精锐形态（`*2`）：同剪影升级装饰（金边、披风纹章），不要换成完全不同生物。

---

## 8. 资产优先级（分阶段）

### P0 · 先做对比验证（1 周内可闭环）
1. `hero_player.glb` + idle/walk  
2. `pikeman.glb` + idle/attack/death  
3. `castle_player.glb`（静态即可）  
4. `dragon.glb`（静态或仅 idle）  

→ 接入加载器后与原语版左右对比，确认风格再铺开。

### P1 · 战斗可读性
- 全基础兵种 + 远程/飞行  
- `hero_enemy`、`castle_enemy`  
- 攻击/受击/死亡动画  

### P2 · 地图丰富度
- 矿场、拾取物、3 种树、2 种岩石  
- 精锐 `*2` 全套  
- LOD1  

### P3 · 打磨
- 法术手特效 mesh  
- 胜利姿势、旗帜物理（可仍用程序）  

---

## 9. 技术接入约定（给程序）

### 9.1 加载
- 使用 `GLTFLoader`（Three r160 addons）
- 资源清单：`js/assets/manifest.js`（路径、缩放、锚点、默认动画）
- 加载失败 → **回退现有 `models.js` 原语**（保证可玩）

### 9.2 运行时
- 单位创建：`createUnit(type, side)`  
  - 若 manifest 有 glb 且已缓存 → clone 场景图  
  - 否则 → `makeUnit(type, side)`  
- 材质：导入后统一 `MeshStandardMaterial`，并根据 `side` 替换队伍色节点（命名含 `TeamColor` 的材质/网格）
- 阴影：`castShadow/receiveShadow` 按画质开关

### 9.3 包体目标

| 阶段 | 全部 glb 合计 | 实际达成（2026-07-25 实测） |
|------|----------------|------|
| P0 | < 3 MB | — |
| P1 | < 12 MB | — |
| P2 | < 25 MB | **3.69 MB**（22 个 glb，3,864,140 字节）——远优于目标 |

**更该盯的是「首屏阻塞下载量」而不是总量**：分阶段懒加载后，首屏只下 9 个 glb =
**1.27 MB**（1,327,244 字节），其余 13 个 = 2.42 MB 在进入游戏后后台补。详见 §13。

---

## 10. Blender 制作检查表（每资源导出前）

- [ ] 面数在预算内  
- [ ] 原点在脚底/底座中心，面向 -Y  
- [ ] Apply Transforms  
- [ ] 无多余大面/内部面  
- [ ] 队伍色部件命名含 `TeamColor`  
- [ ] 动画名符合规范且无空洞轨  
- [ ] 导出 glb 后用 [glTF Viewer](https://gltf-viewer.donmccurdy.com/) 检查  
- [ ] 放入游戏后：高度、朝向、攻击距离观感 OK  

---

## 11. 与当前程序化美术的关系

| 继续用程序化 | 改为 glTF |
|--------------|-----------|
| 大地图地形高度/海岸 | 英雄、兵种、Boss |
| 水、天空、日夜、雾 | 城堡、矿场 |
| 草、花、云、粒子 | 重要装饰（旗帜、神器） |
| UI / 小地图 | — |

**结论：场景骨架继续代码生成，角色与建筑上资产。** 这是性价比最高的出品路径。

---

## 12. 验收标准（什么叫“达标”）

1. 战场 10 步外能分清兵种剪影  
2. 玩家/敌方 0.5 秒内靠颜色可辨  
3. 中端手机（局域网）战斗帧率稳定 ≥ 30fps（低画质）  
4. 缺资源时游戏仍能进入并可玩（原语回退）  
5. 全套 P0 资源加载进度条可见、失败有提示  

---

---

## 13. Meshy + 压缩管线（v2 实际指标）★ 2026-07-25

> 这一节描述的是**现状**：17 个角色资产实际是怎么产出的、实测数字是多少。
> §1 – §12 的风格定位（§1）、世界单位与对齐（§2）、调色板（§5）、验收标准（§12）仍然完全适用。

### 13.1 管线

```
Meshy AI 文生 3D                 压缩管线                       运行时
──────────────────               ────────                       ──────
scripts/meshy_gen.mjs      →     art/_src/**.glb         →     art/export/**.glb
（preview + refine，PBR）        （唯一副本，154MB，        （3.69MB，上线）
                                   不入 git、不上线）
                                 scripts/compress_assets.mjs
                                 npm run compress:assets -- --format webp
```

**为什么必须压**：Meshy 原件单个 7–10MB，约 95% 是 4 张 2048² 贴图；22 个合计 **136MB**，
首屏那 9 个就有 40MB+，在国内移动网络下等同于打不开。

### 13.2 硬指标（压缩管线强制，改这些 = 改 `scripts/compress_assets.mjs` 的 `DEFAULTS`）

| 项 | 值 | 备注 |
|----|----|------|
| 面数 | 读 `js/assets/manifest.js` 的 `polyBudget` | **单一事实来源**。实际区间 1500（枪兵/弓箭手/骷髅）～ 6000（黑龙），与 §3 的预算表一致 |
| baseColor / normal 尺寸 | 普通单位 **512**，英雄 + 龙 **1024** | `--texture-size` / `--hero-texture-size`，`--big-texture-assets=hero_player,hero_enemy,dragon` |
| metallicRoughness | **256**，且通道标准差低于 0.05 时退化成标量 | MR 多是低频遮罩，但少数资产真有细节，不一刀切 |
| 贴图格式 | **webp**（`EXT_texture_webp`） | three r160 **原生**支持。**禁用** Draco / meshopt 压缩 / KTX2 — `js/assets/loader.js` 没注册对应解码器，用了直接加载失败 |
| 编码质量 | baseColor 80 / normal 85 / MR 90 | 法线图对压缩噪声敏感，MR 是数据不是颜色 |
| emissive | **一律删除并归零** | 见阅读须知里的 §4.2 一行 |

> ⚠ 线上这批资产就是用上面这组默认值 + `--format webp` 出的。**改了参数就不能复现线上资产**，
> 而体积目标（≤8MB）已有 2.2 倍余量，没有正当理由动它。

### 13.3 实测体积（2026-07-25，`art/export`，22 个 glb 合计 3,864,140 字节 = 3.69MB）

**首屏阻塞加载（`loader.js getBootAssets()`，9 个 / 1,327,244 字节 / 1.27MB）**

| 资产 | 字节 | 资产 | 字节 |
|------|------|------|------|
| hero_player | 381,232 | pikeman | 128,544 |
| griffin | 177,676 | archer | 99,008 |
| castle_player | 164,532 | mine_sawmill | 94,292 |
| swordsman | 158,900 | mine_gold | 63,360 |
| | | mine_ore | 59,700 |

**后台加载（`getBackgroundAssets()`，13 个 / 2,536,896 字节 / 2.42MB）**：
hero_enemy 343,632 · dragon 295,648 · champion2 279,844 · champion 205,888 · castle_enemy 202,252 ·
griffin2 196,196 · swordsman2 188,888 · pikeman2 168,356 · archer2 124,500 · skeleton 156,000 ·
orc 154,224 · ghost 130,876 · wolf 90,592

> 两组相加 **正好等于目录总量**，说明 22 个 glb 全部被代码引用、**没有孤儿资产**。
> 新增 glb 后请重跑这个核对，多出来的差额就是没人引用的死资产。

**单资产上限建议**：普通单位 ≤ 200KB，精锐 ≤ 300KB，英雄/Boss ≤ 400KB，建筑 ≤ 220KB。
当前全部资产都在线内，最大的是 `hero_player.glb` 381KB。

**若将来还要再砍首屏**：唯一值得动的单点是 `hero_player.glb`——它占首屏 1.27MB 的 **29%**，
其中贴图占它自身的 **65%**。把它的 baseColor/normal 从 1024 降到 512 约省 200KB。
（2026-07-25 判定不必要，未执行。）

### 13.4 新增 Meshy 角色资产检查表

- [ ] prompt 含 `stylized, low-poly, game asset, fantasy` + `side profile view facing left`（项目前方 = -Y）
- [ ] prompt **不含** `realistic, photorealistic`（与既有 lowpoly 风格冲突）
- [ ] 原件下载到 `art/_src/units/` 或 `art/_src/heroes/`（Meshy 服务端只保留 3 天）
- [ ] `js/assets/manifest.js` 里该 key 有 `polyBudget`（压缩管线的面数目标）与 `singleMesh: true`
- [ ] 跑 `npm run compress:assets -- --format webp --only <key>`，确认输出 ≤ 上一节的单资产上限
- [ ] 起本地 http server 目视：朝向对不对（不对就加 `rotY`）、脚底有没有悬浮/沉地、
      开 Bloom 时有没有整体泛光（有就说明 emissive 没删干净）
- [ ] 敌我两侧都看一眼：整体色调偏移 + 底座光环能不能在俯视小尺寸下 0.5 秒内区分（§12 第 2 条）
- [ ] 首屏资产变动的话，重算 `getBootAssets()` 那组的总字节数并更新 §13.3

---

*规范版本：v1（§1–§12，Blender 手工管线）+ v2 补注（§13 与文首阅读须知，Meshy + 压缩管线，2026-07-25）
· 与当前 `config.js` 单位 key、`js/assets/manifest.js` 的 `polyBudget` / `singleMesh`、队伍色、战场尺度对齐。
后续改 key、面数预算或尺度必须同步改本文档。*
