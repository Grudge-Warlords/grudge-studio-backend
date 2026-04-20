/**
 * Legion AI — GRD-17 Inter-Node Communication Protocol
 *
 * Enables GRUDA NODE AI agents across the mesh to coordinate:
 *   - Mission generation & distribution
 *   - Faction intelligence sharing
 *   - Companion AI synchronization
 *   - Game balance analysis
 *   - Lore & narrative generation
 *
 * Protocol: GRD-17-{MSG_TYPE}-{SEQ}
 * Transport: HTTP REST via grudge-bridge peer mesh
 * Security: HMAC-SHA256 signed envelopes
 */

import crypto from "crypto";
import type { BridgeConfig } from "../bridge.config";
import { resolvePeerUrl } from "./peers";

// ── GRD-17 Protocol Types ─────────────────────────────────

export type GRD17MessageType =
  | "MISSION"
  | "INTEL"
  | "COMPANION"
  | "BALANCE"
  | "NARRATE"
  | "SYNC"
  | "ACK"
  | "AI_REQUEST"
  | "AI_RESPONSE";

export interface GRD17Envelope {
  /** Protocol identifier: always "GRD-17" */
  protocol: "GRD-17";
  /** Message ID: GRD-17-{TYPE}-{SEQ} */
  messageId: string;
  /** Message type */
  type: GRD17MessageType;
  /** Monotonic sequence number */
  seq: number;
  /** Sending node name */
  fromNode: string;
  /** Target node name ("*" for broadcast) */
  toNode: string;
  /** Message payload (type-specific) */
  payload: unknown;
  /** ISO timestamp */
  timestamp: string;
  /** HMAC-SHA256 of the payload */
  hmac: string;
  /** Optional: reply-to message ID */
  replyTo?: string;
  /** Message TTL (seconds remaining) */
  ttl: number;
}

export interface LegionStatus {
  enabled: boolean;
  nodeName: string;
  totalSent: number;
  totalReceived: number;
  totalAcked: number;
  inboxSize: number;
  lastSeq: number;
  connectedPeers: string[];
  aiProviders: { gemini: boolean; anthropic: boolean; aiAgent: boolean };
}

export interface AIRequestPayload {
  /** AI action to perform (maps to ai-agent routes) */
  action: "mission" | "companion" | "faction" | "lore" | "art" | "chat" | "narrate" | "balance";
  /** Request body for the AI action */
  body: Record<string, unknown>;
  /** Optional: requesting grudge_id */
  grudgeId?: string;
}

export interface AIResponsePayload {
  /** Original action */
  action: string;
  /** Success flag */
  success: boolean;
  /** Response data from AI */
  data: unknown;
  /** Processing time in ms */
  processingMs: number;
  /** Which provider handled the request */
  provider: string;
}

// ── State ─────────────────────────────────────────────────

interface LegionState {
  enabled: boolean;
  seq: number;
  inbox: GRD17Envelope[];
  outbox: GRD17Envelope[];
  acked: Set<string>;
  totalSent: number;
  totalReceived: number;
  totalAcked: number;
  connectedPeers: Set<string>;
}

const state: LegionState = {
  enabled: false,
  seq: 0,
  inbox: [],
  outbox: [],
  acked: new Set(),
  totalSent: 0,
  totalReceived: 0,
  totalAcked: 0,
  connectedPeers: new Set(),
};

// ── Init ──────────────────────────────────────────────────

export function initLegion(config: BridgeConfig): void {
  state.enabled = config.legion.enabled;

  if (!state.enabled) {
    console.log("[legion] GRD-17 disabled via LEGION_ENABLED=false");
    return;
  }

  if (!config.legion.hmacSecret) {
    console.warn("[legion] ⚠️ GRD17_HMAC_SECRET not set — messages will be unsigned");
  }

  const providers = [];
  if (config.legion.geminiApiKey) providers.push("Gemini");
  if (config.legion.anthropicApiKey) providers.push("Anthropic");
  providers.push("ai-agent");

  console.log(`[legion] GRD-17 protocol active | Providers: ${providers.join(", ")}`);
}

