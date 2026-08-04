const REWARD_ICON_RULES = [
  [/mug|cup/i, '☕'],
  [/tumbler|bottle|thermos/i, '🥤'],
  [/gift ?card/i, '💳'],
  [/fire ?stick|tv|streaming/i, '📺'],
  [/headphone|earbud|audio/i, '🎧'],
  [/backpack|bag/i, '🎒'],
  [/roomba|vacuum|robot/i, '🤖'],
  [/trip|vacation|disney|flight|travel/i, '✈️'],
  [/watch/i, '⌚'],
  [/shirt|hoodie|jacket|apparel|hat/i, '👕'],
  [/game|xbox|playstation|nintendo/i, '🎮'],
  [/gift ?basket|snack|food/i, '🎁'],
];

export function rewardIcon(name) {
  const match = REWARD_ICON_RULES.find(([pattern]) => pattern.test(name || ''));
  return match ? match[1] : '🎁';
}
