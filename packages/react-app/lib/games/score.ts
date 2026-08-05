// Scoring formulas and reward thresholds now live in the shared package so
// React, Pass, and the Backend engines compute from the same source. See
// @akiba/skill-games §5.1.
export { rewardForScore, scoreRuleTap, scoreMemoryFlip, thresholdCopy } from "@akiba/skill-games/core";
