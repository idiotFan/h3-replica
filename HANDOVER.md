# 英雄无敌 3D · 接手文档

> Three.js 复刻《英雄无敌3》：异形岛屿大地图探索 + 六边形回合制战场 + 英雄成长 + 敌方阵营 AI  
> 线上：**https://h3.idiotfan.wang**  
> 仓库：**https://gitee.com/idiotfan/h3-replica**（master 分支）
> 技术栈：Three.js r160（CDN + importmap）· 纯 ES Module · 零构建 · Blender glb 资产

---

## 一、快速开始

### 本地运行
```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```
> 必须 http server，不能 file:// 打开（ES Module + CDN 跨域限制）。

### 重新生成模型

> ## ⚠️ 危险：`gen:blender` / `gen:glb` 会**覆盖 Meshy 重制的模型**
>
> 这两个脚本产出的是**早期 Blender 原语模型**，会把 `art/export/**` 下 17 个角色 glb
>（15 兵种 + 2 英雄，均为 2026-07-24~25 Meshy AI 重制并跑过压缩管线的版本）**整体写回旧版**。
> `art/_src/` 里有 Meshy 原件可以重跑 `npm run compress:assets` 恢复，
> 但 `art/_src/` **不在 git 里**（见 `.gitignore`），一旦本机丢失就再也回不来了。
>
> **要重新出角色模型，用 §4.4b 的压缩管线，不要用这两个脚本。**
> 这两个脚本现在只对 5 个建筑（`castle_*` / `mine_*`）是安全且唯一的复现手段——
> 建筑没有 Meshy 版，`art/_src` 下也没有它们的副本。
> 若只想重出建筑，请先备份 `art/export/units` 和 `art/export/heroes`。

```bash
npm install                    # 装依赖（three / gltf-transform / sharp / meshoptimizer）
npm run compress:assets -- --format webp   # ★ 常规路径：从 art/_src 压出上线资产（§4.4b）
npm run gen:blender            # ⚠ 仅建筑安全：Blender 导出全部 22 个原语模型
npm run gen:glb                # ⚠ 同上，Node + three.js 备用导出，质量更低
```

### 发布到线上（惯例：每次更改完都要发布）

```bash
./scripts/deploy.sh            # 一键发布：rsync 到 tap-vps:/var/www/h3 + 自动验证 HTTP 200
```

**前置条件**：本机 `~/.ssh/config` 里有 `tap-vps` 别名且免密可登（`ssh tap-vps true` 验证）。

**同步范围**：整个项目目录，但排除 `node_modules` / `.git` / `*.md` / `tests` / `scripts` /
`.claude` / `.opencode` / `.trae` / `.venv` / `.env` / `MESHY_API_KEY*` / `art/preview` / `art/_src` /
`*.bak*` / `package-lock.json` / `.gitignore` / `__pycache__` / `.DS_Store`
——**交接/评审文档、测试脚本、构建脚本（含 ssh 别名和服务器路径）、美术原件都不会暴露到公网**。
新增源码/资产文件无需登记，rsync 自动带上；新增«不该公开»的文件要记得往 `scripts/deploy.sh` 的 `--exclude` 里加。

`sw.js` 也在 `--exclude` 里，但那是因为它要**单独走第 4 步**：注入 `__BUILD_VERSION__` 后才上传，
且刻意放在最后一步，保证新 SW 生效时其余资源已全部就位。

`--delete` 不会删除被 `--exclude` 的文件，所以 deploy 第 3 步会 ssh 到服务器做一次幂等清理
（删历史遗留的 `*.md` / `scripts/` / `art/preview` / `art/_src` / `tests/` / `node_modules/` / `*.bak*` / `__pycache__`），
第 5 步再逐个 curl 校验这些路径确实已经 403/404。

**发布前自检**（改动大时建议全跑）：
```bash
# 改了模型（scripts/blender_export_models.py）先重新导出
npm run gen:blender
# 本地回归：起服务 + 冒烟 + 核心 e2e
python3 -m http.server 8000 &
node tests/homm_smoke.mjs "http://localhost:8000/?smoke=map" 40   # 须 SMOKE_RESULT: OK
node tests/homm_e2e.mjs                                           # 须 0 失败
```

**发布后校验**：
```bash
# 抽查线上与本地文件一致（md5 应相同）
md5 -q js/main.js; curl -s https://h3.idiotfan.wang/js/main.js | md5
# 线上冒烟（可选，冷缓存时首载偏慢属正常）
node tests/homm_smoke.mjs "https://h3.idiotfan.wang/?smoke=map" 60
```

**回滚须知**：`rsync --delete` 会让服务器与本地完全一致，服务器上**没有历史版本**；项目已纳入 git 版本控制（仓库 https://gitee.com/idiotfan/h3-replica，master 分支），可用 `git checkout <commit>` 回到历史版本再发布。建模脚本另有 `.bak*` 备份可用。

线上由 nginx 静态托管 + Let's Encrypt SSL（certbot 自动续期）。nginx 配置在 VPS `/etc/nginx/sites-available/h3.idiotfan.wang`，网站根目录 `/var/www/h3`。

### 自动化测试
测试脚本在项目 `tests/`（通过 Chrome CDP 驱动 headless 浏览器，需先起 8000 端口服务）：
```bash
node tests/homm_smoke.mjs "http://localhost:8000/?smoke=map" 30   # 冒烟
node tests/homm_e2e.mjs                                           # 核心功能
node tests/homm_e2e6.mjs                                          # 难度机制（警戒圈/成长/禁斜穿）
node tests/homm_e2e7.mjs                                          # 模型朝向（八方向，防「倒着走/横着走」回归）
node tests/homm_e2e8.mjs                                          # 战斗 AI 战术决策（集火残血/优先射手/避反击）
node tests/homm_shot.mjs "http://localhost:8000/?smoke=battle" 12 /tmp/shot.png  # 截图
```
6 轮 e2e 共 **110 项断言**（按 `check()` 调用数实测：e2e 23 / e2e2 18 / e2e3 23 / e2e4 20 /
e2e5 17 / e2e6 9，其中 e2e6 有 1 项是地形不满足时的跳过分支），覆盖移动/战斗/招募/技能/
法术/存档/敌方 AI/难度机制/部署。另有 `homm_smoke` / `homm_pixels*` / `homm_shot` 4 个工具脚本。

> `tests/homm_e2e3.mjs` 曾长期误点一个不存在的 `#btn-start`（开始画面早就改成三个难度按钮
> `[data-diff]` 了），2026-07-25 已修复。改开始画面 DOM 时记得同步这里。

---

## 二、项目结构

```
K3版H3/
├── index.html               # 入口页（importmap + UI 骨架 + 加载画面）
├── manifest.json            # PWA 清单（应用名/图标/主题色，支持"添加到主屏幕"）
├── sw.js                    # Service Worker（本地资源 cache-first、CDN stale-while-revalidate）
├── css/style.css            # 全部样式（CSS 变量 + 响应式 + 移动端）
├── js/
│   ├── config.js            # ★ 单位/法术/技能/宝物/地图尺寸等基础定义（不随难度变）
│   ├── difficulty.js        # ★ 难度数值体系（easy/normal/hard 三档，所有可调数值集中于此）
│   ├── utils.js             # 噪声/缓动/Tween/六边形数学/音效/资源释放
│   ├── textures.js          # 程序化纹理（地面噪点/水面波纹/天空穹顶/云/太阳月亮）
│   ├── models.js            # ★ 原语模型工厂（glb 加载失败时的回退）
│   ├── map.js               # ★ 冒险大地图（地形/寻路/对象/敌方 AI/日夜循环/序列化/战争迷雾/书签）
│   ├── battle.js            # ★ 六边形战场（回合/伤害/技能/法术/粒子/特效/AI/结算动画）
│   ├── ui.js                # ★ DOM UI（资源栏/英雄栏/战场栏/模态框/魔法书/CG/新手引导）
│   ├── minimap.js           # 小地图（Canvas 2D 绘制 + 视窗框 + 迷雾同步）
│   ├── main.js              # ★ 主控制器（渲染器/PMREM/Bloom/相机/输入/状态/部署/启动流程）
│   └── assets/
│       ├── manifest.js      # glb 资产清单（path ↔ unit key 映射）
│       ├── loader.js        # GLTFLoader 封装（缓存/分阶段懒加载/失败回退）
│       └── factory.js       # 统一工厂（glb 优先，回退 models.js 原语）
├── art/
│   ├── export/              # ★ 上线资产：22 个 glb，合计 3.69MB（3,864,140 字节）
│   │   ├── units/           # 15 兵种（5 基础 + 5 精锐 + 5 野怪），2.45MB，全部 Meshy 重制+压缩
│   │   ├── heroes/          # 玩家/敌方英雄 2 个，708KB，Meshy 重制+压缩
│   │   └── buildings/       # 城堡×2 + 矿场×3，567KB，仍是 Blender 原语导出（未进压缩管线）
│   ├── audio/
│   │   └── bgm_map.mp3      # 248KB，MusicGen 生成的地图 BGM（js/utils.js 的 BGM_SRC）
│   ├── _src/                # ⛔ 不入 git、不上线：Meshy 原件 154MB（唯一副本！）
│   │   ├── units/ heroes/   #    压缩管线的输入（118MB + 17MB）
│   │   ├── blender_elite/   #    被 Meshy 版替换掉的旧 Blender 精锐兵 5 个（568KB）
│   │   └── _export_bak/     #    2026-07-25 从 art/export 搬来的 19 个 *.glb.bak/.bak2（17MB）
│   └── preview/             # ⛔ 不入 git、不上线：离线渲染的对比预览图 31MB
├── scripts/
│   ├── compress_assets.mjs       # ★ glb 压缩管线：art/_src → art/export（§4.4b）
│   ├── meshy_gen.mjs             # Meshy AI 文生 3D（需 MESHY_API_KEY，§7.1）
│   ├── musicgen_bgm.py           # 本地 MusicGen 生成 BGM（§7.2）
│   ├── blender_export_models.py  # ⚠ Blender 无界面批处理导出（会覆盖 Meshy 模型）
│   ├── gen_glb.mjs               # ⚠ Node 备用导出（同上）
│   ├── render_previews.py        # 生成 art/preview 下的对比图
│   └── deploy.sh                 # ★ 一键部署 + sw.js 版本号注入 + 远端清理 + 验证
├── tests/                   # 10 个 CDP 脚本（6 轮 e2e + smoke/pixels/shot），不上线
├── ART_SPEC.md              # 美术规范（面数/贴图/动画/命名/优先级）
├── HANDOVER.md              # 本文档（不公开到线上，deploy.sh 排除）
├── FIXES-2026-07-25.md      # 2026-07-25 修复轮次清单（P0/P1/P2 + 验证方式 + 残余风险）
└── package.json
```

