// ─────────────────────────────────────────────────────────────
// GRUDGE STUDIO — Gouldstone Behavior Profiles
// Per class + style. Matches class/weapon rules:
//   Warrior  — shield, sword, 2h; stamina system; double-jump; AoE
//   Mage     — staff, tome, wand, off-hand; teleport blocks (max 10)
//   Ranger   — bow, crossbow, gun, dagger, spear; parry counter
//   Worge    — 3 forms: bear (tank), raptor (stealth), bird (fly/mount)
// ─────────────────────────────────────────────────────────────

const PROFILES = {
  warrior: {
    balanced: {
      combat_style:   'melee_balanced',
      priority:       ['target_lock', 'charge_attack', 'parry', 'aoe_sweep'],
      stamina_use:    'conservative',       // fills via parry/dodge/block
      ally_behavior:  'protect_captain',
      dialogue_tone:  'stoic',
    },
    berserker: {
      combat_style:   'melee_all_in',
      priority:       ['charge_attack', 'aoe_sweep', 'double_jump', 'group_invincibility'],
      stamina_use:    'full_burn',
      ally_behavior:  'attack_nearest',
      dialogue_tone:  'frenzied',
    },
    guardian: {
      combat_style:   'defensive_tank',
      priority:       ['block', 'parry', 'group_invincibility', 'shield_bash'],
      stamina_use:    'parry_focused',      // extra stamina from perfect parries
      ally_behavior:  'intercept_attacks',
      dialogue_tone:  'disciplined',
    },
  },
  mage: {
    balanced: {
      combat_style:    'ranged_control',
      priority:        ['ranged_spell', 'teleport_block', 'crowd_control', 'healing'],
      teleport_blocks: 5,                  // uses up to 5 of the 10-block limit
      ally_behavior:   'support_and_attack',
      dialogue_tone:   'arcane',
    },
    archmage: {
      combat_style:    'ranged_burst',
      priority:        ['burst_spell', 'teleport_block', 'ranged_spell', 'retreat'],
      teleport_blocks: 8,
      ally_behavior:   'ranged_support',
      dialogue_tone:   'ancient',
    },
    healer: {
      combat_style:    'support_mage',
      priority:        ['healing', 'crowd_control', 'teleport_block', 'ranged_spell'],
      teleport_blocks: 3,
      ally_behavior:   'heal_priority',
      dialogue_tone:   'calm',
    },
  },
  ranger: {
    balanced: {
      combat_style:    'ranged_skirmish',
      priority:        ['bow_shot', 'parry_counter', 'dash_attack', 'retreat'],
      parry_window_ms: 2000,               // 2s window; perfect = instant dash counter
      ally_behavior:   'flank_and_shoot',
      dialogue_tone:   'sharp',
    },
    assassin: {
      combat_style:    'burst_sniper',
      priority:        ['stealth_approach', 'burst_shot', 'dash_attack', 'parry_counter'],
      parry_window_ms: 2000,
      ally_behavior:   'priority_target_kill',
      dialogue_tone:   'cold',
    },
    beastmaster: {
      combat_style:    'sustained_ranged',
      priority:        ['bow_shot', 'spread_shot', 'parry_counter', 'tracking'],
      parry_window_ms: 2000,
      ally_behavior:   'patrol_perimeter',
      dialogue_tone:   'wild',
    },
  },
  worge: {
    // Worge has 3 forms: bear (large+powerful), raptor (invisible+rogue), bird (flyable+mountable)
    balanced: {
      combat_style:  'shapeshifter',
      priority:      ['bear_charge', 'raptor_stealth', 'bird_scout', 'melee_hybrid'],
      form_weights:  { bear: 0.5, raptor: 0.3, bird: 0.2 },
      ally_behavior: 'adaptive_form',
      dialogue_tone: 'bestial',
    },
    bear_tank: {
      combat_style:  'bear_tank',
      priority:      ['bear_charge', 'bear_maul', 'bear_roar', 'protect_allies'],
      form_weights:  { bear: 0.9, raptor: 0.05, bird: 0.05 },
      ally_behavior: 'frontline_tank',
      dialogue_tone: 'rumbling',
    },
    raptor_rogue: {
      combat_style:  'raptor_assassin',
      priority:      ['raptor_stealth', 'raptor_pounce', 'raptor_shred', 'bird_escape'],
      form_weights:  { bear: 0.1, raptor: 0.8, bird: 0.1 },
      ally_behavior: 'flank_invisible',
      dialogue_tone: 'hissing',
    },
    sky_rider: {
      // Bird form — AI can be mounted by players/other AI companions
      combat_style:  'aerial_support',
      priority:      ['bird_flight', 'bird_dive', 'bear_land_charge', 'raptor_escape'],
      form_weights:  { bear: 0.2, raptor: 0.1, bird: 0.7 },
      ally_behavior: 'air_support_and_mount',
      dialogue_tone: 'soaring',
    },
  },
};

// Faction dialogue modifiers applied on top of base profile
const FACTION_DIALOGUE = {
  pirate:  { prefix: 'Arrr,',      tone_mod: 'boisterous' },
  undead:  { prefix: '*rasps*',    tone_mod: 'hollow'     },
  elven:   { prefix: '*whispers*', tone_mod: 'ethereal'   },
  orcish:  { prefix: 'GRAGH!',     tone_mod: 'thunderous' },
  default: { prefix: '',           tone_mod: 'neutral'    },
};

/**
 * Assign a behavior profile to a Gouldstone companion.
 * @param {string} cls    - warrior | mage | ranger | worge
 * @param {string} style  - see keys under each class above
 * @param {string} faction
 */
function assignProfile(cls, style, faction) {
  const classProfiles = PROFILES[cls] || PROFILES.warrior;
  const profile       = classProfiles[style] || classProfiles.balanced;
  const factionMod    = FACTION_DIALOGUE[(faction || '').toLowerCase()] || FACTION_DIALOGUE.default;
  return {
    class: cls,
    style,
    ...profile,
    faction_dialogue: factionMod,
    assigned_at: new Date().toISOString(),
  };
}

function getAvailableStyles(cls) {
  return Object.keys(PROFILES[cls] || PROFILES.warrior);
}

module.exports = { assignProfile, getAvailableStyles, PROFILES, FACTION_DIALOGUE };
