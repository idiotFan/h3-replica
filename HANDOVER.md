# 英雄无敌 3D · 接手文档

> Three.js 复刻《英雄无敌3》：异形岛屿大地图探索 + 六边形回合制战场 + 英雄成长 + 敌方阵营 AI  
> 线上：**https://h3.idiotfan.wang**  
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
```bash
npm install                    # 装 three 依赖（仅 gen:glb 脚本需要）
npm run gen:blender            # 用 Blender 导出（需装 Blender，质量更高）
npm run gen:glb                # 用 Node + three.js 导出（备用，无需 Blender）
```

### 发布到线上（惯例：每次更改完都要发布）

```bash
./scripts/deploy.sh            # 一键发布：rsync 到 tap-vps:/var/www/h3 + 自动验证 HTTP 200
```

**前置条件**：本机 `~/.ssh/config` 里有 `tap-vps` 别名且免密可登（`ssh tap-vps true` 验证）。

**同步范围**：整个项目目录，但排除 `node_modules`、`.git`、`*.md`、`tests`、`.claude`、`.opencode`、`.DS_Store`——**交接/评审文档和测试脚本不会暴露到公网**。新增源码/资产文件无需登记，rsync 自动带上；新增«不该公开»的文件要记得往 `scripts/deploy.sh` 的 `--exclude` 里加。

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

**回滚须知**：`rsync --delete` 会让服务器与本地完全一致，服务器上**没有历史版本**；项目目前也没有 git——回滚唯一手段是把本地恢复到旧状态再发布（建模脚本有 `.bak*` 备份可用）。强烈建议尽早 `git init` 补上版本控制。

线上由 nginx 静态托管 + Let's Encrypt SSL（certbot 自动续期）。nginx 配置在 VPS `/etc/nginx/sites-available/h3.idiotfan.wang`，网站根目录 `/var/www/h3`。

### 自动化测试
测试脚本在项目 `tests/`（通过 Chrome CDP 驱动 headless 浏览器，需先起 8000 端口服务）：
```bash
node tests/homm_smoke.mjs "http://localhost:8000/?smoke=map" 30   # 冒烟
node tests/homm_e2e.mjs                                           # 核心功能
node tests/homm_e2e6.mjs                                          # 难度机制（警戒圈/成长/禁斜穿）
node tests/homm_shot.mjs "http://localhost:8000/?smoke=battle" 12 /tmp/shot.png  # 截图
```
共 6 轮 108 项端到端测试，覆盖移动/战斗/招募/技能/法术/存档/敌方 AI/难度机制/部署。

---

## 二、项目结构

```
K3版H3/
├── index.html               # 入口页（importmap + UI 骨架 + 加载画面）
├── css/style.css            # 全部样式（CSS 变量 + 响应式 + 移动端）
├── js/
│   ├── config.js            # ★ 单位/法术/技能/宝物/地图尺寸等基础定义（不随难度变）
│   ├── difficulty.js        # ★ 难度数值体系（easy/normal/hard 三档，所有可调数值集中于此）
│   ├── utils.js             # 噪声/缓动/Tween/六边形数学/音效/资源释放
│   ├── textures.js          # 程序化纹理（地面噪点/水面波纹/天空穹顶/云/太阳月亮）
│   ├── models.js            # ★ 原语模型工厂（glb 加载失败时的回退）
│   ├── map.js               # ★ 冒险大地图（地形/寻路/对象/敌方 AI/日夜循环/序列化）
│   ├── battle.js            # ★ 六边形战场（回合/伤害/技能/法术/粒子/特效/AI）
│   ├── ui.js                # ★ DOM UI（资源栏/英雄栏/战场栏/模态框/魔法书/CG）
│   ├── minimap.js           # 小地图（Canvas 2D 绘制 + 视窗框）
│   ├── main.js              # ★ 主控制器（渲染器/相机/输入/状态/部署/启动流程）
│   └── assets/
│       ├── manifest.js      # glb 资产清单（path ↔ unit key 映射）
│       ├── loader.js        # GLTFLoader 封装（缓存/预加载/失败回退）
│       └── factory.js       # 统一工厂（glb 优先，回退 models.js 原语）
├── art/export/              # 22 个 glb 模型（Blender 导出）
│   ├── units/               # 15 兵种（5 基础 + 5 精锐 + 5 野怪）
│   ├── heroes/              # 玩家/敌方英雄
│   └── buildings/           # 城堡×2 + 矿场×3
├── scripts/
│   ├── blender_export_models.py  # Blender 无界面批处理导出
│   ├── gen_glb.mjs               # Node 备用导出
│   └── deploy.sh                 # 一键部署
├── ART_SPEC.md              # 美术规范（面数/贴图/动画/命名/优先级）
└── package.json
```

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
- `loader.js`：启动时 `preloadAllAssets()` 预加载全部 glb，加载条显示进度
- `factory.js`：`createUnit(type, side)` → 有 glb 用 glb（clone + 队伍色 + 底座环），否则 `makeUnit(type, side)`
- **队伍色**：glb 中名为 `TeamColor` 的网格/材质自动替换为蓝/红
- **翅膀/旗帜**：名为 `WingL/WingR/Flag` 的节点自动绑定待机动画

### 4.4 模型生成
- **Blender 脚本**（`scripts/blender_export_models.py`）：bmesh 构建原语 + 倒角修改器 + 平滑着色，22 个资产批处理导出
- **Node 脚本**（`scripts/gen_glb.mjs`）：three.js GLTFExporter 导出，质量稍低但无需 Blender
- 修改模型后运行 `npm run gen:blender` 重新导出即可

### 4.5 难度数值体系（difficulty.js）★ 2026-07-23 新增
所有随难度可调的数值集中于此文件，`config.js` 只保留不随难度变的基础定义（单位/法术/技能/宝物/地图尺寸）。