> **体积口径提醒**：`art/export` 目录曾一度显示 21MB，那 17.8MB 全部是 `*.glb.bak/.bak2`
> 备份废料。`deploy.sh` 一直有 4 条 `--exclude '*.bak*'` + 服务端 `find -delete` 兜底，
> **这些备份从来没有部署上线过**，线上包一直是 3.69MB。2026-07-25 已把它们搬到
> `art/_src/_export_bak/`，目录现在如实显示 3.7MB。

---

## 三、架构概览

### 游戏状态机
```
开始画面(start) ──开始游戏──> 大地图(map) ──遇敌──> 战场(battle)
                                  ↑                    │
                                  └── 胜利/撤退 ───────┘
```
`state.mode` 控制主循环渲染哪个场景（`mapScene` / `battleScene`）。

### 数据流
```
config.js（基础定义）+ difficulty.js（难度数值，运行时 DIFF 全局生效）
  ↓
main.js（state 全局状态 + 输入 + 主循环）
  ↓
map.js（WorldMap）──事件──> main.js ──> battle.js（Battle）
  ↓                            ↓
ui.js（DOM 更新）          ui.js（战场 UI）
```

### 存档系统
- `localStorage['homm3d_save']`，JSON 序列化
- 保存：地形类型压缩为单字符（w/g/f/m）+ 对象列表 + 英雄 + 资源/技能/兵营 + **难度 key（`diff`）**
- 自动保存：结束回合 / 战斗胜利 / 关闭页面时
- 读取：开始画面显示「继续游戏」按钮，读档时 `applySavedState` 先 `setDifficulty` 恢复难度，再构建世界

---

## 四、核心系统说明

### 4.1 大地图（map.js）
- **异形岛屿**：径向衰减 + 噪声生成不规则海岸线，外圈强制海水，四角必是海
- **A\* 寻路**：MinHeap 实现，对角线 1.5 倍 + 森林 2 倍开销 + 禁止穿墙角
- **对象系统**：`this.objects` Map（key="x,y"），含 castle/mine/pickup/artifact/monster/enemyHero/enemyCastle
- **野怪警戒圈**：英雄踏入野怪相邻 8 格（`guardAt`）即被拦截开战，战胜后自动拾取脚下守护物（`onBattleEnd` 里 `collectAt`）；矿场/宝物守卫因此真正有效
- **野怪成长**：每 3 天线性增长（`growMonsters`，基于 `baseCounts` 基础值，增量 `monsterGrowRate`，上限 `monsterGrowMax`，均受难度控制），大股野怪出生时拆 2-3 队列并记录基础兵力
- **敌方 AI**：`enemyChaseRange` 格内追击玩家，否则游荡；每 `enemyReinforceInterval` 天敌方城堡增援（上限 `enemyMaxHeroes`），敌方英雄军队系数 `enemyArmyDayRate`、属性加成 `enemyHeroAtkRate/DefRate` 均随难度变化
- **寻路斜穿**：对角移动要求两侧正交格都可通行（严格禁穿墙角）
- **日夜循环**：240 秒一昼夜，7 关键帧插值天空/光照/星月/灯火
- **WASD 平移**：capture 阶段监听，target+camera 同步移动

### 4.2 战场（battle.js）
- **六边形网格**：InstancedMesh 117 实例（倒角挤出体），instanceColor 高亮
- **回合制**：速度排序 + 等待/防御/士气高涨
- **伤害公式**：`base = randInt(dmg[0],dmg[1]) * count`，攻高于防每点 `damageAtkFactor` 加成（上限 `damageAtkCap` 点），防高于攻每点 `damageDefFactor` 削减（上限 `damageDefCap` 点）；射手近战 `shooterMeleeMult`、祝福 `blessBonus`、防御加成 `defendBonus` 均受难度控制
- **士气/幸运**：玩家与敌方均有士气高涨概率（`morale.player/enemy`，玩家额外受领导术加成），幸运仅玩家（`luckChance`×技能等级）
- **法术系统**：7 种（神箭/治疗/火球/加速/减速/祝福/连环闪电），每回合限一次
- **技能树**：8 种（进攻/防御/魔力/后勤/智慧/理财/幸运/领导）
- **特效**：粒子系统 600 池、折线闪电、震屏、受击红闪、死亡倒地

### 4.3 资产管线（assets/）
- `manifest.js`：每个单位 key 对应一个 glb path，`path: null` 时回退原语
- `loader.js`：**分阶段懒加载**——`getBootAssets()` 返回首屏必需的 **9 个 glb**（玩家英雄 1 +
  城堡 1 + 矿场 3 + 初始兵种 4：pikeman/archer/griffin/swordsman），**首屏阻塞下载 1,327,244 字节 ≈ 1.27MB**；
  `getBackgroundAssets()` 返回进入游戏后后台加载的 **13 个 glb**（5 野怪 + 5 精锐 + champion +
  敌方英雄 + 敌方城堡），**2,536,896 字节 ≈ 2.42MB**。两组相加正好 3,864,140 字节 = `art/export`
  目录总量，**22 个 glb 全部被引用，无孤儿资产**（2026-07-25 实测）
- 首屏 9 个文件明细：hero_player 372KB / griffin 174KB / castle_player 161KB / swordsman 155KB /
  pikeman 126KB / archer 97KB / mine_sawmill 92KB / mine_gold 62KB / mine_ore 58KB。
  将来若还要再砍首屏，唯一值得动的单点是 `hero_player.glb`（占首屏 29%，其中贴图占它自身 65%），
  把 baseColor/normal 从 1024 降到 512 约省 200KB
- `preloadGroup(groups)` 按分组加载；加载完成后 `world.refreshObjectMeshes()` 自动把原语回退的对象替换为 glb
  - ⚠ **`refreshObjectMeshes()` 必须重放战争迷雾**：新建的 mesh 默认 `visible=true`，
    后台资产换入时会把雾下对象一起点亮（2026-07-25 实测 41 个雾下对象有 20 个突然显形）。
    修复见 `map.js` 的 `refreshObjectMeshes()` 末尾
- `factory.js`：`createUnit(type, side)` → 有 glb 用 glb（clone + 队伍色 + 底座环），否则 `makeUnit(type, side)`
- **队伍色**：glb 中名为 `TeamColor` 的网格/材质自动替换为蓝/红
- **翅膀/旗帜**：名为 `WingL/WingR/Flag` 的节点自动绑定待机动画

### 4.4 模型生成（旧 Blender 管线，已被 Meshy + 压缩管线取代）

> ## ⚠️ 危险：这两个脚本会覆盖 Meshy 重制的 17 个角色模型
>
> `blender_export_models.py` / `gen_glb.mjs` 产出的是 2026-07-24 之前的**原语建模版本**，
> 一跑就把 `art/export/units/*.glb` 和 `art/export/heroes/*.glb` **全部写回旧版**，
> 且不会提示、不会备份。恢复办法只有重跑 §4.4b 的压缩管线，
> 而它的输入 `art/_src/` **不在 git 里**——本机丢了就彻底没了。
>
> **角色模型现在只有一条正确的重生成路径：§4.4b 的 `npm run compress:assets`。**

- **Blender 脚本**（`scripts/blender_export_models.py`）：bmesh 构建原语 + 倒角修改器 + 平滑着色，22 个资产批处理导出
- **Node 脚本**（`scripts/gen_glb.mjs`）：three.js GLTFExporter 导出，质量稍低但无需 Blender
- **现在唯一还该用它的场景**：重出 5 个建筑（`castle_player/castle_enemy/mine_sawmill/mine_ore/mine_gold`）。
  建筑没有 Meshy 版，`art/_src` 下也没有副本，`npm run gen:blender` 是它们唯一的复现手段。
  **跑之前务必先把 `art/export/units` 和 `art/export/heroes` 拷出去。**

### 4.4b 模型压缩管线（scripts/compress_assets.mjs）★ 2026-07-25 新增

Meshy 原件每个 7–10MB（95% 是 4 张 2048² 贴图），**未压缩绝不允许部署**。压缩管线把
`art/_src/**` 的原件压成可上线的 `art/export/**`。

```bash
npm run compress:assets -- --format webp        # 线上这批就是这么出的
npm run compress:assets:dry                     # 只算不写
node scripts/compress_assets.mjs --format webp --only pikeman2,archer2
```

