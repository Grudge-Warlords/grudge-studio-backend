// ─────────────────────────────────────────────────────────────
// GRUDGE STUDIO — AI Mission Templates
// Tiered by character level, faction, and mission type.
// No external LLM dependency — deterministic + seeded random.
// ─────────────────────────────────────────────────────────────

const REWARD_TABLES = {
  low:   { xp: [40,  80],   gold: [10,  25]  }, // level 1-24
  mid:   { xp: [100, 200],  gold: [30,  75]  }, // level 25-49
  high:  { xp: [250, 500],  gold: [80,  150] }, // level 50-74
  elite: { xp: [600, 1000], gold: [200, 400] }, // level 75-100
};

const TEMPLATES = {
  harvesting: {
    default: {
      low:   ['Gather iron ore from the Rust Caverns', 'Fish the Tide Shores at dawn', 'Cut timber from the Briar Woods', 'Farm wild wheat near the Old Mill', 'Hunt boar in the Mudstone Hills'],
      mid:   ['Mine gold veins beneath Shattered Peak', 'Deep-sea fish near the Abyssal Reef', 'Log ancient oaks in the Cursed Forest', 'Cultivate shadowbloom in the Hollow Fields', 'Hunt wyvern cubs near Ashfall Ridge'],
      high:  ['Extract crystal ore from the Ember Mines', 'Harvest leviathan kelp from the Storm Deep', 'Fell elder ironwood in the Wraithwood', 'Grow bloodroot in the Plagued Flats', 'Hunt spectral elk in the Ghostfen'],
      elite: ['Carve elder stone from the Primordial Vaults', 'Pull abyssal coral from the Sunken City', 'Harvest godwood from the Ancient Grove', 'Cultivate star-grain in the Celestial Fields', 'Hunt the Undying Mammoth in the Frozen Wastes'],
    },
    pirate: {
      low:   ['Scavenge salvage from the wrecked galleon', 'Fish for bonefish near Skull Cove', 'Cut planks from the Mangrove Thicket'],
      mid:   ['Raid the merchant convoy for exotic spices', 'Dive the sunken treasure hoard', 'Fell ironwood masts from the beached warship'],
      high:  ['Seize the royal ore shipment at sea', 'Harvest dragonbone from the sea serpent carcass'],
      elite: ['Claim the legendary Tidestone from the Drowned Keep'],
    },
    undead: {
      low:   ['Collect bone shards from the Catacombs', 'Extract grave-soil from the Haunted Cemetery'],
      mid:   ['Mine spirit-iron from the Lich\'s Depths', 'Harvest void-moss from the Necrotic Swamp'],
      high:  ['Extract soul-crystal from the Wraith Spire', 'Cultivate deathbloom in the Blighted Fields'],
      elite: ['Carve primordial bone from the Ancient Colossus'],
    },
    elven: {
      low:   ['Gather moonleaf from the Silver Glade', 'Fish the Crystal Stream at midnight'],
      mid:   ['Harvest starwood from the Ancient Canopy', 'Cultivate elfbloom in the Twilight Garden'],
      high:  ['Extract astral ore from the Sky Mines', 'Hunt the Moonwyrm in the Elvenmoor'],
      elite: ['Claim the Heartwood of the World Tree'],
    },
    orcish: {
      low:   ['Mine rough iron from the Orcish Quarry', 'Hunt dire wolves in the Warclan Hills'],
      mid:   ['Harvest troll-iron from the Ravine Mines', 'Fell warwood in the Battle-Scarred Forest'],
      high:  ['Extract bloodstone from the Warlord\'s Mine', 'Hunt the Iron Mammoth on the Frozen Steppe'],
      elite: ['Claim the Warchief\'s Ironhide from the Raid Vault'],
    },
  },
  fighting: {
    default: {
      low:   ['Clear the bandit camp on the Trade Road', 'Defeat the cave troll at the eastern pass', 'Repel the goblin raid on the outpost', 'Eliminate the cursed wolves near the village', 'Slay the corrupted merchant captain'],
      mid:   ['Storm the pirate fortress on Daggerpoint Isle', 'Defeat the rogue warlord and his mercenaries', 'Ambush the rival faction patrol near the border', 'Hunt down the renegade mage terrorizing the coast', 'Destroy the skeleton horde besieging the lighthouse'],
      high:  ['Slay the sea dragon terrorizing the trade lanes', 'Defeat the cursed knight guarding the ruins', 'Eliminate the shapeshifter assassin', 'Destroy the bone golem in the Necrotic Tomb', 'Assault the enemy war camp at midnight'],
      elite: ['Defeat the legendary Warlord Grakkus', 'Slay the Lich King\'s Champion', 'Destroy the Void Titan awakened from the deep', 'Conquer the Demon General in the Abyssal Citadel', 'Vanquish the Dragon Overlord of Ashfall'],
    },
  },
  sailing: {
    default: {
      low:   ['Patrol the coastal waters and report enemy movements', 'Escort the merchant vessel to safe harbor', 'Map the uncharted islands north of the Spine', 'Deliver urgent supplies to the garrison on Sentinel Isle'],
      mid:   ['Intercept the pirate fleet blockading the port', 'Navigate the Maelstrom to reach the Fabled Isle', 'Race the rival faction to the sunken treasure map', 'Capture the enemy supply ship without sinking it'],
      high:  ['Lead the naval assault on the fortress coast', 'Sail through the ghost fleet to reach the Cursed Reef', 'Outrun the sea wyrm to deliver the war treaty', 'Navigate the Void Rift to the Hidden Archipelago'],
      elite: ['Command the flagship in the Final Armada battle', 'Sail into the Storm God\'s Eye and return alive', 'Claim the legendary ghost ship as your own'],
    },
  },
  competing: {
    default: {
      low:   ['Win the faction trial at the Proving Grounds', 'Place top 3 in the harvest competition at the Autumn Fair', 'Outlast all rivals in the Island Endurance Race'],
      mid:   ['Win the arena tournament in the Capital', 'Beat the champion crafter in the forge duel', 'Outbid all rivals at the Black Market Auction'],
      high:  ['Claim the Warlord\'s Belt in the Grand Tournament', 'Win the sailing race around the Shattered Isles', 'Dominate the faction war games undefeated'],
      elite: ['Become Champion of the Grudge Colosseum', 'Win the legendary Pirate King\'s Gambit', 'Claim the title of Grand Warlord in the Final Games'],
    },
  },
};