// ── Message Construction ──────────────────────────────────

function nextSeq(): number {
  return ++state.seq;
}

function computeHmac(payload: unknown, secret: string): string {
  if (!secret) return "unsigned";
  return crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(payload))
    .digest("hex");
}

export function verifyHmac(
  envelope: GRD17Envelope,
  secret: string
): boolean {
  if (!secret || envelope.hmac === "unsigned") return true;
  const expected = computeHmac(envelope.payload, secret);
  return crypto.timingSafeEqual(
    Buffer.from(envelope.hmac, "hex"),
    Buffer.from(expected, "hex")
  );
}

export function createEnvelope(
  config: BridgeConfig,
  type: GRD17MessageType,
  toNode: string,
  payload: unknown,
  replyTo?: string
): GRD17Envelope {
  const seq = nextSeq();
  return {
    protocol: "GRD-17",
    messageId: `GRD-17-${type}-${String(seq).padStart(5, "0")}`,
    type,
    seq,
    fromNode: config.nodeName,
    toNode,
    payload,
    timestamp: new Date().toISOString(),
    hmac: computeHmac(payload, config.legion.hmacSecret),
    replyTo,
    ttl: config.legion.messageTtlSecs,
  };
}

// ── Message Sending ───────────────────────────────────────

/**
 * Send a GRD-17 message to a specific peer or broadcast to all.
 */