**为什么 Meshy 原件绝不能直接上线**：单个 7–10MB，其中约 95% 是 4 张 2048² 贴图。
22 个原件合计 **136MB**，首屏那 9 个就有 40MB+，在国内移动网络下等同于打不开。
而且 Meshy 导出 `emissiveFactor=[1,1,1]` + `emissiveTexture`，会顶穿 `main.js` 的
UnrealBloom `threshold 0.85`，整个模型糊成一团光。

管线做了四件事：

| 步骤 | 做法 | 为什么 |
|------|------|--------|
| 删 emissive | `emissiveTexture` 删除、`emissiveFactor` 归零 | 否则顶穿 Bloom threshold 0.85 糊成一团光（运行时 `manifest.js` 的 `SINGLE_MESH_EMISSIVE=0` 再兜一层） |
| 几何简化 | meshopt `simplify`，目标面数直接读 `js/assets/manifest.js` 的 `polyBudget`（单一事实来源） | 面数预算见 `ART_SPEC.md` §3 |
| 贴图 resize + 重编码 | 普通单位 512、英雄/龙 1024、MR 256；`--format webp` 走 `EXT_texture_webp` | three r160 **原生**支持 `EXT_texture_webp`；**不用** Draco / meshopt 压缩 / KTX2，因为 `js/assets/loader.js` 没有注册 `DRACOLoader` / `MeshoptDecoder` / `KTX2Loader`，用了就直接加载失败 |
| metallicRoughness 取舍 | 按通道标准差决定：低于 `mrFlatThreshold` 退化成标量，否则保留 @256 | MR 多数是低频遮罩，一刀切删会丢掉少数真有细节的资产 |

**常用参数**（完整清单见 `scripts/compress_assets.mjs` 顶部的 `DEFAULTS`）：

| 参数 | 默认 | 说明 |
|------|------|------|
| `--format` | `jpeg` | **线上这批用的是 `webp`**，重跑必须带 `--format webp` 才能复现 |
| `--texture-size` | `512` | 普通单位贴图边长 |
| `--hero-texture-size` | `1024` | 应用于 `--big-texture-assets`（默认 `hero_player,hero_enemy,dragon`） |
| `--mr-size` / `--mr-quality` | `256` / `90` | metallicRoughness 是数据不是颜色，质量给高 |
| `--quality` / `--normal-quality` | `80` / `85` | 法线图对压缩噪声更敏感，质量更高 |
| `--only` / `--exclude` | — | 逗号分隔的资产名白/黑名单 |
| `--dry-run` | off | 只算不写（= `npm run compress:assets:dry`） |
| `--allow-new-dirs` | off | 默认**拒绝**在 `--out` 下新建目录，防止写到游戏根本不引用的路径 |

> **不要随手调这些默认值。** 当前 `art/export` 这批线上资产就是用
> 「普通单位 512 / 英雄龙 1024 / MR 256 / webp」出的，改了参数就不能复现线上资产；
> 而体积目标（≤8MB）已经有 2.2 倍余量，没有正当理由动它。

**⚠ `art/_src/` 是这批 Meshy 原件的唯一副本，且已进 `.gitignore`（不在 git 里，删了就没了）。**
压缩不可逆，所以管线永远从 `art/_src` 读、往 `art/export` 写，重跑不会二次劣化。
`art/_src/blender_elite/` 存的是被 Meshy 版替换掉的旧 Blender 精锐兵；它在 `art/export`
下没有对应目录，全量重跑时会被「不新建目录」安全闸自动跳过，`art/_src/units/*2.glb`
（Meshy 原件）才是实际生效的来源。

压缩结果（2026-07-25，`--format webp`，22 个上线 glb 合计 **3.69MB**）：

| 资产 | 原件 | 压后 | 面数 | 资产 | 原件 | 压后 | 面数 |
|---|---|---|---|---|---|---|---|
| hero_player | 8.84MB | 372KB | 4000 | pikeman2 | 8.79MB | 164KB | 1799 |
| hero_enemy | 8.65MB | 336KB | 3998 | archer2 | 7.59MB | 122KB | 1798 |
| dragon | 7.57MB | 289KB | 6000 | griffin2 | 7.04MB | 192KB | 3799 |
| champion | 8.71MB | 201KB | 3999 | swordsman2 | 7.31MB | 184KB | 2799 |
| griffin | 7.74MB | 174KB | 3500 | champion2 | 7.81MB | 273KB | 4200 |
| swordsman | 7.61MB | 155KB | 2500 | orc / skeleton / ghost / pikeman / archer / wolf | 6.8–10.4MB | 88–156KB | 1500–2500 |

城堡 / 矿场 5 个仍是 Blender 原件（58–198KB，本来就小，未进压缩管线，`art/_src`
下没有副本，靠 `npm run gen:blender` 复现）。

**关于那 19 个 `.bak/.bak2` 备份（共 17.8MB）**：它们曾经躺在 `art/export` 下，让目录看起来
有 21MB。**2026-07-25 已用 `mv` 搬到 `art/_src/_export_bak/`**（保留原目录结构，一条 `mv` 可还原），
`art/export` 现在如实显示 3.7MB。

选 `mv` 而不是 `rm`，是因为其中 `hero_*.glb.bak2` 这类中间版本在 `art/_src` 里**没有对应物**
（8.1MB，而 `art/_src` 里的原件是 9.27MB，不是同一个东西），`rm` 会不可逆地销毁它们。
另外 5 个精锐兵 `.bak2` 与 `art/_src/blender_elite/` 下同名文件 md5 逐一相同，本就是冗余副本。

**⚠ 别把这一项当成线上性能缺陷。** `deploy.sh` 有 4 条 `--exclude '*.bak*'`，远端清理步骤还有
`find "$DEST" -type f -name '*.bak*' -delete` 兜底，**这些备份从来没有部署上线过**，
用户端一直下的就是 3.69MB。这只是本地工作区不整洁，和「用户拿不到 SW 更新」那种真线上缺陷
不是一个量级，排优先级时别混为一谈。

### 4.5 难度数值体系（difficulty.js）★ 2026-07-23 新增
所有随难度可调的数值集中于此文件，`config.js` 只保留不随难度变的基础定义（单位/法术/技能/宝物/地图尺寸）。

**三档难度**：开始画面选择「简单 / 普通 / 困难」按钮即以该难度开始新游戏；存档保存 `diff` 字段，读档自动恢复。

| 参数组 | 简单 | 普通 | 困难 | 说明 |
|--------|------|------|------|------|
| 初始资源 | 5000金/20木/20矿 | 3000/15/15 | 2000/10/10 | `startRes` |
| 城堡收入 | 600/天 | 500 | 400 | `castleIncome` |
| 移动力上限 | 18 | 15 | 13 | `moveMax` |
| 野怪兵力倍率 | 0.8 | 1.0 | 1.2 | `monsterScale` |
| 野怪成长率/上限 | 0.06/+50% | 0.10/+100% | 0.15/+150% | `monsterGrowRate/Max`（线性增量，非复利） |
| 决胜战兵力倍率 | 0.7 | 1.0 | 1.4 | `bossScale`（Boss 龙巢 + 敌方城堡守军） |
| 敌方军队系数 | 0.4/0.25/0.3 | 0.6/0.4/0.45 | 0.8/0.5/0.6 | `enemyArmyDayRate`（骷髅/兽人/恶狼） |
| 敌方幽灵/龙解锁日 | 14/20 天 | 10/18 | 8/14 | `enemyGhostDay` / `enemyDragonDay` |
| 敌方增援 | 每7天/上限1 | 每5天/上限2 | 每4天/上限3 | `enemyReinforceInterval/MaxHeroes` |
| 敌方追击/每日步数 | 6格/6步 | 9格/8步 | 12格/10步 | `enemyChaseRange` / `enemyStepsPerDay` |
| **玩家**出手攻方系数/上限 | 0.06/50 | 0.05/40 | 0.04/30 | `playerDamageAtkFactor/Cap`（越大玩家越强） |
| **玩家**出手防方系数/上限/下限 | 0.02/20/0.35 | 0.025/28/0.30 | 0.03/35/0.25 | `playerDamageDefFactor/Cap` + `playerDamageMinMult` |
| **敌方**出手攻方系数/上限 | 0.04/30 | 0.05/40 | 0.06/50 | `enemyDamageAtkFactor/Cap`（与玩家组**反向**） |
| **敌方**出手防方系数/上限/下限 | 0.03/35/0.25 | 0.025/28/0.30 | 0.02/20/0.35 | `enemyDamageDefFactor/Cap` + `enemyDamageMinMult` |
| 射手贴身折扣 | 0.6 | 0.5 | 0.4 | `shooterMeleeMult`（实测只对玩家生效） |
| 防御/祝福加成 | 1.30/1.35 | 1.20/1.20 | 1.15/1.12 | `defendBonus` / `blessBonus`（同上，只对玩家生效） |
| 士气（玩家/敌方） | 12%/0% | 10%/2% | 8%/5% | `morale.player/enemy` |
| 幸运 | 7% | 5% | 4% | `luckChance`（仅玩家 `att.side===0` 判定） |
| 英雄初始魔法 | 12 | 10 | 8 | `heroStart.mp/mpMax` |
| 升级经验阈值 | 80×等级 | 100×等级 | 120×等级 | `xpThreshold` |

