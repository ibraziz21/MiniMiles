// lib/crackpotTypes.ts

// ── Feedback ─────────────────────────────────────────────────────

/** Raw feedback from the server (after noise injection on close/miss) */
export type FeedbackResult = "locked" | "close" | "miss";

export type GuessFeedback = [FeedbackResult, FeedbackResult, FeedbackResult, FeedbackResult];

// ── Themes ───────────────────────────────────────────────────────

export const THEME_NAMES = [
  "bank-vault",
  "dna-lab",
  "launch-code",
  "treasure-map",
  "potion-brew",
  "signal-decode",
  "cyber-lock",
  "star-chart",
  "spice-market",
  "circuit-board",
] as const;

export type ThemeName = (typeof THEME_NAMES)[number];

export type ThemeConfig = {
  name: ThemeName;
  label: string;
  symbols: [string, string, string, string, string, string];
  symbolLabels: [string, string, string, string, string, string];
  aesthetic: string;
  potLabel: string;
  accentColor: string;
};

export const THEMES: Record<ThemeName, ThemeConfig> = {
  "bank-vault": {
    name: "bank-vault",
    label: "Bank Vault",
    symbols: ["🥇", "🥈", "🥉", "🪙", "⚙️", "💎"],
    symbolLabels: ["Gold", "Silver", "Bronze", "Copper", "Iron", "Diamond"],
    aesthetic: "Steel vault door, combination dial",
    potLabel: "Armoured Safe",
    accentColor: "#C0A060",
  },
  "dna-lab": {
    name: "dna-lab",
    label: "DNA Lab",
    symbols: ["🧬", "🔬", "⚗️", "🧪", "🦠", "💉"],
    symbolLabels: ["A", "T", "G", "C", "X", "Y"],
    aesthetic: "Lab bench, helix animation",
    potLabel: "Glowing Vial",
    accentColor: "#00C896",
  },
  "launch-code": {
    name: "launch-code",
    label: "Launch Code",
    symbols: ["α", "β", "γ", "δ", "Ω", "Σ"],
    symbolLabels: ["Alpha", "Beta", "Gamma", "Delta", "Omega", "Sigma"],
    aesthetic: "Mission control, countdown clock",
    potLabel: "Rocket on Pad",
    accentColor: "#FF6B35",
  },
  "treasure-map": {
    name: "treasure-map",
    label: "Treasure Map",
    symbols: ["⬆️", "⬇️", "⬅️", "➡️", "🔼", "🔽"],
    symbolLabels: ["North", "South", "East", "West", "Up", "Down"],
    aesthetic: "Parchment map, compass rose",
    potLabel: "Treasure Chest",
    accentColor: "#D4A017",
  },
  "potion-brew": {
    name: "potion-brew",
    label: "Potion Brew",
    symbols: ["🔥", "💧", "🌍", "💨", "🌑", "✨"],
    symbolLabels: ["Fire", "Water", "Earth", "Air", "Shadow", "Light"],
    aesthetic: "Cauldron, bubbling flasks",
    potLabel: "Bubbling Cauldron",
    accentColor: "#9B59B6",
  },
  "signal-decode": {
    name: "signal-decode",
    label: "Signal Decode",
    symbols: ["〰️", "〽️", "📶", "📡", "🔊", "📻"],
    symbolLabels: ["100Hz", "200Hz", "400Hz", "800Hz", "1.6kHz", "3.2kHz"],
    aesthetic: "Oscilloscope, frequency graph",
    potLabel: "Radio Transmitter",
    accentColor: "#27AE60",
  },
  "cyber-lock": {
    name: "cyber-lock",
    label: "Cyber Lock",
    symbols: ["0️⃣", "1️⃣", "🅰️", "🅱️", "🔣", "❌"],
    symbolLabels: ["0", "1", "A", "B", "F", "X"],
    aesthetic: "Terminal, green-on-black",
    potLabel: "Glowing Padlock",
    accentColor: "#00FF41",
  },
  "star-chart": {
    name: "star-chart",
    label: "Star Chart",
    symbols: ["⭐", "🌟", "✨", "💫", "🌠", "🌌"],
    symbolLabels: ["Orion", "Leo", "Vega", "Lyra", "Cygnus", "Aquila"],
    aesthetic: "Star map, constellation lines",
    potLabel: "Galaxy Sphere",
    accentColor: "#3498DB",
  },
  "spice-market": {
    name: "spice-market",
    label: "Spice Market",
    symbols: ["🧂", "🌶️", "🫙", "🌿", "🫚", "🌺"],
    symbolLabels: ["Salt", "Pepper", "Cumin", "Cardamom", "Ginger", "Clove"],
    aesthetic: "Market stall, spice jars",
    potLabel: "Cooking Pot",
    accentColor: "#E67E22",
  },
  "circuit-board": {
    name: "circuit-board",
    label: "Circuit Board",
    symbols: ["🔴", "🔵", "🟢", "🟡", "⚪", "⚫"],
    symbolLabels: ["Red", "Blue", "Green", "Yellow", "White", "Black"],
    aesthetic: "PCB trace aesthetic",
    potLabel: "Microchip",
    accentColor: "#2ECC71",
  },
};

