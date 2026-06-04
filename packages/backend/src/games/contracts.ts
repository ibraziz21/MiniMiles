export const SETTLEMENT_TYPEHASH_PREIMAGE =
  "AkibaSkillGameSettlement(uint256 sessionId,address player,uint8 gameType,uint256 score,uint256 rewardMiles,uint256 rewardStable,uint256 expiry,address verifyingContract,uint256 chainId)";

export const START_INTENT_TYPEHASH_PREIMAGE =
  "AkibaStartIntent(address player,uint8 gameType,bytes32 seedCommitment,uint256 nonce,uint256 expiry,address verifyingContract,uint256 chainId)";

export const akibaSkillGamesAbi = [
  "function playerStatus(address player,uint8 gameType) view returns (uint256 credits,uint256 playsToday,uint256 playsRemaining)",
  "function startNonces(address player) view returns (uint256)",
  "function startGameFor(address player,uint8 gameType,bytes32 seedCommitment,uint256 nonce,uint256 expiry,bytes playerSignature) returns (uint256)",
  "function settleGame(uint256 sessionId,uint256 score,uint256 rewardMiles,uint256 rewardStable,uint256 expiry,bytes signature)",
  "event GameStarted(uint256 indexed sessionId,address indexed player,uint8 indexed gameType,uint256 entryCost,bytes32 seedCommitment)",
] as const;
