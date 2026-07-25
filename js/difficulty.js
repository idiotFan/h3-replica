// ================= 难度数值体系 =================
// 所有随难度可调的数值集中于此；config.js 保留不随难度变的定义（单位/技能/法术/地图尺寸等）
// 修改难度只需调整下方数值；运行时通过 setDifficulty(key) 切换当前生效档位
//
// ---------- 单调性约定（改数值前必读） ----------
// 每个字段在 easy → normal → hard 三档之间必须单调，且方向要指向「对玩家更难」。
// 特别注意「敌我对称字段」：伤害倍率系数同时作用于玩家出手和敌方出手，
// 若只用一组系数，调低困难档的攻击系数会连敌方输出一起削弱（方向反了）。
// 因此伤害系数按「攻击方阵营」拆成 player* / enemy* 两组，两组必须反向变化：
//   困难档 = 玩家攻击系数下调 + 玩家受击惩罚上调 + 敌方攻击系数上调 + 敌方受阻减免下调
//
// 下列字段实测只对玩家一方生效（敌方单位没有 shots、敌方英雄没有法术/技能，
// 敌方 AI 仅在找不到目标的兜底分支里防御），因此按「玩家收益随难度递减」处理：
//   shooterMeleeMult / defendBonus / blessBonus / luckChance

export const DIFFICULTIES = {
  // ---------- 简单 ----------
  easy: {
    name: '简单',
    desc: '资源充裕，敌方迟缓，适合休闲体验',
    // 经济
    startRes: { gold: 5000, wood: 20, ore: 20 },
    castleIncome: 600,
    moveMax: 18,
    // 野怪
    monsterScale: 0.8,        // 基础兵力倍率
    monsterDistFactor: 18,    // 距离系数（越大越缓）
    monsterGrowRate: 0.06,    // 每3天增量（基于基础值，非复利）
    monsterGrowMax: 0.50,     // 成长上限（+50%）
    monsterRewardRate: 1.2,
    // 决胜战（Boss 黑龙巢穴 / 敌方城堡）兵力倍率，由 map.js buildObjects() 消费，见文件底部
    bossScale: 0.7,
    // 敌方英雄
    enemyArmyDayRate: { skeleton: 0.4, orc: 0.25, wolf: 0.3 },
    enemyGhostDay: 14,        // 幽灵解锁日：越晚越简单（easy 14 > normal 10 > hard 8）
    enemyDragonDay: 20,
    enemyReinforceInterval: 7,
    enemyMaxHeroes: 1,
    enemyChaseRange: 6,
    enemyStepsPerDay: 6,
    enemyHeroAtkRate: 10,
    enemyHeroDefRate: 12,
    // 战斗 —— 玩家出手时的伤害倍率系数（越大玩家越强）
    playerDamageAtkFactor: 0.06,
    playerDamageAtkCap: 50,
    playerDamageDefFactor: 0.02,   // 玩家打不动高防目标时的衰减（越大玩家越弱）
    playerDamageDefCap: 20,
    playerDamageMinMult: 0.35,     // 玩家伤害倍率下限（越大玩家越强）
    // 战斗 —— 敌方出手时的伤害倍率系数（与玩家组反向：简单档敌方最弱）
    enemyDamageAtkFactor: 0.04,
    enemyDamageAtkCap: 30,
    enemyDamageDefFactor: 0.03,    // 敌方打不动玩家时的衰减（越大玩家越安全）
    enemyDamageDefCap: 35,
    enemyDamageMinMult: 0.25,      // 敌方伤害倍率下限（越小玩家越安全）
    // 以下四项实测只对玩家生效，故随难度递减
    shooterMeleeMult: 0.6,         // 射手被贴身时的输出折扣（敌方无远程单位）
    defendBonus: 1.30,             // 防御指令的防御加成（敌方 AI 几乎不防御）
    blessBonus: 1.35,              // 祝福法术加成（敌方英雄无法术）
    morale: { player: 0.12, enemy: 0.0 },
    luckChance: 0.07,              // 幸运一击基础概率（仅玩家 att.side===0 判定）
    // 英雄
    heroStart: { atk: 1, def: 1, mp: 12, mpMax: 12 },
    xpThreshold: 80,
  },
  // ---------- 普通（修复后的平衡曲线） ----------
  normal: {
    name: '普通',
    desc: '标准难度，修复后的平衡曲线',
    startRes: { gold: 3000, wood: 15, ore: 15 },
    castleIncome: 500,
    moveMax: 15,
    monsterScale: 1.0,
    monsterDistFactor: 14,
    monsterGrowRate: 0.10,
    monsterGrowMax: 1.0,
    monsterRewardRate: 1.0,
    bossScale: 1.0,
    enemyArmyDayRate: { skeleton: 0.6, orc: 0.4, wolf: 0.45 },
    enemyGhostDay: 10,
    enemyDragonDay: 18,
    enemyReinforceInterval: 5,
    enemyMaxHeroes: 2,
    enemyChaseRange: 9,
    enemyStepsPerDay: 8,
    enemyHeroAtkRate: 8,
    enemyHeroDefRate: 10,
    playerDamageAtkFactor: 0.05,
    playerDamageAtkCap: 40,
    playerDamageDefFactor: 0.025,
    playerDamageDefCap: 28,
    playerDamageMinMult: 0.30,
    enemyDamageAtkFactor: 0.05,
    enemyDamageAtkCap: 40,
    enemyDamageDefFactor: 0.025,
    enemyDamageDefCap: 28,
    enemyDamageMinMult: 0.30,
    shooterMeleeMult: 0.5,
    defendBonus: 1.20,
    blessBonus: 1.20,
    morale: { player: 0.10, enemy: 0.02 },
    luckChance: 0.05,
    heroStart: { atk: 1, def: 1, mp: 10, mpMax: 10 },
    xpThreshold: 100,
  },
  // ---------- 困难 ----------
  hard: {
    name: '困难',
    desc: '资源紧张，敌方凶猛，考验策略',
    startRes: { gold: 2000, wood: 10, ore: 10 },
    castleIncome: 400,
    moveMax: 13,
    monsterScale: 1.2,
    monsterDistFactor: 11,
    monsterGrowRate: 0.15,
    monsterGrowMax: 1.5,
    monsterRewardRate: 0.85,
    bossScale: 1.4,
    enemyArmyDayRate: { skeleton: 0.8, orc: 0.5, wolf: 0.6 },
    enemyGhostDay: 8,
    enemyDragonDay: 14,
    enemyReinforceInterval: 4,
    enemyMaxHeroes: 3,
    enemyChaseRange: 12,
    enemyStepsPerDay: 10,
    enemyHeroAtkRate: 6,
    enemyHeroDefRate: 8,
    playerDamageAtkFactor: 0.04,
    playerDamageAtkCap: 30,
    playerDamageDefFactor: 0.03,
    playerDamageDefCap: 35,
    playerDamageMinMult: 0.25,
    enemyDamageAtkFactor: 0.06,
    enemyDamageAtkCap: 50,
    enemyDamageDefFactor: 0.02,
    enemyDamageDefCap: 20,
    enemyDamageMinMult: 0.35,
    shooterMeleeMult: 0.4,
    defendBonus: 1.15,
    blessBonus: 1.12,
    morale: { player: 0.08, enemy: 0.05 },
    luckChance: 0.04,
    heroStart: { atk: 1, def: 1, mp: 8, mpMax: 8 },
    xpThreshold: 120,
  },
};