export async function sendMessage(
  config: BridgeConfig,
  envelope: GRD17Envelope
): Promise<{ delivered: string[]; failed: string[] }> {
  const delivered: string[] = [];
  const failed: string[] = [];

  for (const peer of config.peers) {
    const resolved = await resolvePeerUrl(peer, "/api/bridge/health");
    if (!resolved) {
      failed.push("unresolvable");
      continue;
    }

    // If targeted, check if this is the right peer
    if (envelope.toNode !== "*") {
      try {
        const healthResp = await fetch(`${resolved.url}/api/bridge/health`, {
          headers: { Authorization: `Bearer ${config.bridgeApiKey}` },
          signal: AbortSignal.timeout(3000),
        });
        if (healthResp.ok) {
          const health = (await healthResp.json()) as { nodeName: string };
          if (health.nodeName !== envelope.toNode) continue;
        }
      } catch {
        continue;
      }
    }

    try {
      const resp = await fetch(`${resolved.url}/api/bridge/legion/receive`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.bridgeApiKey}`,
        },
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(10000),
      });

      if (resp.ok) {
        delivered.push(resolved.ip);
        state.connectedPeers.add(resolved.ip);
      } else {
        failed.push(resolved.ip);
      }
    } catch {
      failed.push(resolved.ip);
    }
  }

  state.outbox.push(envelope);
  state.totalSent++;

  return { delivered, failed };
}

// ── Message Receiving ─────────────────────────────────────

/**
 * Receive a GRD-17 message from a peer.
 * Validates HMAC, checks TTL, stores in inbox.
 */
export function receiveMessage(
  config: BridgeConfig,
  envelope: GRD17Envelope
): { accepted: boolean; reason?: string } {
  // Validate protocol
  if (envelope.protocol !== "GRD-17") {
    return { accepted: false, reason: "Invalid protocol" };
  }

  // Validate HMAC
  if (config.legion.hmacSecret && !verifyHmac(envelope, config.legion.hmacSecret)) {
    return { accepted: false, reason: "HMAC verification failed" };
  }

  // Check TTL
  const age = (Date.now() - new Date(envelope.timestamp).getTime()) / 1000;
  if (age > envelope.ttl) {
    return { accepted: false, reason: "Message expired (TTL)" };
  }

  // Check inbox size
  if (state.inbox.length >= config.legion.maxInboxSize) {
    return { accepted: false, reason: "Inbox full — backpressure" };
  }

  // Check for duplicates
  if (state.inbox.some((m) => m.messageId === envelope.messageId)) {
    return { accepted: false, reason: "Duplicate message" };
  }

  state.inbox.push(envelope);
  state.totalReceived++;
  state.connectedPeers.add(envelope.fromNode);

  return { accepted: true };
}

// ── Message Acknowledgment ────────────────────────────────

export function acknowledgeMessage(messageId: string): boolean {
  const idx = state.inbox.findIndex((m) => m.messageId === messageId);
  if (idx === -1) return false;

  state.inbox.splice(idx, 1);
  state.acked.add(messageId);
  state.totalAcked++;
  return true;
}

// ── AI Request Routing ────────────────────────────────────

/**
 * Route an AI request through GRD-17 to the best available node.
 *
 * Priority:
 *   1. Local ai-agent (if on primary node)
 *   2. Gemini API direct call (GRUDA NODE AI)
 *   3. Relay to primary via GRD-17
 */
export async function routeAIRequest(
  config: BridgeConfig,
  request: AIRequestPayload
): Promise<AIResponsePayload> {
  const start = Date.now();

  // 1. Try local ai-agent (primary only)
  if (config.nodeRole === "primary") {
    try {
      const result = await callLocalAIAgent(config, request);
      return {
        action: request.action,
        success: true,
        data: result,
        processingMs: Date.now() - start,
        provider: "ai-agent-local",
      };
    } catch (err: any) {
      console.warn(`[legion] Local ai-agent failed: ${err.message}`);
    }
  }

  // 2. Try Gemini API (GRUDA NODE AI)
  if (config.legion.geminiApiKey) {
    try {
      const result = await callGeminiAI(config, request);
      return {
        action: request.action,
        success: true,
        data: result,
        processingMs: Date.now() - start,
        provider: "gemini-gruda",
      };
    } catch (err: any) {
      console.warn(`[legion] Gemini failed: ${err.message}`);
    }
  }

  // 3. Relay to primary via GRD-17
  if (config.nodeRole !== "primary") {
    try {
      const result = await relayAIToPrimary(config, request);
      return {
        action: request.action,
        success: true,
        data: result,
        processingMs: Date.now() - start,
        provider: "grd17-relay",
      };
    } catch (err: any) {
      console.warn(`[legion] GRD-17 relay failed: ${err.message}`);
    }
  }

  return {
    action: request.action,
    success: false,
    data: { error: "All AI providers unavailable" },
    processingMs: Date.now() - start,
    provider: "none",
  };
}

/**
 * Call the local ai-agent service (runs on primary).
 */
async function callLocalAIAgent(
  config: BridgeConfig,
  request: AIRequestPayload
): Promise<unknown> {
  const actionMap: Record<string, string> = {
    mission: "/ai/mission/generate",
    companion: "/ai/companion/interact",
    faction: "/ai/faction/intel",
    lore: "/ai/lore/generate",
    art: "/ai/art/generate",
    chat: "/ai/chat",
    narrate: "/ai/narrate",
    balance: "/ai/balance/analyze",
  };

  const path = actionMap[request.action];
  if (!path) throw new Error(`Unknown AI action: ${request.action}`);

  const resp = await fetch(`${config.legion.aiAgentUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-key": config.bridgeApiKey,
    },
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    throw new Error(`ai-agent returned ${resp.status}`);
  }

  return resp.json();
}

/**
 * Call Gemini API directly for AI generation (GRUDA NODE AI).
 */
async function callGeminiAI(
  config: BridgeConfig,
  request: AIRequestPayload
): Promise<unknown> {
  const prompt = buildGrudaPrompt(request);

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${config.legion.geminiApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
        },
      }),
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${err}`);
  }

  const data = (await resp.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

  // Try to parse as JSON if the response looks like JSON
  try {
    if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
      return JSON.parse(text);
    }
  } catch {
    // Not JSON, return as text
  }

  return { text, raw: true };
}

/**
 * Build a GRUDA-context-aware prompt for the AI request.
 */
function buildGrudaPrompt(request: AIRequestPayload): string {
  const context = `You are GRUDA NODE AI, the AI brain for Grudge Warlords — a souls-like MMO with crafting, factions (Crusade, Legion, Fabled), 4 classes (Warrior, Mage, Ranger, Worge), 6 races, 10 islands, crew-based PvP, and permadeath mechanics. Respond in JSON when possible.`;

  const actionPrompts: Record<string, string> = {
    mission: `Generate a dynamic mission for the player. Include: title, description, objectives (array), rewards (gold, xp, items), difficulty, estimated_time, faction_alignment.`,
    companion: `Generate an AI companion interaction. Include: dialogue, action, mood, loyalty_change, context_awareness.`,
    faction: `Provide faction intelligence briefing. Include: faction_status, territories, threats, opportunities, recommended_actions.`,
    lore: `Generate in-game lore entry. Include: title, text, era, related_locations, related_characters.`,
    art: `Describe a game art asset. Include: description, style, colors, mood, suggested_filename.`,
    chat: `Respond as an in-game NPC. Stay in character for the Grudge Warlords universe.`,
    narrate: `Narrate a game event. Include dramatic, souls-like tone with Grudge universe references.`,
    balance: `Analyze game balance data. Include: assessment, recommendations, risk_areas, suggested_adjustments.`,
  };

  const actionContext = actionPrompts[request.action] || "Process this game-related request.";

  return `${context}\n\nTask: ${actionContext}\n\nInput: ${JSON.stringify(request.body)}`;
}

/**
 * Relay an AI request to the primary node via peer mesh.
 */
async function relayAIToPrimary(
  config: BridgeConfig,
  request: AIRequestPayload
): Promise<unknown> {
  for (const peer of config.peers) {
    const resolved = await resolvePeerUrl(peer, "/api/bridge/health");
    if (!resolved) continue;

    try {
      const healthResp = await fetch(`${resolved.url}/api/bridge/health`, {
        headers: { Authorization: `Bearer ${config.bridgeApiKey}` },
        signal: AbortSignal.timeout(3000),
      });

      if (!healthResp.ok) continue;
      const health = (await healthResp.json()) as { nodeRole: string };
      if (health.nodeRole !== "primary") continue;

      // Found primary — send AI request
      const resp = await fetch(
        `${resolved.url}/api/bridge/legion/ai/${request.action}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.bridgeApiKey}`,
          },
          body: JSON.stringify(request.body),
          signal: AbortSignal.timeout(30000),
        }
      );

      if (resp.ok) return resp.json();
    } catch {
      continue;
    }
  }

  throw new Error("Primary node unreachable");
}

// ── Housekeeping ──────────────────────────────────────────

/**
 * Purge expired messages from inbox and outbox.
 */
export function purgeExpired(): { purgedInbox: number; purgedOutbox: number } {
  const now = Date.now();
  let purgedInbox = 0;
  let purgedOutbox = 0;

  state.inbox = state.inbox.filter((m) => {
    const age = (now - new Date(m.timestamp).getTime()) / 1000;
    if (age > m.ttl) {
      purgedInbox++;
      return false;
    }
    return true;
  });

  // Keep only last 200 outbox messages
  if (state.outbox.length > 200) {
    purgedOutbox = state.outbox.length - 200;
    state.outbox = state.outbox.slice(-200);
  }

  // Trim acked set
  if (state.acked.size > 5000) {
    const arr = Array.from(state.acked);
    state.acked = new Set(arr.slice(-2500));
  }

  return { purgedInbox, purgedOutbox };
}

// ── Status ────────────────────────────────────────────────

export function getLegionStatus(config: BridgeConfig): LegionStatus {
  return {
    enabled: state.enabled,
    nodeName: config.nodeName,
    totalSent: state.totalSent,
    totalReceived: state.totalReceived,
    totalAcked: state.totalAcked,
    inboxSize: state.inbox.length,
    lastSeq: state.seq,
    connectedPeers: Array.from(state.connectedPeers),
    aiProviders: {
      gemini: !!config.legion.geminiApiKey,
      anthropic: !!config.legion.anthropicApiKey,
      aiAgent: config.nodeRole === "primary",
    },
  };
}

export function getInbox(limit = 50): GRD17Envelope[] {
  return state.inbox.slice(0, limit);
}
