export const SETTLEMENT_TYPEHASH_PREIMAGE =
  "AkibaSkillGameSettlement(uint256 sessionId,address player,uint8 gameType,uint256 score,uint256 rewardMiles,uint256 rewardStable,uint256 expiry,address verifyingContract,uint256 chainId)";

export const akibaSkillGamesAbi = [
  "function playerStatus(address player,uint8 gameType) view returns (uint256 credits,uint256 playsToday,uint256 playsRemaining)",
  "function startNonces(address player) view returns (uint256)",
  "function settleGame(uint256 sessionId,uint256 score,uint256 rewardMiles,uint256 rewardStable,uint256 expiry,bytes signature)",
  "function sessions(uint256 sessionId) view returns (uint256 sessionId,address player,uint8 gameType,uint256 entryCost,uint64 createdAt,bytes32 seedCommitment,bool settled,uint256 score,uint256 rewardMiles,uint256 rewardStable,uint8 status)",
  "event GameStarted(uint256 indexed sessionId,address indexed player,uint8 indexed gameType,uint256 entryCost,bytes32 seedCommitment)",
] as const;