/** 当前生效的难度（live binding，各模块 import 后可读到最新值） */
export let DIFF = DIFFICULTIES.normal;

/** 设置难度（必须在构建世界/英雄前调用） */
export function setDifficulty(key) {
  DIFF = DIFFICULTIES[key] || DIFFICULTIES.normal;
}

/** 获取当前难度 key（存档用） */
export function getDifficultyKey() {
  for (const [k, v] of Object.entries(DIFFICULTIES)) if (v === DIFF) return k;
  return 'normal';
}

/**
 * 取「攻击方阵营」对应的伤害倍率系数组。
 * side: 0 = 玩家，1 = 敌方。两组数值反向变化，见文件顶部单调性约定。
 */
export function damageCoef(side) {
  return side === 0
    ? {
        atkFactor: DIFF.playerDamageAtkFactor,
        atkCap: DIFF.playerDamageAtkCap,
        defFactor: DIFF.playerDamageDefFactor,
        defCap: DIFF.playerDamageDefCap,
        minMult: DIFF.playerDamageMinMult,
      }
    : {
        atkFactor: DIFF.enemyDamageAtkFactor,
        atkCap: DIFF.enemyDamageAtkCap,
        defFactor: DIFF.enemyDamageDefFactor,
        defCap: DIFF.enemyDamageDefCap,
        minMult: DIFF.enemyDamageMinMult,
      };
}

// ================= bossScale 消费点（已落地） =================
// bossScale 由 js/map.js 的 buildObjects() 消费：那里定义了
//   const bs = n => Math.max(1, Math.round(n * DIFF.bossScale));
// 并用它包住 Boss 黑龙巢穴与敌方城堡的每个 stack count。
// Math.max(1, …) 不可省略，否则简单档 count=1 的兵种会被 round 成 0 整队消失。
//
// 实测结果（bossScale 0.7 / 1.0 / 1.4）：
//   Boss  龙/幽灵/兽人   简单 1/7/11   | 普通 2/10/15  | 困难 3/14/21
//   敌堡  兽人/骷髅/狼/幽灵 简单 8/13/7/4 | 普通 12/18/10/6 | 困难 17/25/14/8
// 改这三个数值前先确认 map.js:617 附近的 bs() 还在，否则难度差异会静默消失。
