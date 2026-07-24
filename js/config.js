// ================= 游戏配置 =================

// 单位定义（玩家兵种 + 野怪）
export const UNITS = {
  pikeman:   { name:'枪兵',   atk:2,  def:2,  dmg:[1,3],   hp:10,  spd:4, cost:{gold:60},                 color:0x7f96b8 },
  archer:    { name:'弓箭手', atk:4,  def:3,  dmg:[2,3],   hp:12,  spd:4, shots:16, cost:{gold:100},      color:0x3f8f4f },
  griffin:   { name:'狮鹫',   atk:8,  def:8,  dmg:[3,6],   hp:25,  spd:6, fly:true, cost:{gold:200,wood:2}, color:0xc9963c },
  swordsman: { name:'剑士',   atk:10, def:12, dmg:[6,9],  hp:35,  spd:5, cost:{gold:300,ore:2},          color:0x8d99ae },
  champion:  { name:'骑士',   atk:16, def:16, dmg:[20,25], hp:100, spd:8, cost:{gold:1000,wood:5,ore:5},  color:0x33518f },
  // 精锐升级形态（兵营升级后可招募）
  pikeman2:   { name:'精锐枪兵', atk:3,  def:3,  dmg:[2,4],   hp:12,  spd:5, cost:{gold:90},                 color:0x94a8cc },
  archer2:    { name:'神射手',   atk:6,  def:4,  dmg:[3,4],   hp:12,  spd:5, shots:24, cost:{gold:150},      color:0x4faa5f },
  griffin2:   { name:'皇家狮鹫', atk:10, def:10, dmg:[4,7],   hp:30,  spd:7, fly:true, cost:{gold:300,wood:3}, color:0xdbab4e },
  swordsman2: { name:'十字军',   atk:12, def:14, dmg:[8,11],  hp:45,  spd:6, cost:{gold:450,ore:3},          color:0xa5b0c2 },
  champion2:  { name:'精英骑士', atk:19, def:19, dmg:[25,30], hp:120, spd:9, cost:{gold:1500,wood:8,ore:8}, color:0x4060b8 },
  // 野怪（不可招募）
  wolf:      { name:'恶狼',   atk:3,  def:2,  dmg:[2,4],   hp:12,  spd:6, color:0x5b5b66 },
  skeleton:  { name:'骷髅兵', atk:4,  def:4,  dmg:[2,3],   hp:15,  spd:4, color:0xd8d8c8 },
  orc:       { name:'兽人',   atk:6,  def:5,  dmg:[3,5],   hp:20,  spd:5, color:0x5f7d3a },
  ghost:     { name:'幽灵',   atk:7,  def:7,  dmg:[4,6],   hp:18,  spd:6, fly:true, color:0xafc3de },
  dragon:    { name:'黑龙',   atk:20, def:20, dmg:[25,40], hp:180, spd:11, fly:true, color:0x7a1f1f },
};

// 可招募兵种
export const RECRUITABLE = ['pikeman','archer','griffin','swordsman','champion'];
// 精锐兵种（兵营升级后）
export const RECRUITABLE2 = ['pikeman2','archer2','griffin2','swordsman2','champion2'];
// 精锐 → 基础形态映射（模型复用）
export const UPGRADE_BASE = { pikeman2:'pikeman', archer2:'archer', griffin2:'griffin', swordsman2:'swordsman', champion2:'champion' };
// 兵营升级费用
export const BARRACKS_COST = { gold: 1500, wood: 5, ore: 5 };

// 英雄技能树
export const SKILLS = {
  offense:    { name:'进攻术', max:3, desc:'我军近战伤害 +10%/级' },
  armorer:    { name:'防御术', max:3, desc:'我军受到伤害 -7%/级' },
  sorcery:    { name:'魔力',   max:3, desc:'法术伤害 +15%/级' },
  logistics:  { name:'后勤学', max:2, desc:'每日移动力 +2/级（立即生效）' },
  wisdom:     { name:'智慧',   max:3, desc:'魔法值上限 +4/级（立即生效）' },
  estates:    { name:'理财术', max:2, desc:'每日金币收入 +250/级' },
  luck:       { name:'幸运',   max:2, desc:'5%/级 概率造成双倍伤害' },
  leadership: { name:'领导术', max:2, desc:'士气高涨概率 +5%/级' },
};

// 地图常量
export const MAP = { W: 40, H: 40, TILE: 2, MOVE_MAX: 15 };

// 战场常量
export const BATTLE = { COLS: 13, ROWS: 9 };

// 英雄法术（魔法书）
export const SPELLS = {
  arrow:    { name:'魔法神箭', cost:4, target:'enemy', desc:'对单个敌人造成 50+15/级 伤害' },
  heal:     { name:'治疗术',   cost:5, target:'ally',  desc:'恢复 40+20/级 生命，可复活阵亡单位' },
  fireball: { name:'烈火火球', cost:6, target:'enemy', desc:'目标及周围一格所有部队受到 40+15/级 伤害（不分敌我）' },
  haste:    { name:'攻击加速', cost:3, target:'ally',  desc:'友军速度 +3（本场战斗有效）' },
  slow:     { name:'减速',     cost:4, target:'enemy', desc:'敌军速度减半，持续 3 回合' },
  bless:    { name:'祝福',     cost:4, target:'ally',  desc:'友军造成最大伤害 +20%，持续 4 回合' },
  chain:    { name:'连环闪电', cost:8, target:'enemy', desc:'闪电在最多 3 个敌军间跳跃，伤害依次递减' },
};

// 士气高涨概率（行动后额外行动一次）
export const MORALE_CHANCE = 0.10;

// 宝物
export const ARTIFACTS = {
  sword:  { name:'攻击之剑', desc:'英雄攻击 +1',   color:0xff6b35 },
  shield: { name:'防御之盾', desc:'英雄防御 +1',   color:0x35a2ff },
  boots:  { name:'速度之靴', desc:'每日移动力 +3', color:0x7dff6a },
  book:   { name:'魔法之书', desc:'魔法值上限 +4', color:0xc26bff },
};

// 矿场
export const MINES = {
  sawmill: { name:'锯木厂', income:{ wood:2 } },
  ore:     { name:'矿坑',   income:{ ore:2 } },
  gold:    { name:'金矿',   income:{ gold:300 } },
};

// 每日城堡基础收入
export const CASTLE_INCOME = 500;