> **★ 单调性约定（改数值前必读，`difficulty.js` 文件头也写了）**
>
> 每个字段在 easy → normal → hard 之间必须单调，方向指向「对玩家更难」。
> 最容易踩的坑是**敌我对称字段**：伤害倍率系数同时作用于玩家出手和敌方出手，
> 只用一组系数的话，「困难档调低攻击系数」会把敌方输出一起削弱——方向反了。
> 所以 2026-07-25 起伤害系数按**攻击方阵营**拆成 `player*` / `enemy*` 两组，
> 由 `damageCoef(side)` 分发（`side` 0=玩家 / 1=敌方），两组必须反向变化。
> `battle.js` 的 `calcDamage()` 与伤害预估都必须走同一个 `damageCoef()`，否则预估和实伤对不上。
>
> `shooterMeleeMult / defendBonus / blessBonus / luckChance` 实测只对玩家一方生效
>（敌方单位无 `shots`、敌方英雄无法术/技能、敌方 AI 仅在找不到目标的兜底分支里防御），
> 因此按「玩家收益随难度递减」处理，不要照着「敌我通用」的直觉去调。
>
> `bossScale` 由 `map.js buildObjects()` 里的 `const bs = n => Math.max(1, Math.round(n * DIFF.bossScale))` 消费。
> **`Math.max(1, …)` 不可省略**：简单档任何 `count=1` 的兵种乘 0.7 会被 round 成 0，整队消失。
> 实测结果：Boss 龙/幽灵/兽人 简单 1/7/11 · 普通 2/10/15 · 困难 3/14/21；
> 敌堡 兽人/骷髅/狼/幽灵 简单 8/13/7/4 · 普通 12/18/10/6 · 困难 17/25/14/8。

**全局平衡修正（所有难度生效，改 config.js）**：
- 弓箭手 HP 10→12、弹药 12→16；骑士速度 9→8、精锐骑士 10→9
- 兵营升级成本 2000/10/10 → 1500/5/5；金矿收入 400→300
- 法术等级系数提高：魔法神箭 10→15/级、治疗 15→20/级、火球 10→15/级
- 撤退惩罚：损失 25% 兵力 + 魔法值清零

**改动数值的指引**：
- 改某档难度的数值 → 编辑 `js/difficulty.js` 对应档位字段
- 改不随难度变的基础数值（单位属性/法术耗魔/技能上限/地图尺寸）→ 编辑 `js/config.js`
- `DIFF` 是 `export let`，各模块 `import { DIFF }` 后通过 ES module live binding 读到最新值；`setDifficulty(key)` 必须在构建世界/英雄前调用

### 4.6 渲染管线（main.js）★ 2026-07-23 新增
- **PMREM 环境贴图**：`PMREMGenerator.fromScene()` 用程序化天空+半球光预卷积环境贴图，赋值给 `mapScene.environment` 和 `battleScene.environment`；PBR 材质（金属盔甲/铁器/金边）自动获得真实环境反射，告别"塑料纯色"观感
- **Bloom 后期处理**：`EffectComposer` + `RenderPass` + `UnrealBloomPass` + `OutputPass`；`threshold 0.85` 只让 emissive 元素发光（龙眼/骷髅眼/幽灵眼/城堡窗口/金矿水晶/法术特效）；low 画质自动关闭省 GPU，medium/high 开启
- **场景切换**：`renderPass.scene` 在 `loop()` 内按 `state.mode` 动态切换 mapScene/battleScene，确保后期处理作用于当前活跃场景
- **画质分级**：`applyQuality()` 控制 shadow map（low 0 / medium 1024 / high 2048）+ Bloom 开关 + pixelRatio

### 4.7 Service Worker 更新机制（sw.js + index.html + deploy.sh）★ 2026-07-25 重写

> **这是整个项目最容易踩坑的地方。** PWA 的 SW 一旦装错，老用户会被旧代码永久钉死，
> 而你在自己的浏览器上（清过缓存 / 无痕窗口）**永远复现不出来**。改这三个文件之一时请通读本节。

#### 完整链路

```
deploy.sh                     index.html                        sw.js
──────────                    ──────────                        ─────
1. 算 BUILD_VERSION           4. register(updateViaCache:'none')  7. install → 预缓存 SHELL → skipWaiting()
   = UTC时间戳 + 源码哈希      5. reg.update() 主动检查            8. activate → 删旧版本 cache → clients.claim()
2. sed 注入到 sw.js           6. controllerchange → reload()      9. message: SKIP_WAITING / GET_VERSION
3. sw.js 最后一步上传
```

#### 四个必须同时成立的条件（少一个更新链就断）

| # | 条件 | 在哪实现 | 漏了会怎样 |
|---|------|----------|-----------|
| 1 | **sw.js 字节每次发布都变** | `deploy.sh` 用 `sed` 把 `__BUILD_VERSION__` 换成「UTC 时间戳 + 前端源码 shasum」，并做 `cmp -s` 自检：注入后字节没变就**终止部署** | 浏览器按字节比对，字节没变 = 没有新 SW，永不更新 |
| 2 | **取 sw.js 时绕过 HTTP 缓存** | `register('./sw.js', { updateViaCache: 'none' })`；`deploy.sh` 还会校验线上 `sw.js` 的 `Cache-Control` 是不是 `no-cache`，不是就告警 | nginx 强缓存头会让浏览器拿旧字节去比对，永远发现不了新版本 |
| 3 | **主动调用 `reg.update()`** | `index.html` 的 `checkUpdate()`：注册后立刻查一次 + `visibilitychange` 切回前台 + `online` 断网重连，节流 60 秒 | 浏览器只在导航时做「软更新」，且对 sw.js 有 **24 小时启发式节流**——**光靠用户正常导航根本不会去比对新字节**。这是 2026-07-25 修的 P0 的一半 |
| 4 | **注册代码本身一定要跑到** | `index.html` 底部：`readyState==='complete'` 立即跑，否则 `load` 事件 + **`setTimeout(bootOnce, 3000)` 兜底**，`booted` 标志保证只跑一次 | **P0 的另一半，也是更致命的一半**：注册原本整个塞在 `window.addEventListener('load')` 里，而本页依赖 jsdelivr（three.js）和 fonts.loli.net。这两个第三方一慢/一挂，`load` 事件就**永不触发**，register 和更新检查一起丢失——老用户不是「更新慢」，是**压根没有任何更新检查在跑**。国内网络下这是很现实的场景（项目本来就是因为这个才用 loli.net 镜像）。无外网沙箱里实测：未加兜底时 SW 完全装不上、`readyState` 永远停在 `interactive`；加 3 秒兜底后立刻正常 |

#### 接管与刷新

- 新 SW 进入 `installed`（waiting）→ 页面 `promote()` 发 `{type:'SKIP_WAITING'}` → SW 调 `self.skipWaiting()` 立刻接管
- 接管触发 `controllerchange` → 页面 `location.reload()` 拿新代码
- **防死循环用「时间窗节流」而不是一次性标志**：`sessionStorage['h3-sw-reload-at']` + 10 秒窗口。
  一次性标志会让长开的标签页在第二次发版时永远收不到更新；时间窗既挡得住
  `reload → controllerchange → reload` 的病态循环，又不影响之后的正常轮换
- **首次安装不刷新**：进页面时 `navigator.serviceWorker.controller` 为空说明是首装，
  此时刷新会平白打断正在进行的游戏，所以 `hadController` 为 false 时直接 return

#### 缓存策略（`sw.js` 的 `fetch` 分支，从上到下）

| 匹配 | 策略 | 理由 |
|------|------|------|
| 非 GET / 非 http(s) / `/sw.js` 自身 | 不拦截 | sw.js 永远直连网络，绝不缓存 |
| `CDN_HOSTS`（jsdelivr / fonts.loli.net / gstatic.loli.net） | stale-while-revalidate | 离线可用；版本固定在 importmap 里 |
| 本地 `art/` 或美术扩展名 | cache-first | 大文件，内容变了必然改文件名或走新版本 cache |
| 本地代码类（html/js/css/json） | **network-first** | 发新版时刷新即可拿到新代码，不会被旧缓存钉死。非导航请求用 `cache:'no-cache'` 走条件请求（服务端 304，开销极小）；导航请求保持原样 `fetch(req)`——从 `mode:'navigate'` 的 Request 没法安全重建，且服务端 30x 时用重定向后的响应回应导航请求会直接抛错 |

#### 自检手段

- **线上**：DevTools Console 里
  ```js
  navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' });
  navigator.serviceWorker.addEventListener('message', e => console.log(e.data));
  // → { type:'VERSION', version:'20260725...-xxxxxxxx', cache:'homm3d-...' }
  ```
- **本地**：SW 在 localhost 默认**跳过**（避免旧缓存干扰开发）。需要验证生命周期时加 `?sw=1` 显式打开
- `deploy.sh` 第 5 步会自动 curl 校验线上 sw.js 里能读到本次的 `BUILD_VERSION`

#### ⚠ 已知残余风险（尚未处理）

`sw.js` 的 CDN 分支（stale-while-revalidate）里 `e.respondWith()` 拿到的 Promise
在离线/CDN 挂掉时**可能永不 settle**（`cached` 为空且 `fetch` 既不 resolve 也不 reject 时）。
2026-07-25 的动态验证中实测到它的后果：新 SW 已装好并进入 waiting，
但 `waiting → active` 的交接被卡住十几秒不动——因为页面对 jsdelivr/loli.net 的请求
挂在老 SW 的这个分支上。把测试副本的外部依赖剥掉后立刻 3 秒轮换。
**修复方向**：给 CDN 分支的 fetch 加超时兜底（`Promise.race` + timeout），
或在 `cached` 为空时直接放行网络请求不 respondWith。

---

## 五、关键约定

