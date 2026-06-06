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
  if (status === "cracked") return "cracked";
  if (status === "dead") return "dead";
  const pct = balance / cap;
  if (pct >= 0.8) return "burning";
  if (pct >= 0.5) return "hot";
  if (balance > 200) return "growing";
  return "seeded";
}

// ── Cycle ────────────────────────────────────────────────────────

export type CycleSatus = "active" | "cracked" | "dead";

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
  created_at: string;
};

// What the client receives — no secret code, no internal IDs beyond cycle id
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
};

// ── Attempt ──────────────────────────────────────────────────────

export type AttemptStatus = "active" | "expired" | "won" | "lost";

export type CrackPotAttempt = {
  id: string;
  cycle_id: string;
  player_address: string;
  attempt_number: number;    // 1, 2, 3 (free); 4–6+ (paid)
  started_at: string;
  expires_at: string;        // started_at + 2 minutes
  status: AttemptStatus;
  guesses_used: number;
  is_paid: boolean;          // true for attempts 4+
};

export type AttemptView = {
  attemptId: string;
  attemptNumber: number;
  expiresAt: string;
  secondsRemaining: number;
  guessesUsed: number;
  status: AttemptStatus;
  guesses: GuessView[];
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
  freeAttemptsUsed: number;    // max 3 free per cycle
  totalAttemptsUsed: number;
  hasWonThisCycle: boolean;
  bestGuessCount: number | null;  // lowest locked count across all guesses
};

// ── Version ──────────────────────────────────────────────────────

export type CrackPotVersion = "miles" | "usdt";

// ── Version A (Miles) constants ───────────────────────────────────

export const FREE_ATTEMPTS_PER_CYCLE = 3;
export const UPSELL_ATTEMPTS_PER_PURCHASE = 3;
export const ENTRY_FEE_MILES = 10;
export const SEED_MILES = 200;
export const POT_CAP_MILES = 10_000;
export const CYCLE_DURATION_HOURS_MILES = 1;  // Hourly cycles
// Phase 1 upsell stand-in: 30 Miles per pack (replaces $0.05 until payment provider wired)
export const UPSELL_COST_MILES = 30;

// ── Version B (USDT) constants ────────────────────────────────────

export const ENTRY_FEE_USDT = 0.10;           // USD per attempt
export const SEED_USDT = 2.00;                // USD seed per cycle
export const POT_CAP_USDT = 50.00;            // USD cap
export const HOUSE_RAKE_USDT = 0.50;          // 50% of entry to house
export const UPSELL_COST_USDT = 0.10;         // USD per pack of 3 extra attempts
export const CYCLE_DURATION_HOURS_USDT = 12;  // 2 cycles per day

// ── Shared constants ──────────────────────────────────────────────

export const ATTEMPT_DURATION_SECONDS = 120;
export const GUESS_COOLDOWN_SECONDS = 15;

// ── Noise injection constants ─────────────────────────────────────
// Applied server-side only. LOCKED is always truthful.
// CLOSE → MISS with 20% probability
// MISS → CLOSE with 15% probability
export const NOISE_CLOSE_TO_MISS = 0.20;
export const NOISE_MISS_TO_CLOSE = 0.15;