// Theme rotation: deterministic by cycle date (UTC day index mod 10)
export function getThemeForDate(date: Date): ThemeName {
  const dayIndex = Math.floor(date.getTime() / 86_400_000);
  return THEME_NAMES[dayIndex % THEME_NAMES.length];
}

// ── Pot state ────────────────────────────────────────────────────

export type PotState = "seeded" | "growing" | "hot" | "burning" | "cracked" | "dead";

export function getPotState(balance: number, cap: number, status: CycleSatus): PotState {
  if (status === "cracked" || status === "settling") return "cracked";
  if (status === "dead") return "dead";
  const pct = balance / cap;
  if (pct >= 0.8) return "burning";
  if (pct >= 0.5) return "hot";
  if (balance > 200) return "growing";
  return "seeded";
}

// ── Cycle ────────────────────────────────────────────────────────

// Returned by /api/crackpot/cycle/current (HTTP 200) between rounds, while
// the cron rotates the cycle. Clients show a "new round opening" state and
// keep polling instead of treating the gap as an error.
export type RotatingCycleView = {
  status: "rotating";
  version: CrackPotVersion;
  retryAfterSeconds: number;
};

// `pending`  = secret preimage persisted, openCycle() tx not yet confirmed;
//              never returned by the cycle APIs (promoted to 'active' or retired to 'dead').
// `settling` = correct guess recorded, declareWinner() tx pending on-chain.
export type CycleSatus = "pending" | "active" | "settling" | "cracked" | "dead";

export type CrackPotCycle = {
  id: string;
  version: CrackPotVersion;
  theme: ThemeName;
  status: CycleSatus;
  pot_balance: number;       // Miles (Version A) or USD cents (Version B stored as integer cents)
  pot_cap: number;
  seed_amount: number;
  expires_at: string;
  winner_address: string | null;
  winner_guesses: number | null;
  winner_tx_hash: string | null;
  payout_amount: number | null;
  cracked_at: string | null;
  commitment_algorithm: string | null;
  secret_revealed_at: string | null;
  // Chain fields (from migration 024)
  chain_id: number | null;
  contract_cycle_id: number | null;
  contract_version: number | null;
  secret_commitment: string | null;
  created_at: string;
};

// What the client receives — no secret code, no internal IDs beyond cycle id.
// Active cycles expose the commitment so users can track it; the preimage is
// withheld until the cycle ends.
export type CycleView = {
  cycleId: string;
  version: CrackPotVersion;
  theme: ThemeName;
  themeConfig: ThemeConfig;
  status: CycleSatus;
  potBalance: number;        // Miles or USD cents
  potBalanceUsdt?: number;   // USD float, Version B only
  potCap: number;
  potState: PotState;
  expiresAt: string;
  secondsRemaining: number;
  winnerAddress: string | null;
  winnerGuesses: number | null;
  // Commitment — always visible so players can note it before entries begin.
  secretCommitment: string | null;
};

// Full reveal data — only returned after status is 'cracked' or 'dead'.
// Lets anyone recompute the on-chain commitment and verify the secret was fixed.
export type CycleReveal = {
  cycleId: string;
  secretCode: [number, number, number, number];
  secretSalt: string;           // 32-byte hex, no 0x prefix
  secretCommitment: string;     // on-chain bytes32 (0x-prefixed)
  commitmentAlgorithm: string;  // human-readable algorithm description
  // Fields needed to recompute the hash
  chainId: number;
  contractAddress: string;
  contractVersion: number;
  expiresAt: string;            // ISO-8601 (converts to unix for recomputation)
};