| 约定 | 说明 |
|------|------|
| 单位 key | `config.js` 的 `UNITS` key = glb 文件名 = `manifest.js` 的 key，三者必须一致 |
| 队伍色 | 玩家蓝 `#2c5fa8`，敌方红 `#8a2a2a`；glb 中 `TeamColor` 命名的网格自动着色 |
| 世界单位 | 地图格 `TILE=2`，战场六边形半径 `0.94`，单位站立高度 `UNIT_Y=0.15` |
| 导出朝向 | Blender 面朝 -Y，导出 `+Y Up`，three.js 中 +Z 为正面 |
| 原点 | 角色脚底中心，建筑底座中心地面 |
| 面数 | 步兵 ≤1500，骑乘 ≤4000，龙 ≤6000（详见 `ART_SPEC.md`） |
| 回退 | glb 加载失败自动回退 `models.js` 原语，游戏仍可玩 |

---

## 六、已知待改进项（历史记录 + 各轮优化流水账）

> ⚠️ **本节的优先级已过时，以 §八 为准。** 本节保留下来是因为后半部分是历次优化的流水账
>（做过什么、为什么跳过某些优化），有考古价值；但「已知待改进项」这张表的优先级
> 在 2026-07-25 被 §八 重新排过（最明显的是骨骼动画 P0 → P2）。
> **要看当前该做什么，直接翻 §八。**

| 优先级（旧） | 项目 | 说明 |
|--------|------|------|
| ~~P0~~ → 见 §八（P2） | 骨骼动画 | 22 个 glb 全部无 armature（旧 Blender 版是 bmesh 原语建模，Meshy 版是单 mesh 无骨骼），真骨骼动画需重制 **17 个角色模型**（15 兵种 + 2 英雄；5 个建筑不需要动画），是美术工程；当前用过程动画（移动颠簸+腿摆/攻击前刺/受击红闪/死亡倒地/待机浮动/翅膀披风）覆盖，待美术资源就绪后接 AnimationMixer |
| P1 | 多英雄 | 仅 1 个玩家英雄，H3 支持多英雄分头行动 |
| P2 | 城镇建设 | 当前只有招募 + 兵营升级，缺建筑树 |
| P2 | 法术等级 | 所有法术从开始可用，应绑定魔法塔等级 |
| P2 | 战斗 AI | 当前只射最近/走最近，缺优先击杀低血/利用障碍 |
| P3 | LOD | 大地图单位用 LOD1，战场用 LOD0 |
| P3 | 音效丰富化 | BGM 已换成 MusicGen 生成的 `art/audio/bgm_map.mp3`（248KB，循环播放）；音效仍是 18 种 WebAudio 程序化合成（attack/hurt/spell/move/death/block/turn/select/arrow/fireball 等），可换真实音效文件提升品质 |

### 2026-07-23 成品向优化（已上线）
- **战争迷雾**：单张 CanvasTexture 平面（SS=16 超采样 + Mipmap 双线性过滤）覆盖全图；径向渐变 destination-out 擦出软边圆形视野；未探索 alpha 0.97 近不透明、已探索 0.52 半透明、可见完全透明；`depthTest:false` 确保雾始终覆盖最上层；视野半径随移动力；对象与敌方英雄按可见性显隐；小地图同步迷雾；存档持久化 `explored`
- **新手引导**：`ui.guide()` 长停留可关闭浮层，按 enter/firstWin/castle 三个里程碑首次触发（`localStorage['homm3d_guide']`）
- **移动端战斗日志**：`#battle-log.mobile-show` 紧凑横条，有内容时显示
- **BGM**：`utils.startBgm()/stopBgm()`，进入地图开始、静音时停止。
  ~~程序化五声音阶循环~~ → **2026-07-24 已换成 MusicGen 生成的 mp3**（`BGM_SRC = 'art/audio/bgm_map.mp3'`），
  带淡入淡出 + `bgmGen` 世代号防竞态（400ms 内快切两次静音时，上一次的淡出回调不会把刚启动的 BGM pause 掉）
  + 自动播放被拦截时挂一次性手势监听重试
- **战绩存档**：`localStorage['homm3d_records']` 保存最近 10 局，胜利 CG 显示最佳通关记录