function getLevelTier(level) {
  if (level <= 24) return 'low';
  if (level <= 49) return 'mid';
  if (level <= 74) return 'high';
  return 'elite';
}

// Deterministic seeded random — same inputs always give same mission
function seededRand(seed) {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

function randRange(min, max, seed) {
  return min + Math.floor(seededRand(seed) * (max - min + 1));
}

function pickTemplate(type, faction, tier, seed) {
  const byType    = TEMPLATES[type] || TEMPLATES.harvesting;
  const byFaction = byType[faction] || byType.default;
  const list      = byFaction[tier] || byFaction.low || byType.default.low;
  return list[Math.floor(seededRand(seed) * list.length)];
}

/**
 * Generate a mission for a character.
 * @param {{ level?: number, faction?: string }} character
 * @param {string} type - harvesting | fighting | sailing | competing
 * @param {number} seed - use Date.now() or characterId for determinism
 */
function generateMission(character, type, seed) {
  const tier    = getLevelTier(character.level || 1);
  const faction = (character.faction || 'default').toLowerCase();
  const rewards = REWARD_TABLES[tier];
  return {
    title:       pickTemplate(type, faction, tier, seed),
    type,
    tier,
    reward_xp:   randRange(rewards.xp[0],   rewards.xp[1],   seed + 1),
    reward_gold: randRange(rewards.gold[0], rewards.gold[1], seed + 2),
  };
}

module.exports = { generateMission, TEMPLATES, REWARD_TABLES, getLevelTier };