**三档难度**：开始画面选择「简单 / 普通 / 困难」按钮即以该难度开始新游戏；存档保存 `diff` 字段，读档自动恢复。

| 参数组 | 简单 | 普通 | 困难 | 说明 |
|--------|------|------|------|------|
| 初始资源 | 5000金/20木/20矿 | 3000/15/15 | 2000/10/10 | `startRes` |
| 城堡收入 | 600/天 | 500 | 400 | `castleIncome` |
| 移动力上限 | 18 | 15 | 13 | `moveMax` |
| 野怪兵力倍率 | 0.8 | 1.0 | 1.2 | `monsterScale` |
| 野怪成长率/上限 | 0.10/+50% | 0.10/+100% | 0.15/+150% | `monsterGrowRate/Max`（线性增量，非复利） |
| 敌方军队系数 | 0.4/0.25/0.3 | 0.6/0.4/0.45 | 0.8/0.5/0.6 | `enemyArmyDayRate`（骷髅/兽人/恶狼） |
| 敌方增援 | 每7天/上限1 | 每5天/上限2 | 每4天/上限3 | `enemyReinforceInterval/MaxHeroes` |
| 敌方追击 | 6格 | 9格 | 12格 | `enemyChaseRange` |
| 伤害攻方系数/上限 | 0.06/50 | 0.05/40 | 0.04/30 | `damageAtkFactor/Cap`（越大越利玩家） |
| 伤害防方系数/上限 | 0.02/20 | 0.025/28 | 0.03/35 | `damageDefFactor/Cap`（越大越不利玩家） |
| 士气（玩家/敌方） | 12%/0% | 10%/0% | 8%/5% | `morale.player/enemy` |
| 升级经验阈值 | 80×等级 | 100×等级 | 120×等级 | `xpThreshold` |

**全局平衡修正（所有难度生效，改 config.js）**：
- 弓箭手 HP 10→12、弹药 12→16；骑士速度 9→8、精锐骑士 10→9
- 兵营升级成本 2000/10/10 → 1500/5/5；金矿收入 400→300
- 法术等级系数提高：魔法神箭 10→15/级、治疗 15→20/级、火球 10→15/级
- 撤退惩罚：损失 25% 兵力 + 魔法值清零

**改动数值的指引**：
- 改某档难度的数值 → 编辑 `js/difficulty.js` 对应档位字段
- 改不随难度变的基础数值（单位属性/法术耗魔/技能上限/地图尺寸）→ 编辑 `js/config.js`
- `DIFF` 是 `export let`，各模块 `import { DIFF }` 后通过 ES module live binding 读到最新值；`setDifficulty(key)` 必须在构建世界/英雄前调用

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

## 六、已知待改进项

| 优先级 | 项目 | 说明 |
|--------|------|------|
| P0 | 骨骼动画 | glb 无 armature（Blender 脚本是 bmesh 原语建模），真骨骼动画需重制全部 22 个模型（美术工程）；当前用过程动画（移动颠簸+腿摆/攻击前刺/受击红闪/死亡倒地/待机浮动/翅膀披风）覆盖，待美术资源就绪后接 AnimationMixer |
| P1 | 多英雄 | 仅 1 个玩家英雄，H3 支持多英雄分头行动 |
| P2 | 城镇建设 | 当前只有招募 + 兵营升级，缺建筑树 |
| P2 | 法术等级 | 所有法术从开始可用，应绑定魔法塔等级 |
| P2 | 战斗 AI | 当前只射最近/走最近，缺优先击杀低血/利用障碍 |
| P3 | LOD | 大地图单位用 LOD1，战场用 LOD0 |
| P3 | 音效丰富化 | 已有程序化 BGM（五声音阶循环）+ 8 种合成音效，可换音效文件提升品质 |

### 2026-07-23 成品向优化（已上线）
- **战争迷雾**：`fogBlack`(未探索全黑) + `fogDim`(已探索不可见半透明) 双层 InstancedMesh；视野半径随移动力；对象与敌方英雄按可见性显隐；小地图同步迷雾；存档持久化 `explored`
- **新手引导**：`ui.guide()` 长停留可关闭浮层，按 enter/firstWin/castle 三个里程碑首次触发（`localStorage['homm3d_guide']`）
- **移动端战斗日志**：`#battle-log.mobile-show` 紧凑横条，有内容时显示
- **BGM**：`utils.startBgm()/stopBgm()` 程序化五声音阶循环，进入地图开始、静音时停止
- **战绩存档**：`localStorage['homm3d_records']` 保存最近 10 局，胜利 CG 显示最佳通关记录

---

## 七、调试技巧

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

## 八、VPS 部署详情

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

## 九、文件行数参考

| 文件 | 行数 | 说明 |
|------|------|------|
| map.js | ~1090 | 最大文件，含地形/寻路/对象/敌方 AI/日夜/序列化 |
| battle.js | ~1090 | 战场引擎 + 粒子 + 特效 |
| main.js | ~760 | 主控制器 + 输入 + 启动 |
| ui.js | ~460 | DOM UI |
| models.js | ~430 | 原语回退模型 |
| blender_export_models.py | ~620 | Blender 脚本 |
| style.css | ~370 | 样式 |
| config.js | ~80 | 基础定义（不随难度变的数值） |
| difficulty.js | ~125 | 难度数值体系（easy/normal/hard 三档） |
| **合计** | **~6200** | |

---

*文档版本：2026-07-23 · 与代码库当前状态同步（含美术优化三轮、难度数值体系抽取与三档难度、全局平衡修正、战争迷雾、新手引导、BGM、战绩存档、发布流程）*
