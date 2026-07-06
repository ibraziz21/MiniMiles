export type FarkleMode =
  | "FARKLE_QUICK_1500_AKIBA"
  | "FARKLE_REWARD_3000_USDT"
  | "FARKLE_PRO_5000_USDT";

export type FarkleReactionEmoji = "fire" | "cry" | "laugh" | "tongue" | "angry_censored";

export interface FarkleReaction {
  id:            string;
  emoji:         FarkleReactionEmoji;
  fromUserId:    string;
  sentAt:        string;
}

export type MatchStatus =
  | "created" | "waiting" | "funded" | "in_progress"
  | "completed" | "settled" | "cancelled" | "disputed";

export interface FarklePlayer {
  userId:        string;
  walletAddress: string;
  seatIndex:     0 | 1;
  bankedScore:   number;
  entryDebited:  boolean;
  rewardGranted: boolean;
  result?:       "win" | "loss" | "draw" | null;
}

export interface FarkleTurn {
  id:           string;
  matchId:      string;
  userId:       string;
  turnNumber:   number;
  rollNumber:   number;
  diceValues:   number[];
  selectedDice: number[];
  turnPoints:   number;
  bankedPoints: number;
  action:       "roll" | "roll_again" | "bank" | "farkle" | "forfeit" | "hot_dice" | "timeout";
  farkled:      boolean;
  hotDice:      boolean;
  createdAt:    string;
}

export interface FarkleMatch {
  id:                    string;
  matchKey:              string;
  modeKey:               FarkleMode;
  status:                MatchStatus;
  targetScore:           number;
  currentTurnPlayerId?:  string | null;
  turnNumber:            number;
  seedHash?:             string;
  players:               FarklePlayer[];
  winnerUserId?:         string | null;
  loserUserId?:          string | null;
  winnerScore?:          number | null;
  loserScore?:           number | null;
  startedAt?:            string | null;
  completedAt?:          string | null;
}

/** What the client sees during their turn */
export interface TurnState {
  matchId:          string;
  yourUserId:       string;
  opponentUserId?:  string | null;
  yourUsername?:    string | null;
  opponentUsername?: string | null;
  yourScore:        number;
  opponentScore:    number;
  isYourTurn:       boolean;
  currentRoll?:     number[];    // current dice on table (null if turn not started)
  lockedIndices?:   number[];
  rolledIndices?:   number[];
  scoringHints?:    number[];
  turnPoints:       number;      // accumulated unbanked this turn
  remainingDice:    number;      // dice not yet scored this turn
  canRoll:          boolean;
  canBank:          boolean;
  isFarkle:         boolean;
  isHotDice:        boolean;
  targetScore:      number;
  matchStatus:      MatchStatus;
  winnerUserId?:    string | null;
  lastAction?:      string | null;
  turnStartedAt?:      string | null;
  turnTimeoutSeconds?: number;
  lastReaction?:       FarkleReaction | null;
}

export interface BalancesResponse {
  akibaTickets:    number;
  gameCredits:     number;
  rewardCreditsCents: number; // $0.15 = 15
}
