export type QuestBoxRewardKind = 'coins' | 'companion_xp' | 'character' | 'cosmetic';

export type QuestBoxReward = {
  kind: QuestBoxRewardKind;
  label: string;
  description: string;
  coins: number;
  xp: number;
  duplicate: boolean;
  character?: { id: string; name: string; tier: string; imagePath: string };
  cosmetic?: { id: string; name: string; category: string; color: string };
};

export type QuestBox = {
  id: string;
  status: 'unopened' | 'opened';
  createdAt: string;
  openedAt?: string | null;
  reward?: QuestBoxReward;
};

export type QuestBoxOpenResponse = { box: QuestBox; awarded: boolean };

export type QuestBoxesResponse = {
  boxes: QuestBox[];
  history: QuestBox[];
  unopenedCount: number;
  progress: { dropsToday: number; dailyLimit: number; misses: number; guaranteedIn: number; resetTime: string };
  rules: {
    dropChance: number;
    guaranteeEvery: number;
    dailyLimit: number;
    resetTime: string;
    rewards: { kind: QuestBoxRewardKind; label: string; chance: number; description: string }[];
    companionRarities: { tier: string; chance: number }[];
    duplicateCoins: { cosmetic: number; characterPriceFraction: number };
  };
};