// ── Attempt ──────────────────────────────────────────────────────

export type AttemptStatus = "active" | "queued" | "expired" | "won" | "lost";

export type CrackPotAttempt = {
  id: string;
  cycle_id: string;
  player_address: string;
  attempt_number: number;    // 1-indexed paid entry number within the cycle
  started_at: string;
  expires_at: string;        // started_at + 60 seconds
  status: AttemptStatus;
  guesses_used: number;
  is_paid: boolean;          // all live CrackPot entries are paid on-chain
};

export type AttemptView = {
  attemptId: string;
  attemptNumber: number;
  expiresAt: string;
  secondsRemaining: number;
  guessesUsed: number;
  status: AttemptStatus;
  guesses: GuessView[];
  // Guesses from the player's earlier entries in this same cycle (read-only
  // history). Lets a player on their 2nd+ entry still see prior tries.
  priorGuesses: GuessView[];
  freeAttemptsUsed: number;
  totalAttemptsUsed: number;
  canUpsell: boolean;
};

// ── Guess ────────────────────────────────────────────────────────

export type CrackPotGuess = {
  id: string;
  attempt_id: string;
  cycle_id: string;
  player_address: string;
  guess_number: number;      // 1-indexed within the attempt
  symbols: [number, number, number, number]; // 0–5 indices into theme symbol array
  // Noisy feedback stored as returned (not ground truth)
  feedback: GuessFeedback;
  locked_count: number;
  is_correct: boolean;
  created_at: string;
};

export type GuessView = {
  guessNumber: number;
  symbols: [number, number, number, number];
  symbolLabels: [string, string, string, string];
  feedback: GuessFeedback;
  isCorrect: boolean;
  createdAt: string;
};

// ── Player cycle state (aggregate) ───────────────────────────────

export type PlayerCycleState = {
  hasActiveAttempt: boolean;
  activeAttempt: AttemptView | null;
  freeAttemptsUsed: number;    // legacy field; live paid flow should be 0
  totalAttemptsUsed: number;
  hasWonThisCycle: boolean;
  bestGuessCount: number | null;  // lowest locked count across all guesses
};

// ── Version ──────────────────────────────────────────────────────

export type CrackPotVersion = "miles" | "usdt" | "base_miles" | "base_usdc";

// ── Version A (Miles) constants ───────────────────────────────────

export const GUESSES_PER_ENTRY = 2;
export const ENTRY_FEE_MILES = 10;
export const SEED_MILES = 200;
export const POT_CAP_MILES = 10_000;
export const CYCLE_DURATION_HOURS_MILES = 1;  // Hourly cycles

// ── Version B (USDT) constants ────────────────────────────────────

export const ENTRY_FEE_USDT = 0.10;           // USD per attempt
export const SEED_USDT = 2.00;                // USD seed per cycle
export const POT_CAP_USDT = 50.00;            // USD cap
export const HOUSE_RAKE_USDT = 0.50;          // 50% of entry to house
export const CYCLE_DURATION_HOURS_USDT = 12;  // 2 cycles per day

// ── Shared constants ──────────────────────────────────────────────

export const ATTEMPT_DURATION_SECONDS = 60;
export const GUESS_COOLDOWN_SECONDS = 15;

// Entry boundary protection: the client refuses new paid entries in the last
// ENTRY_BUFFER_SECONDS of a cycle; the server refuses to open an attempt with
// fewer than MIN_PLAYABLE_WINDOW_SECONDS left (the paid entry is then logged
// as orphaned for credit instead of being silently rejected).
export const ENTRY_BUFFER_SECONDS = 90;
export const MIN_PLAYABLE_WINDOW_SECONDS = 15;

// ── Noise injection constants ─────────────────────────────────────
// Applied server-side only. LOCKED is always truthful.
// CLOSE → MISS with 20% probability
// MISS → CLOSE with 15% probability
export const NOISE_CLOSE_TO_MISS = 0.20;
export const NOISE_MISS_TO_CLOSE = 0.15;
