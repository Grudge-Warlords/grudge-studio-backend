/**
 * Narrate Routes — AI narrative generation for Gruda Armada campaign
 *
 * POST /ai/narrate — Generate narrative text for campaign events, log entries, story beats
 *
 * Request body:
 *   { eventType, playerName?, planetName?, factionName?, conquestPercent, recentBattles?, context? }
 *
 * Response:
 *   { title, narrative, choices?: { label, outcomeHint }[] }
 */

const { Router } = require('express');
const { callLLM } = require('../llm/provider');

const router = Router();

// ── System prompt for campaign narration ─────────────────────────
const NARRATE_SYSTEM_PROMPT = `You are the AI narrator for Gruda Armada, a space RTS campaign game.
The player's homeworld was devastated by an armageddon — shattered but not destroyed.
Chunks of the planet break off into orbit, becoming minable resources.
The player builds an off-world base and conquers a galaxy to earn the title "Conqueror of Galaxy",
which unlocks PvP Universe Wars. The campaign never ends.

The 4 factions are: Wisdom (knowledge/research), Construct (building/defense), Void (dark energy/stealth), Legion (military/swarm).

Write dramatic, evocative, short narrative text (2-4 sentences max).
Use second person ("you"). Be specific to the event type and context provided.
Do NOT use generic filler. Every sentence should advance the story or reveal something.`;

// ── POST /ai/narrate ─────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const {
      eventType, playerName, planetName, factionName,
      conquestPercent, recentBattles, context,
    } = req.body;

    if (!eventType) return res.status(400).json({ error: 'eventType required' });

    const userPrompt = buildPrompt({ eventType, playerName, planetName, factionName, conquestPercent, recentBattles, context });

    // Try LLM, fallback to template
    let result;
    try {
      const llmResponse = await callLLM({
        system: NARRATE_SYSTEM_PROMPT,
        prompt: userPrompt,
        maxTokens: 200,
        temperature: 0.8,
      });
      result = parseLLMResponse(llmResponse, eventType);
    } catch (llmErr) {
      console.warn('[narrate] LLM failed, using fallback:', llmErr.message);
      result = getFallback(eventType, planetName);
    }

    res.json(result);
  } catch (err) { next(err); }
});

// ── Build prompt from request context ────────────────────────────
function buildPrompt({ eventType, playerName, planetName, factionName, conquestPercent, recentBattles, context }) {
  let prompt = `Generate a campaign narrative for event type: "${eventType}".\n`;
  if (playerName) prompt += `Player name: ${playerName}.\n`;
  if (planetName) prompt += `Planet: ${planetName}.\n`;
  if (factionName) prompt += `Player's faction: ${factionName}.\n`;
  if (conquestPercent != null) prompt += `Conquest progress: ${conquestPercent}% of sector controlled.\n`;
  if (recentBattles) prompt += `Recent battles: ${recentBattles}.\n`;
  if (context) prompt += `Additional context: ${context}.\n`;
  prompt += `\nRespond in JSON: { "title": "short title", "narrative": "2-4 sentences" }`;
  if (eventType.startsWith('story_')) {
    prompt += `\nThis is a major story beat. Make it dramatic and memorable.`;
  }
  return prompt;
}

// ── Parse LLM response (expects JSON) ────────────────────────────
function parseLLMResponse(rawText, eventType) {
  try {
    // Try to extract JSON from the response
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        title: parsed.title || eventType.replace(/_/g, ' '),
        narrative: parsed.narrative || rawText,
        choices: parsed.choices || undefined,
      };
    }
  } catch { /* fall through */ }
  // If JSON parse fails, use raw text as narrative
  return {
    title: eventType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    narrative: rawText.slice(0, 500),
  };
}

// ── Fallback templates when LLM is unavailable ───────────────────
const FALLBACKS = {
  distress_signal: { title: 'Distress Signal', narrative: 'A garbled transmission cuts through the static. Someone — or something — is out there, drifting in the void between worlds.' },
  pirate_raid: { title: 'Pirate Raid', narrative: 'Pirate vessels drop out of warp, weapons hot. Their captain broadcasts a single demand: tribute or destruction.' },
  trade_offer: { title: 'Trade Convoy', narrative: 'A merchant fleet hails you from the edge of the system. Their cargo holds are full and their prices fair — for now.' },
  anomaly_scan: { title: 'Spatial Anomaly', narrative: 'Your sensors scream warnings as spatial distortions ripple across the sector. Something ancient stirs beneath the fabric of space.' },
  defector: { title: 'Enemy Defector', narrative: 'An encrypted message arrives from an enemy officer. They claim to have intelligence — and a desire to switch sides.' },
  plague: { title: 'Station Outbreak', narrative: 'Medical alerts cascade through the station corridors. A biological contaminant of unknown origin has breached containment.' },
  rebellion: { title: 'Colony Unrest', narrative: 'The workers have had enough. Production grinds to a halt as angry voices demand to be heard.' },
  ancient_discovery: { title: 'Ancient Artifact', narrative: 'Deep beneath the surface, excavation teams unearth something impossible — technology predating any known civilization.' },
  neural_surge: { title: 'Neural Surge', narrative: 'Every sensor array overloads simultaneously. A pulse of coherent energy sweeps the sector. The Neural network is evolving.' },
  story_escape: { title: 'The Escape', narrative: 'The drive fires. You rise above the cracking surface as your world shatters below — a burning ember in the infinite dark.' },
  story_first_base: { title: 'First Base', narrative: 'The lander touches down on orbital debris. Your first structure rises from the broken rock of home. Chunks drift by — minable, eternal.' },
  story_conqueror: { title: 'Conqueror', narrative: 'Every star in this sector answers to your command. But beyond the edge, the universe stirs. The wars are just beginning.' },
};

function getFallback(eventType, planetName) {
  const fb = FALLBACKS[eventType] || FALLBACKS[eventType.replace('story_', '')] || {
    title: 'Event',
    narrative: `Something unfolds near ${planetName || 'your position'} in the darkness of space.`,
  };
  return { title: fb.title, narrative: fb.narrative.replace('{planet}', planetName || 'the void') };
}

module.exports = router;