### 2026-07-23 体验优化（已上线）
- **美术+性能优化**：① PMREM 环境贴图——金属盔甲/铁器/金边获得真实环境反射，告别塑料纯色；② Bloom 后期处理——`threshold 0.85` 只让 emissive 元素发光（龙眼橙红/骷髅眼绿/幽灵眼青/城堡窗口暖黄/金矿水晶/法术特效），low 画质自动关闭省 GPU；③ 确认装饰物已是 InstancedMesh（树 trunk+leaf + 石头各 1 draw call）、1600 地块单 PlaneGeometry、战场六边形 InstancedMesh，draw call 已压到个位数
- **资源懒加载**：`loader.js` 分阶段加载——启动加载核心资产 **9 个 glb**（玩家英雄 1 + 城堡 1 + 矿场 3 + 初始兵种 4，共 1.27MB），后台加载剩余 **13 个**（5 野怪 + 5 精锐 + champion + 敌方英雄 + 敌方城堡，共 2.42MB）；`world.refreshObjectMeshes()` 在后台加载完成后自动替换原语回退模型；首屏等待时间减半。详细清单与字节数见 §4.3
- **PWA 离线**：`manifest.json` + `sw.js`，支持"添加到主屏幕"当 App 用；本地资源 cache-first、CDN stale-while-revalidate；仅 https 生效（localhost 跳过避免开发干扰）
- **撤销移动**：`map.js undoMove()` + `#btn-undo` 按钮，移动完成后显示，只能撤销最后一次移动；进入战斗/结束回合后清空
- **存档导出/导入**：设置弹窗加导出/导入按钮，导出下载 JSON 文件，导入校验格式后写 localStorage 刷新生效
- **阴影贴图降级**：`applyQuality` 按画质分级 shadow map（low 0 / medium 1024 / high 2048），减少移动端 GPU 压力
- **战斗结算动画**：`battle.js playEndCinematic()` 慢镜头（timeScale 0.3）1.5 秒 + 金/红粒子（THREE.Points 50 粒子加法混合），胜利 sfx('win') 失败 sfx('lose')
- **地图书签**：长按地块 500ms 标记/取消书签，黄色旋转圆环标记 + 小地图菱形图标；持久化到存档
- **音效补全**：新增 attack/hurt/spell/move(脚步)/death/block/turn/select/arrow/fireball 共 10 个程序化合成音效，`utils.js noiseBurst()` 辅助噪声合成
- **版本控制**：已 `git init`，`.gitignore` 排除 node_modules/.DS_Store/*.log 等

### 评估后跳过的优化项
- **LOD 分级**：地块是单一 PlaneGeometry（非 InstancedMesh 无法单独 LOD），战场单位数量少（≤20），ROI 低
- **KTX2 贴图压缩**：所有纹理是程序化 CanvasTexture 运行时生成，KTX2 离线压缩格式不适用
- **map.js 拆分**：高风险重构，当前 **1588 行**（2026-07-25 实测，见 §十一）虽大但结构清晰，拆分易引入回归
- **i18n 国际化**：工作量大（所有 UI 文案 key 化），当前用户群体为中文，暂不优先

### 2026-07-24~25 AI 美术升级（进行中）
- **Meshy AI 模型重制**：用 Meshy API 重制全部 17 个角色模型（5 野怪 + 5 基础兵 + 5 精锐兵 + 2 英雄），统一 lowpoly 风格 + PBR 贴图
  - 脚本：`scripts/meshy_gen.mjs`，API key 走环境变量 `MESHY_API_KEY`（**绝不写入 git**）
  - prompt 模板：`stylized low-poly <creature>, side profile view facing left, clear limb structure, game asset, fantasy` —— 强制侧面朝向（项目 -Y 前方）
  - 生成后原文件存为 `.bak2` 备份（如 `wolf.glb.bak2`），新模型直接覆盖 `art/export/units/*.glb`
  - **精锐兵 5 个（pikeman2/archer2/griffin2/swordsman2/champion2）已于 2026-07-25 一并换成 Meshy 版**，
    `manifest.js` 里它们已补上 `singleMesh: true`（旧注释说它们是「带 TeamColor/Flag 命名的 Blender 模型」已过期）。
    即便标记漏改，`factory.js` 的 `detectSingleMesh()` 也会按「网格全无名」在运行时自愈，
    不会静默退化成没有队伍色——但声明还是要和事实一致。
  - **新生成的模型必须先跑 4.4b 的压缩管线再部署**（原件 7–10MB，直接上线会把首屏拖垮）
- **MusicGen BGM 替换**：本地部署 Meta MusicGen（audiocraft）生成 30 秒 BGM，替换 `art/audio/bgm_map.mp3`
  - 脚本：`scripts/musicgen_bgm.py`，用 `small` 模型（300M，Mac M1 约 30-60 秒生成 30 秒 BGM）
  - 风格：`epic medieval fantasy exploration music, orchestral, lute, flute, gentle adventure theme, instrumental, loopable`
- **yOffset 自动落地**：`factory.js finalize()` 用 `THREE.Box3().setFromObject(root)` 实时计算包围盒最低点，自动抬高 `-minY` 使模型脚底对齐 y=0，不再依赖手动 Blender 测量值
  - **两层结构**：`createUnit()` 返回的是 **wrapper**（`Object3D`，外部 `position.set` / `scale` 都作用于它）
    → 内部 `root`（`root.position.y = -minY` 即自动落地补偿量）→ mesh。
    `wrapper.userData` 透传自 `root.userData`，并有 `userData.wrapper` / `userData.root` 互相引用；
    队伍色底座光环加在 wrapper（地面层），不随模型抬高
  - **★ 缩放约定（2026-07-25 更正，与旧文档说法相反）**：外部缩放**必须作用到 wrapper**，
    也就是直接 `mesh.scale.multiplyScalar(s)`（`mesh` 就是 `createUnit` 的返回值）。
    理由：补偿量 `-minY` 存在 root 的 local position 上，缩放 wrapper 时它一起被缩放，
    模型最低点始终停在 y=0；而只缩放 `userData.root` 时补偿量不跟着变，
    最低点会落到 `minY*(s-1)`——s>1 就沉进地面（**boss 龙 1.5× 时尤其明显**）
  - 已在 `map.js addObject`（行 ~699-702）与 `refreshObjectMeshes`（行 ~758）中按此约定处理，新增 scale 调用时务必一致
  - ⚠ **已知文档/代码不一致（留给 js 负责人）**：`js/assets/factory.js:247` 的行尾注释仍写着
    「外部 scale 应作用到 root 而非 wrapper」，与上面的正确约定相反，也与 `map.js` 的实际代码相反。
    只是注释错了、代码是对的，但会误导下一个人，建议改掉
- **程序化动画**：单 Mesh glb 模型无骨骼动画，用代码模拟（判定条件统一是 `mesh.userData.fromGltf`）
  - 移动：`rotation.x = sin(k*π*4)*0.08`（前后颠簸）+ `rotation.z = sin(k*π*2)*0.04`（左右轻晃），`onDone` 里归零
  - 待机：`position.y += sin(time*2.5)*0.03`（呼吸式起伏）+ `rotation.x = sin(time*1.5)*0.015`
  - 落点（2026-07-25 实测行号，改动后请重新 `grep -n fromGltf js/map.js js/battle.js` 核对）：

    | 对象 | 文件 · 位置 | 行号 |
    |------|------------|------|
    | 敌方英雄移动 | `map.js` · `moveEnemyHero` 的 Tween `onUpdate/onDone` | 894-903 |
    | 玩家英雄移动 | `map.js` · 英雄移动 Tween `onUpdate/onDone` | 1293-1304 |
    | 野怪待机 | `map.js` · `update()` 的 `this.animated` 循环 | 1537-1539 |
    | 玩家英雄待机 | `map.js` · `update()` 末尾 `if (!this.moving)` | 1578-1580 |
    | 战场单位移动 | `battle.js` · 移动 Tween `onUpdate/onDone`（`&& !legs`，原语模型走腿摆） | 604-615 |
    | 战场单位待机 | `battle.js` · `update()` 的 `this.stacks` 循环 | 1099-1102 |

---

## 七、AI 辅助美术工具（Skill）

项目内置两个 TRAE Skill，封装 AI 美术生成流程。位于 `.trae/skills/`，**不公开到 git/线上**（已在 `.gitignore` 和 `deploy.sh` 排除）。

### 7.1 meshy-3d-gen —— 文本生成 3D 模型

**用途**：调用 Meshy AI API 从文本描述生成 lowpoly glb 模型，替换 `art/export/` 下的资产。

**前置条件**：
- Meshy 会员 + API Key（环境变量 `MESHY_API_KEY`，绝不硬编码）
- 设置：`export MESHY_API_KEY=msy_xxx`（仅当前 shell 会话有效）
- Node.js 18+（脚本用原生 fetch，无需额外依赖）
- 计费：**preview 20 credits + refine 10 credits = 30 credits/次生成**
  （2026-07-25 逐任务核对 API 实测值；文档里旧写的「2+5=7」已过期。
  本轮 5 个精锐兵 + champion2 两次重试共 7 次生成 = 210 credits，
  余额 2680 → 2470。估算预算时按 30 credits/次算，失败重试也照扣。）

**调用方式**（两步工作流，封装在 `scripts/meshy_gen.mjs`）：

```bash
# 单个模型
export MESHY_API_KEY=msy_xxx
node scripts/meshy_gen.mjs "<prompt>" "<输出glb路径>" [texture_prompt]

# 示例：生成狼模型
node scripts/meshy_gen.mjs \
  "stylized low-poly grey timber wolf, side profile facing left, four legs, bushy tail, game asset, fantasy" \
  "art/export/units/wolf.glb" \
  "grey fur, white belly, yellow eyes, flat stylized texture"
```

**工作流**（`scripts/meshy_gen.mjs` 自动完成）：
1. POST `mode: "preview"` + `model_type: "lowpoly"` → 返回 preview_task_id
2. 轮询 preview 任务（每 5 秒，约 30-60 秒完成）
3. POST `mode: "refine"` + `enable_pbr: true` + `remove_lighting: true` → 返回 refine_task_id
4. 轮询 refine 任务（约 1-3 分钟）
5. 下载 `model_urls.glb` 到指定路径

**本项目 prompt 规范**：
- 必须包含：`stylized, low-poly, game asset, fantasy`
- 朝向：`side profile view facing left`（项目默认前方 = -Y）
- 禁用：`realistic, photorealistic`（与现有 lowpoly 风格冲突）
- 贴图提示：`flat colors, stylized texture, no photorealism`

**注意事项**：
- Meshy 服务端只保留生成结果 3 天，生成后立即下载
- rate limit 20 请求/秒
- 失败模式：401 认证失败、402 积分不足、429 频率超限
- 替换 glb 后无需改 `manifest.js`（路径不变）
- 生成后原文件建议备份为 `.bak2`（如 `wolf.glb.bak2`）
- 验证流程：`python3 -m http.server 8002` → 浏览器查看 → 满意再 `./scripts/deploy.sh`

### 7.2 musicgen-bgm —— AI 生成背景音乐

**用途**：本地部署 Meta MusicGen 模型生成游戏 BGM，替换 `art/audio/*.mp3`。

> ⚠ **当前状态（2026-07-25）**：线上仍是**旧版 BGM**（`small` 模型 / 单声道 / **67kbps**），用户反馈音质差。
> 升级用的脚本已改好、模型已缓存、MPS 加速已验证，但**生成太慢被叫停**（见下方「实测速率」），
> 换 RTX 3060 机器重跑的方案待定。**这是一项未完成的 TODO。**

**前置条件**：
- 本项目用 `.venv`（**不要升级 torch**，2.1.0 是 audiocraft 1.3.0 的兼容版本）：
  ```bash
  .venv/bin/python scripts/musicgen_bgm.py ...
  ```
- 模型缓存在 `~/.cache/huggingface/hub/`。`facebook/musicgen-stereo-medium` **已下载**（3.5GB），无需再等
- Mac 用 MPS，Linux/Windows(WSL2) 用 CUDA

**旧版 BGM 音质差的三个原因（已诊断）**：
1. 用了最低档的 `small`(300M) 模型
2. 单声道 32kHz
3. **mp3 只有 67kbps** —— `-qscale:a 4` 在单声道下算出来的，**这是音质杀手**（已在脚本里改成 192kbps CBR）

**模型选择 + 本机实测速率**：

| 模型 | 显存/内存 | 质量 | Mac MPS 实测 | 推荐场景 |
|------|----------|------|-------------|----------|
| `small` (300M) | 2GB | 一般 | 26s / 6s 音频 | 只适合快速试 prompt |
| **`stereo-medium` (1.5B)** | ~8GB | 好，**立体声** | **123s / 6s 音频**（≈15 分钟/45 秒 BGM） | 当前选型，Mac 上偏慢 |
| `large` / `stereo-large` (3.3B) | ~16GB | 优秀 | 16GB Mac 跑不动 | 需 12GB+ 显存的 N 卡 |

**⚠ MPS 的两个坑（已绕过，勿重踩）**：torch 2.1 的 MPS ①不支持 `autocast`（只能 fp32，速度减半）②缺 `aten::_weight_norm_interface` 算子。
探测过程记录在 `.bgm_logs/probe4.log`，脚本里已有可用的绕过方案，**不要重新探测**。

**换 RTX 3060 机器跑（推荐，尚未实施）**：预计**快 3-5 倍**（45 秒 BGM 约 3-5 分钟）。原因：CUDA 上 fp16 可用、算子完整、显存带宽 360GB/s vs Mac 基础款约 100-120GB/s（自回归生成是**带宽瓶颈**）。
更大的收益是 **12GB 显存能跑 `large`**——音质提升比省下的时间值钱，而这正是原始诉求。
**用 WSL2 而非 PowerShell**：audiocraft 是 Linux 优先的栈，Windows 原生常卡在 xformers 编译 / torchaudio 后端 / ffmpeg 路径；WSL2 的 CUDA 直通开销可忽略（驱动装在 Windows 宿主，WSL 内 `nvidia-smi` 能看到卡即通）。
注意：模型缓存和工作目录放 WSL 内部（`~/`），**别放 `/mnt/c/`**（跨文件系统 IO 慢一个数量级）。

**调用方式**（`scripts/musicgen_bgm.py`，已升级）：

```bash
.venv/bin/python scripts/musicgen_bgm.py "<prompt>" "<输出路径>" [时长秒] [模型]
```

新增可选参数：`--candidates N`（多候选）、`--loop-fade N`（尾头交叉淡化 N 秒做无缝循环）、192kbps CBR 编码已是默认。
**落盘时机**：每个候选生成完会立即写 wav + mp3（都在候选循环内），中途中断不会丢已完成的候选。
（之前那次丢候选是因为第一个还没跑完就被停了，不是脚本缺陷。）

**➡ 换 RTX 3060 机器执行的完整交接文档见 `BGM-RTX3060-HANDOFF.md`**（环境搭建 / WSL2 理由 / large 命令 / 验收标准 / 避坑清单）。

**本项目 BGM 风格规范**：
- **地图探索**：轻柔冒险，鲁特琴+长笛+柔和弦乐，中速
- **战斗**：紧张激烈，铜管+定音鼓+快弦乐，快板
- **胜利**：凯旋号角，明亮大调
- **城堡**：温暖安宁，竖琴+柔和木管

prompt 关键词：`medieval, fantasy, orchestral, instrumental, loopable, game soundtrack`
避免：`vocals, lyrics, singing, modern, electronic`

**注意事项**：
- 输出采样率 32000Hz，脚本内自动转 mp3（现为 192kbps CBR）
- 生成的音乐是单段，前端用 `bgmAudio.loop = true` 循环——**接缝处会有可听突变**，务必用 `--loop-fade` 处理
- MIT 许可，可商用
- 输出路径就是 `art/audio/bgm_map.mp3` 时无需改代码；换文件名才要动 `js/utils.js` 的 `BGM_SRC`
- **落地要用原子写**（先写 `.tmp` 再 `mv`），否则可能被并行的 `deploy.sh` 抓到写了一半的文件

**关于 MusicGen 的天花板**：它是 2023 年的模型，即使 `large` 也只到「能听、不出戏」，达不到商业游戏 OST 质感。
如果换 `large` 后仍不满意，比起继续堆硬件，这两个方向更有效：
① 换模型（Stable Audio Open，音质明显更好但显存要求更高）；② 直接用免费商用的中世纪奇幻 BGM 素材库（质量下限比 AI 生成高得多）。

---

## 八、当前待解决问题（2026-07-25 重写）

> 本轮（2026-07-25）修掉的 P0/P1/P2 已从本表移除，完整清单与验证方式见 **`FIXES-2026-07-25.md`**。
> 下表只保留**仍然存在**的问题。

### 8.1 仍未解决

| 优先级 | 问题 | 现状 / 修复方向 |
|--------|------|----------------|
| P2 | **战斗中偶发怪物模型消失** | 用户报告「打斗过程中某个怪物的模型就不见了」。**已尝试自动化复现但未捕获**：插桩跑了两场完整战斗（含近战/反击/死亡），每帧对每个存活单位检查 7 项不变量（脱离场景 / `visible=false` / 缩放≈0 / 无 mesh / 材质透明度<0.08 / 位置偏离所属六边形>4.5 / 沉入地下），**0 次异常**。静态也已排除：无代码把战场单位设为不可见、单位无 frustumCulled 问题、队伍环几何是每单位新建（不受死亡单位 dispose 连累）、共享贴图/几何的 `shared` 标记确实生效。**下次排查需要更具体的复现条件**：是否为刚阵亡的单位（死亡动画是设计如此）、头顶数字标签是否还在（在=渲染层问题，不在=逻辑层）、是否特定兵种（幽灵本身就是半透明设计）。探针脚本见 scratchpad 的 `ghost2.mjs`，可复用 |
| P2 | **骨骼动画缺失** | 22 个 glb 全部无 armature（Meshy 版是单 mesh，旧 Blender 版是 bmesh 原语）。真骨骼动画需重制 **17 个角色模型**（15 兵种 + 2 英雄；建筑不需要），是纯美术工程、成本高。当前程序化动画（颠簸/晃动/呼吸，见 §六）观感尚可，**因此从 P0 降级为 P2**——它不影响可玩性，也不影响线上稳定性，长期挂在 P0 会挤占真正紧急项的注意力 |
| P3 | **多英雄** | 仅 1 个玩家英雄，H3 支持多英雄分头行动 |
| P3 | **城镇建设** | 当前只有招募 + 兵营升级，缺建筑树 |
| P3 | **法术等级** | 所有法术从开始可用，应绑定魔法塔等级 |
| P3 | **LOD 分级** | 大地图单位用 LOD1，战场用 LOD0（ROI 低，暂缓） |

### 8.2 本轮已解决（详见 `FIXES-2026-07-25.md`）

| 原优先级 | 问题 | 结论 |
|---------|------|------|
| P1 | **朝向：行进方向与模型头朝向不符** | **已修**（2026-07-28）。根因不是模型——lookAt() 之后动画对 rotation.x/.z 单独赋值，打碎了朝北方向的退化欧拉表示。改为倾斜写到 factory 保证存在的 animNode 子节点。八方向实测误差全 0，回归测试 `tests/homm_e2e7.mjs` 19 项 |
| P1 | **BGM 每循环一圈卡顿** | **已修**。mp3 帧补白导致 `<audio loop>` 每圈插 36ms 静音。改用 Web Audio 的 AudioBufferSourceNode.loop（采样级精确），与容器格式无关，仍用 mp3 |
| P1 | **BGM 音质差** | **已解决**。换成 Kevin MacLeod《The Britons》（FreePD 公共领域），45s→304s、32kHz→44.1kHz。绕过的弯路：AudioGen 只有 medium 一个公开版本，且固定 16kHz 输出，模型再大也救不了高频 |
| P2 | **音效质量差 / 8 个音效从未触发** | **已解决**。补接 death/arrow/fireball/block/turn/hurt 六处调用点；音效换 Kenney CC0 素材，16kHz→44.1kHz，体积反而更小 |
| P3 | **战斗 AI 太笨** | **已重写**（2026-07-28）。旧 AI 三个短板：远程永远射最近、近战永远打 adj[0]（数组顺序=随机）、移动只看距离。新增 `scoreTarget()` 统一打分（预期伤害 + 击杀奖励 + 威胁权重 − 反击惩罚）与 `threatOf()` 威胁评估（输出×存活量，射手×1.35、飞行×1.15）；移动改为评估「移动到某格 + 攻击某目标」的组合收益，且己方射手不会主动贴脸（近战伤害减半）。回归测试 `tests/homm_e2e8.mjs` 7 项 |
| P2 | **战场云遮挡视野** | **已修**。云原本撒在与相机活动球完全重叠的方盒里（实测 48.3% 机位会挡）。改环形远景分布（半径 45-70、高度 22-34），实测遮挡率 0% |
| P1 | **SW 的 CDN 分支可能永不 settle** | **已修**（2026-07-28）。无缓存时 `.catch(() => cached)` 会 resolve 成 undefined 导致 respondWith 失败；网络不响应也不 reject 时永久挂起。加 8 秒超时兜底 + 保证任何分支都返回真实 Response（兜底 504） |
| P1 | **BGM 关服务器后仍播放** | **已修**。挂 `pagehide`（比 beforeunload 可靠，覆盖移动端/bfcache）与 `visibilitychange`：切后台自动停、切回来恢复 |
| P0 | **老用户拿不到更新**（SW 永不轮换） | **已修**。两个根因：① 缺主动 `reg.update()`；② 注册整个塞在 `load` 事件里，被第三方 CDN 卡住就永不执行。均已修复并**动态实测**跑通 3 秒轮换。机制见 §4.7 |
| P0 | **资产体积 21MB → 目标 ≤8MB** | **已解决，但需要重新定性**。真实上线体积一直是 **3.69MB**——那 17.8MB 全是 `*.bak/.bak2` 备份废料，被 `deploy.sh` 的 `--exclude '*.bak*'` + 服务端 `find -delete` 双重拦下，**从未部署上线过**。已把备份搬到 `art/_src/_export_bak/`，`art/export` 现在如实显示 3.7MB。**这是本地工作区不整洁，不是线上性能缺陷**，别和上面那条 SW 缺陷放在同一优先级 |
| P1 | **怪物 scale 与 yOffset 冲突** | **已修**，但当时的结论方向是反的：正确做法是缩放 **wrapper**（补偿量随之缩放，底部始终贴合 y=0），不是缩放 `userData.root`。见 §六 缩放约定 |
| P1 | **后台资产换入时点亮雾下对象** | **已修**。`refreshObjectMeshes()` 新建的 mesh 默认 `visible=true`，实测 41 个雾下对象有 20 个突然显形；现在换入后重放一次迷雾 |
| P2 | **模型原点不在脚底** | 已用 `factory.js finalize()` 的 Box3 自动抬升解决 |

### 8.3 朝向 bug 完整根因与修复（2026-07-25 诊断 → 2026-07-28 **已修复上线**）

**先排除误判**：17 个角色 glb（15 兵种 + 2 英雄）的朝向**全部正确**，在 three.js 世界空间里都面朝 `+Z`，与 `art/_src/_export_bak/` 里的旧 Blender 原件完全一致。Meshy 的 `side profile view facing left` 提示词**没有**破坏导出朝向。`manifest.js` 里 **不需要任何 rotY**——用 rotY 去修是错的方向，会把本来对的模型转歪。

**真正的根因在动画代码**：所有移动点都先调 `mesh.lookAt(...)`（正确，`Object3D.lookAt` 让局部 +Z 指向目标），紧接着"颠簸/摇晃"动画又给 `mesh.rotation.x` 和 `mesh.rotation.z` **单独赋值**。

问题在于 three.js 对**含 -Z 分量（朝北）**的朝向，其欧拉 XYZ 分解结果是 `(±180°, 180°−θ, ±180°)` 而不是 `(0, θ, 0)`——数学上等价，但表示是退化的。单独给 `.x` / `.z` 赋值会**静默丢掉那对 ±180°**，只剩 `180°−θ`，也就是**朝向被绕世界 X 轴镜像了**。

实测朝向误差：

| 行进方向 | 误差 | 表现 |
|---------|------|------|
| 东 / 西 / 南 / 东南 / 西南 | 0° | 正常 |
| **北** | **180°** | 倒着走 |
| **东北 / 西北** | **90°** | 横着走 |

且待机循环每帧都在重复这个破坏，所以朝北走完一步后，人物会立刻"啪"地转回来。

**全部受影响的代码位置**：

| 文件:行 | 说明 |
|---------|------|
| `js/map.js:1294-1295` | **主犯**。玩家英雄 `walk()` 的 onUpdate，在 1286 行 lookAt 之后覆写 rotation.x/z |
| `js/map.js:1305-1306` | `walk()` onDone 把 x/z 归零 → 错误朝向**固化**（纯朝北时英雄最终停在 (0,0,0)，即面朝正南） |
| `js/map.js:1579` | 待机循环每帧执行，站着不动也会被翻掉 |
| `js/map.js:895-896, 901-902` | 敌方英雄 `moveEnemyHero()`，同样模式（lookAt 在 887 行） |
| `js/map.js:1558` | 敌方英雄待机，同样受影响 |
| `js/map.js:1538` | 地图野怪待机。**当前没坏**（野怪从不被 lookAt，rotation 恒为 (0,0,0)），但是同款隐患——将来若给野怪加朝向，必须先修这里 |
| `js/battle.js:605-606, 613-614` | `moveActive()`，lookAt 在 595 行。战场单位向低 row（-Z）移动时同样出错 |
| `js/battle.js:1101` | 战场待机（`!anim.legs` 时生效）。`attack()`（722-723 行）会给攻防双方都 lookAt，任何含 -Z 分量的朝向都会在下一个非 busy 帧被这里打碎 |
| `js/battle.js:268` | 初始布阵 `rotation.y = ±π/2` **是对的**：玩家在 col 0-1 面朝 +X、敌方在 col 11-12 面朝 −X，纯 ±90° 能干净分解——这正是为什么开局看着正常、**第一次移动/攻击后才出问题** |
| `js/assets/factory.js:206` | `rotY` 机制存在且可用，当前无资产使用。**保持现状是对的** |

**已实施的修法**（2026-07-28）：采用下面第 1 种。不要再对 `rotation.x/.z` 单独赋值。

1. ✅ **把颠簸/摇晃挪到子节点**（已采用）——外层节点只承载 lookAt 的朝向，内层子节点做动画偏移
2. 改用四元数叠加（未采用）

**具体改动**：
- `factory.js finalize()` 现在**永远**套一层 wrapper（原先只在需要抬升时套），并把内层 root 暴露为 `userData.animNode`。结构统一后，此类 bug 从根上不可能再发生。
- 新增 `utils.js` 的 `tiltNode(obj)` helper —— 所有颠簸/摇晃统一写它返回的节点。原语模型没有 animNode，回退到自身；但原语走的是 `anim.legs` 摆腿分支，不碰倾斜，安全。
- 全部 10 处调用点改完：map.js 7 处（英雄行走 onUpdate/onDone、敌方英雄 onUpdate/onDone、野怪待机、敌英雄待机、玩家待机）、battle.js 3 处（moveActive onUpdate/onDone、战场待机）。
- 副作用（正面的）：队伍色底座光环挂在 wrapper 上，现在不再跟着模型一起倾斜了。

**实测验证**（八方向，误差单位度）：

| | E | W | S | SE | SW | **N** | **NE** | **NW** |
|---|---|---|---|---|---|---|---|---|
| 修复前 | 0 | 0 | 0 | 0 | 0 | **180** | **90** | **90** |
| 修复后 | 0 | 0 | 0 | 0 | 0 | **0** | **0** | **0** |

修复前那一行是用**对照组脚本**（把倾斜改回写本体）实跑出来的，证明探针确实能抓到此 bug，不是"测了个寂寞"。

**已固化为回归测试 `tests/homm_e2e7.mjs`（19 项）**：检查 glb 模型有独立 animNode + 英雄与战场单位各八方向朝向。
⚠ **只测东西向发现不了这个 bug**（东西南误差本来就是 0）——这正是它此前长期潜伏的原因，所以必须八方向全测。

---

## 九、调试技巧

### 冒烟测试
URL 加 `?smoke=map` 或 `?smoke=battle` 跳过开始画面，自动进入游戏/战斗。
```js
window.__game  // 全局调试句柄
__game.state          // 游戏状态
__game.world          // WorldMap 实例
__game.getBattle()    // Battle 实例（战斗模式）
__game.getCamTarget() // 相机目标
```

### 本地存档
```js
localStorage.removeItem('homm3d_save')  // 清存档
__game.saveGame()                        // 手动保存
__game.readSave()                        // 读取存档
```

### 画质/静音
右上角「设置」按钮：切换高/低画质（阴影+像素比）、静音。持久化在 localStorage。

---

## 十、VPS 部署详情

| 项 | 值 |
|----|-----|
| 服务器 | `tap-vps`（SSH 别名） |
| 系统 | Ubuntu 24.04 + nginx 1.24 |
| 网站目录 | `/var/www/h3/` |
| nginx 配置 | `/etc/nginx/sites-available/h3.idiotfan.wang` |
| SSL | Let's Encrypt（certbot 自动续期） |
| 域名 | `h3.idiotfan.wang` → HTTPS |
| 部署方式 | `./scripts/deploy.sh`（rsync + nginx 验证） |

---

## 十一、文件行数参考

> 2026-07-25 用 `wc -l` **全部重算**。旧表是估算值，且「合计」与各行相加对不上（旧表列出的
> 10 个文件相加约 4795，却写成 6300），已废弃。下表每个数字都可用
> `find js -name '*.js' | sort | xargs wc -l` 复现。

### 前端运行时（`js/` + `index.html` + `css/` + `sw.js` + `manifest.json`）

| 文件 | 行数 | 说明 |
|------|------|------|
| js/map.js | **1588** | 最大文件，含地形/寻路/对象/敌方 AI/日夜/序列化/战争迷雾/书签/撤销 |
| js/battle.js | **1182** | 战场引擎 + 粒子 + 特效 + 结算动画 |
| js/main.js | **1154** | 主控制器 + PMREM + Bloom + 输入 + 启动门禁 + 拾取账本 + 存档校验 |
| js/ui.js | 523 | DOM UI + 新手引导 |
| js/models.js | 429 | 原语回退模型 |
| js/assets/factory.js | 335 | glb 工厂（队伍色/单 mesh 兜底/底座光环/自动落地） |
| js/utils.js | 320 | 噪声/缓动/Tween/六边形数学/音效/BGM/资源释放 |
| js/difficulty.js | 192 | 难度数值体系（easy/normal/hard 三档 + `damageCoef`） |
| js/assets/loader.js | 159 | GLTFLoader 封装（缓存/分阶段懒加载/失败回退） |
| js/textures.js | 127 | 程序化纹理 |
| js/assets/manifest.js | 101 | glb 资产清单 |
| js/minimap.js | 97 | 小地图 |
| js/config.js | 81 | 基础定义（不随难度变的数值） |
| **js/ 小计** | **6288** | 13 个文件 |
| index.html | 195 | 入口页 + importmap + SW 注册/轮换逻辑 |
| css/style.css | 372 | 全部样式 |
| sw.js | 157 | PWA Service Worker |
| manifest.json | 19 | PWA 清单 |
| **前端合计** | **7031** | |

### 工具脚本（不上线）

| 文件 | 行数 | 说明 |
|------|------|------|
| scripts/blender_export_models.py | 1614 | Blender 无界面批处理导出 |
| scripts/musicgen_bgm.py | 527 | MusicGen 生成 BGM |
| scripts/compress_assets.mjs | 466 | glb 压缩管线 |
| scripts/gen_glb.mjs | 406 | Node 备用导出 |
| scripts/render_previews.py | 192 | 生成 art/preview 对比图 |
| scripts/deploy.sh | 168 | 一键部署 |
| scripts/meshy_gen.mjs | 93 | Meshy 文生 3D |
| **scripts/ 小计** | **3466** | 7 个文件 |
| tests/（10 个 CDP 脚本） | **1154** | e2e ×6 + smoke/pixels×2/shot |
| **工具合计** | **4620** | |

**全项目合计：11,651 行**（前端 7031 + 工具 4620，不含 `node_modules` / `art`）

---

*文档版本：**2026-07-25（晚间更新）** · 与代码库当前状态同步。*

*本次更新补入三项未完成 TODO 的完整交接信息：*
*① **朝向 bug**（§8.3）—— 根因已精确定位到 9 处代码位置，含实测误差表与两种修法，**注意不要用 rotY 去修**；*
*② **BGM 音质**（§7.2）—— 升级方案就绪但 Mac 上太慢已叫停，含实测速率、MPS 避坑记录、RTX 3060 + WSL2 迁移建议；*
*③ **战斗中怪物消失**（§8.1）—— 自动化复现失败的完整记录与已排除项，列出下次排查所需的具体信息。*

*本次（2026-07-25）文档改动：§一 加 `gen:blender/gen:glb` 覆盖 Meshy 模型的危险警告、更新部署排除清单与
测试项数（110 项实测）；§二 结构树按实测体积重写并补上 `art/_src` / `art/audio` / 全部 scripts；
§4.3 补首屏 9 个 / 后台 13 个 glb 的精确字节数；§4.4 加覆盖警告；§4.4b 补压缩管线参数表与「为什么不能直接上线」；
§4.5 难度表按重写后的 `difficulty.js` 全量更新（拆分玩家/敌方伤害系数、`bossScale`、单调性约定）；
**§4.7 新增 Service Worker 更新机制**（四个必须成立的条件 + 缓存策略 + 自检 + 残余风险）；
§六 修正 scale 应作用于 wrapper（旧文档说反了）、程序化动画行号按实测重列、懒加载数字、BGM 已换 mp3；
§八 待解决问题表重写（分「仍未解决」与「本轮已解决」，骨骼动画 P0→P2，删掉不存在的 `probe_units.py` 引用）；
§十一 行数表按 `wc -l` 全部重算（旧表合计与各行相加矛盾）。*

*配套文档：`FIXES-2026-07-25.md`（本轮 P0/P1/P2 修复清单 + 验证方式 + 残余风险）、`ART_SPEC.md`（美术规范）。*
