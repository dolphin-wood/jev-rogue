/**
 * 简体中文 content: names and descriptions keyed by the id `core` uses.
 *
 * Core keeps its English — the harness reads it, the tests match it, and it
 * is what the Director is sent — so this is a lookup beside it rather than a
 * replacement for it. An id missing here falls back to core's English, which
 * is how English costs nothing and how a half-finished language still plays.
 *
 * Names are kept identical wherever a spell appears: the card, the action
 * bar, the character screen and the toast all read the same two or three
 * characters, because a player learns a spell by its name long before they
 * read what it does.
 */
import type { ContentTable } from "./index.ts";

export const ZH_CONTENT: ContentTable = {
  /* -------------------------------- attacks ------------------------------ */
  magic_bolt: { name: "魔法飞弹", description: "发射一枚快速飞弹。法力消耗最低。" },
  shock_arc: { name: "电弧", description: "发射一道电弧，命中后跳向附近至多 2 个敌人，每跳一次伤害减半。适合对付成群的敌人。" },
  spark_spray: { name: "火花喷射", description: "向前方扇形喷出火花。" },
  stone_shard: { name: "碎石", description: "掷出一块碎石。普通品质攻击法术中单发伤害最高。" },
  earth_spikes: { name: "地刺", description: "沿直线接连刺出石刺，使命中的敌人踉跄。适合对付排成一列的敌人。" },
  flame_pillars: { name: "火柱", description: "沿直线接连升起火柱，经过的地面会燃烧一段时间。" },
  cinder_geysers: { name: "熔火喷泉", description: "在目标脚下及周围接连喷出火焰。适合对付成群的敌人。" },
  ember_dart: { name: "火镖", description: "命中时点燃目标。" },
  frost_needle: { name: "冰针", description: "命中时使目标冰缓，移动变慢。" },
  venom_spit: { name: "毒液喷射", description: "命中时施加可叠加的中毒。施放越快，叠加越多。" },
  arc_lance: { name: "雷枪", description: "掷出一杆高速雷枪，贯穿沿途的敌人。" },
  scatter_shot: { name: "霰弹", description: "向前方锥形喷出弹丸。距离越近，命中越多。" },
  cinder_burst: { name: "双火种", description: "射出两枚燃烧的火种。法力消耗高。" },
  glacier_spike: { name: "冰川尖刺", description: "刺出一根巨大的冰锥，使命中的敌人减速。" },
  void_orb: { name: "虚空球", description: "放出一颗缓慢的虚空球，穿过一切并击退敌人。冷却时间长。" },
  plague_bloom: { name: "疫病孢子", description: "撒出孢子，使接触到的敌人中毒。" },
  spirit_blades: { name: "灵刃", description: "召唤三把灵刃环绕自身，切割接触到的敌人。再次施放会重置灵刃，不会叠加。" },
  wildfire_field: { name: "野火", description: "点燃最近敌人脚下的地面。火焰熄灭前，踏入其中的敌人都会着火。" },
  blink_strike: { name: "闪身斩", description: "向前闪身，斩击沿途的每个敌人。闪身期间无敌。" },
  void_maw: { name: "虚空漩涡", description: "在最近的敌人脚下打开漩涡，数秒内将周围的敌人拉向中心，并持续造成伤害。" },
  spirit_ally: { name: "灵魂随从", description: "召唤一个跟随你的灵魂，在一段时间内自动射击最近的敌人。" },
  frost_nova: { name: "冰霜新星", description: "以自身为中心爆发一圈冰刃，冻结附近的敌人。只能命中近处的敌人。" },
  seeker_swarm: { name: "追踪飞镖", description: "放出一群自动追踪敌人的飞镖，必定命中。用来对付单个敌人时性价比较低。" },
  fault_line: { name: "断层", description: "推出一道石刃，贯穿整条直线上的敌人。" },
  stone_ward: { name: "石柱", description: "在身前升起一根石柱，推开并伤害附近的敌人。石柱被摧毁前会阻挡敌人和子弹。" },
  mana_darts: { name: "蓄能飞镖", description: "未施放时逐枚蓄积飞镖，最多 5 枚。施放时将蓄积的飞镖一齐扇形射出，并追踪前方的敌人。" },
  arcane_cannon: { name: "奥术炮", description: "按住蓄力，松开发射一枚贯穿敌人的炮弹。蓄力越久，炮弹越大；蓄满时可使敌人踉跄。蓄力时移动减慢，冲刺可取消蓄力且不消耗法力。" },
  doom_sigil: { name: "厄运印记", description: "为命中的敌人附加印记，数秒后印记爆发，伤害该敌人及其周围的敌人。印记爆发前，无法对同一敌人再次附加印记。" },
  frozen_orb: { name: "冰封球", description: "放出一颗缓慢的冰球，穿过沿途的敌人并不断向四周射出冰片，最后炸开成一圈冰片。" },
  contagion: { name: "传染", description: "射出一团浓毒。中毒的敌人死亡时，毒素会传染给附近的数个敌人，并继续扩散。" },
  meteor: { name: "陨石", description: "在目标敌人脚下标记落点，片刻后陨石坠落，并使地面燃烧。敌人可以离开标记范围。" },
  quake_ring: { name: "震地环", description: "以自身为中心，一圈接一圈地震裂地面，使命中的敌人踉跄。" },
  leap_slam: { name: "跃击", description: "跃向目标敌人，落地时震碎周围一圈地面。跃起期间无敌。" },
  ball_lightning: { name: "球状闪电", description: "放出一颗缓慢漂移的雷球，每秒数次电击范围内最近的敌人。可同时存在数颗，数量已满时新雷球会替换最早的一颗。" },
  returning_edge: { name: "回旋刃", description: "向前掷出一把灵体之剑，减速后折返，飞回你当前的位置。去程和回程各可命中每个敌人一次。" },
  crescent_edge: { name: "新月剑气", description: "一段时间内，每次挥剑（无论是否命中）都会向前射出一道新月剑气，贯穿范围内的所有敌人，命中时也会积攒少量怒气。再次施放可重置持续时间。" },
  counter_stance: { name: "反击架势", description: "进入短暂的反击架势，期间移动减慢且无法挥剑。抵消下一次命中你的攻击，并以回旋斩反击，使敌人踉跄。若期间未被击中，架势结束时会释放一次较弱的回旋斩。" },
  dash_slash: { name: "冲刺斩", description: "举剑向前冲刺，斩击沿途的每个敌人。冲刺路径两侧会依次展开剑气，斩击其扫过的敌人。冲刺期间无敌。" },
  cinder_stride: { name: "余烬步", description: "数秒内，你每走一步都会在身后留下一片火焰，站立不动时不会留下。你的火焰不会伤害你自己。" },
  toxic_cloud: { name: "毒雾", description: "在最近的敌人脚下释放一团毒雾，使其中的敌人中毒并减速。" },

  /* -------------------------------- affixes ------------------------------ */
  fork: { name: "分叉", description: "命中后分裂成数块碎片，继续向前飞行。" },
  chain: { name: "连锁", description: "命中后，向附近的下一个敌人释放一个较小、较弱的同款法术。" },
  brand: { name: "烙印", description: "第一次命中施加印记，第二次命中将其引爆。" },
  harvest: { name: "收割", description: "被此法术击杀的敌人会爆炸。" },
  bloom: { name: "绽放", description: "弹丸飞到尽头时点燃地面，灼烧其上的敌人。未命中也会生效。" },
  shatter: { name: "碎裂", description: "命中墙壁或障碍物时也会溅出碎片。" },
  repeat: { name: "回响", description: "施放后片刻，朝你当时瞄准的方向自动再施放一次。" },
  scatter: { name: "散射", description: "法术会同时向四周射出。" },
  ward: { name: "守护", description: "施法时在脚下留下一道符文，抵挡敌人的子弹。" },
  retort: { name: "还击", description: "受到伤害时，向攻击你的敌人施放一次此法术，不消耗法力。" },
  slipstream: { name: "尾流", description: "冲刺穿过敌人时，对其施放此法术。" },
  pierce: { name: "穿透", description: "弹丸可穿透命中的敌人。" },
  seek: { name: "追踪", description: "弹丸会转向最近的敌人。" },
  ricochet: { name: "弹跳", description: "弹丸撞到墙壁时会反弹。" },
  kindle: { name: "引燃", description: "命中时额外叠加灼烧，不影响法术原有的元素；火焰法术会更快点燃敌人。同时带有两种元素状态的敌人会受到更多伤害。" },
  rime: { name: "霜冻", description: "命中时额外叠加冰冻，不影响法术原有的元素；被冻结的敌人被击碎时受到三倍伤害。同时带有两种元素状态的敌人会受到更多伤害。" },
  blight: { name: "枯萎", description: "命中时额外叠加中毒，不影响法术原有的元素；中毒会使敌人减速并持续受到伤害。同时带有两种元素状态的敌人会受到更多伤害。" },
  haste: { name: "急速", description: "用此法术击杀敌人时，冷却恢复更快。" },
  resonance: { name: "共鸣", description: "挥剑每命中数次，就会对被击中的敌人施放一次此法术，不消耗法力。" },
  momentum: { name: "乘势", description: "冲刺每斩过一个敌人，就会继续向前多冲一段，最多三次。" },
  undertow: { name: "回流", description: "冲刺两侧的剑气不再击退敌人，而是把敌人吸向冲刺路线；冲刺本身只会把敌人向前推一点。" },
  finale: { name: "收势", description: "冲刺结束时，向前甩出一道新月剑气，贯穿范围内的每个敌人。" },

  /* --------------------------------- stats ------------------------------- */
  fleet: { name: "轻盈", description: "移动更快。" },
  second_wind: { name: "回气", description: "冲刺冷却更短。" },
  long_stride: { name: "阔步", description: "冲刺距离更远。" },
  wrath: { name: "怒火", description: "怒气上限增加，可多储存回旋斩。" },
  vigour: { name: "体魄", description: "生命上限提高，并回满生命值。" },
  steady_nerve: { name: "镇定", description: "受击后的无敌时间更长。" },
  deep_well: { name: "深泉", description: "法力上限提高。" },
  quickening: { name: "回流", description: "法力自然回复更快。" },
  leeching_edge: { name: "吸魔之刃", description: "挥剑命中时回复更多法力。" },
  keen_edge: { name: "利刃", description: "剑的伤害提高。" },
  long_reach: { name: "长刃", description: "挥剑的范围更大。" },
  swift_hand: { name: "快剑", description: "挥剑后摇更短，连击间隔也更短。" },

  /* -------------------------------- schools ------------------------------ */
  flame: { name: "火焰" },
  frost: { name: "寒冰" },
  venom: { name: "剧毒" },
  storm: { name: "雷电" },
  void: { name: "虚空" },
  spirit: { name: "灵魂" },
  stone: { name: "岩石" },

  /* --------------------------------- styles ------------------------------ */
  "style.spam": { name: "弹幕", description: "持续施放廉价、快速的法术，用连锁和扇形弹幕铺满全屏。" },
  "style.nuke": { name: "重击", description: "出手少，伤害高。施放缓慢、消耗高的法术，一击结束战斗。" },
  "style.area": { name: "群攻", description: "用爆炸、光环和地面效果同时攻击大量敌人。" },
  "style.dot": { name: "侵蚀", description: "用灼烧和中毒持续造成伤害，同时保持走位。" },
  "style.melee": { name: "近战", description: "持剑近身作战，搭配环绕自身或由挥剑触发的法术。" },
};
