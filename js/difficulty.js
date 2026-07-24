// ================= 难度数值体系 =================
// 所有随难度可调的数值集中于此；config.js 保留不随难度变的定义（单位/技能/法术/地图尺寸等）
// 修改难度只需调整下方数值；运行时通过 setDifficulty(key) 切换当前生效档位

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
    monsterGrowRate: 0.10,    // 每3天增量（基于基础值，非复利）
    monsterGrowMax: 0.50,     // 成长上限（+50%）
    monsterRewardRate: 1.2,
    // 敌方英雄
    enemyArmyDayRate: { skeleton: 0.4, orc: 0.25, wolf: 0.3 },
    enemyGhostDay: 8,
    enemyDragonDay: 20,
    enemyReinforceInterval: 7,
    enemyMaxHeroes: 1,
    enemyChaseRange: 6,
    enemyStepsPerDay: 6,
    enemyHeroAtkRate: 10,
    enemyHeroDefRate: 12,
    // 战斗
    damageAtkFactor: 0.06,
    damageAtkCap: 50,
    damageDefFactor: 0.02,
    damageDefCap: 20,
    shooterMeleeMult: 0.5,
    defendBonus: 1.2,
    blessBonus: 1.2,
    morale: { player: 0.12, enemy: 0.0 },
    luckChance: 0.05,
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
    enemyArmyDayRate: { skeleton: 0.6, orc: 0.4, wolf: 0.45 },
    enemyGhostDay: 10,
    enemyDragonDay: 18,
    enemyReinforceInterval: 5,
    enemyMaxHeroes: 2,
    enemyChaseRange: 9,
    enemyStepsPerDay: 8,
    enemyHeroAtkRate: 8,
    enemyHeroDefRate: 10,
    damageAtkFactor: 0.05,
    damageAtkCap: 40,
    damageDefFactor: 0.025,
    damageDefCap: 28,
    shooterMeleeMult: 0.5,
    defendBonus: 1.2,
    blessBonus: 1.2,
    morale: { player: 0.10, enemy: 0.0 },
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
    enemyArmyDayRate: { skeleton: 0.8, orc: 0.5, wolf: 0.6 },
    enemyGhostDay: 8,
    enemyDragonDay: 14,
    enemyReinforceInterval: 4,
    enemyMaxHeroes: 3,
    enemyChaseRange: 12,
    enemyStepsPerDay: 10,
    enemyHeroAtkRate: 6,
    enemyHeroDefRate: 8,
    damageAtkFactor: 0.04,
    damageAtkCap: 30,
    damageDefFactor: 0.03,
    damageDefCap: 35,
    shooterMeleeMult: 0.5,
    defendBonus: 1.2,
    blessBonus: 1.2,
    morale: { player: 0.08, enemy: 0.05 },
    luckChance: 0.05,
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
