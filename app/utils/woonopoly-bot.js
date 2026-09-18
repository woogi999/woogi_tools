// The computer players for Woonopoly. Nothing clever: a handful of rules of
// thumb about what a property is worth to this player right now, how much cash
// to keep back, and when to build.
//
//   decide(state, index)          -> the action to take while the game waits on this player
//   judgeTrade(state, index)      -> 'acceptTrade' | 'declineTrade' for the offer on the table
//   proposeTrade(state, index)    -> a trade action, or null

import {
  BOARD,
  PROPERTY_INDICES,
  groupSpaces,
  ownsGroup,
  canBuild,
  canUnmortgage,
  unmortgageCost,
  raiseMoney,
} from './woonopoly';

// Cash a computer player likes to keep for rent, more once the board fills up with houses.
function reserve(state, index) {
  let danger = 0;
  for (const [space, prop] of Object.entries(state.props)) {
    if (prop.owner === null || prop.owner === index || prop.mortgaged) continue;
    const info = BOARD[space];
    if (info.type === 'street')
      danger = Math.max(danger, info.rent[prop.houses]);
  }
  return Math.min(60000, 12000 + danger * 0.6);
}

// What a property is worth to this player: face value, a lot more when it completes a set,
// a bit more when it starts one, and a bit less when someone else already has most of the group.
export function valueTo(state, index, space) {
  const info = BOARD[space];
  const price = info.price;
  const spaces = groupSpaces(info.group);
  const mine = spaces.filter(
    (s) => s !== space && state.props[s].owner === index,
  ).length;
  const theirs = spaces.filter(
    (s) =>
      s !== space &&
      state.props[s].owner !== null &&
      state.props[s].owner !== index,
  ).length;
  if (info.type === 'street') {
    if (mine === spaces.length - 1) return price * 1.8;
    if (theirs === spaces.length - 1) return price * 1.15; // blocking someone else's set
    if (mine > 0) return price * 1.25;
    return price * (theirs ? 0.85 : 1);
  }
  if (info.type === 'station') return price * (1 + mine * 0.2);
  return price * (mine ? 1.2 : 0.8);
}

function buildPlan(state, index) {
  const player = state.players[index];
  const keep = reserve(state, index);
  const sets = new Set(
    PROPERTY_INDICES.filter(
      (s) =>
        BOARD[s].type === 'street' &&
        state.props[s].owner === index &&
        ownsGroup(state, index, BOARD[s].group),
    ).map((s) => BOARD[s].group),
  );
  // Cheapest affordable house on the most valuable set first, so rents climb fastest.
  let best = null;
  for (const group of sets)
    for (const space of groupSpaces(group)) {
      if (!canBuild(state, index, space)) continue;
      if (player.money - BOARD[space].house < keep) continue;
      const gain =
        BOARD[space].rent[state.props[space].houses + 1] -
        BOARD[space].rent[state.props[space].houses];
      if (!best || gain / BOARD[space].house > best.gain)
        best = { space, gain: gain / BOARD[space].house };
    }
  return best ? { type: 'build', space: best.space } : null;
}

function unmortgagePlan(state, index) {
  const player = state.players[index];
  const keep = reserve(state, index);
  const candidates = PROPERTY_INDICES.filter(
    (s) =>
      canUnmortgage(state, index, s) &&
      player.money - unmortgageCost(s) > keep + 15000,
  ).sort((a, b) => valueTo(state, index, b) - valueTo(state, index, a));
  return candidates.length
    ? { type: 'unmortgage', space: candidates[0] }
    : null;
}

export function decide(state, index) {
  const player = state.players[index];
  switch (state.phase) {
    case 'turn': {
      if (state.turn !== index) return null;
      // Sort the estate out first (before rolling, or before ending the turn).
      const build = buildPlan(state, index);
      if (build) return build;
      const unmortgage = unmortgagePlan(state, index);
      if (unmortgage) return unmortgage;
      if (state.rolled) return { type: 'end' };
      if (player.inJail) {
        if (player.jailCards) return { type: 'useJailCard' };
        // Early on, get out and buy things; later, jail is a safe place to sit.
        const owned = PROPERTY_INDICES.filter(
          (s) => state.props[s].owner !== null,
        ).length;
        const early = owned < PROPERTY_INDICES.length * 0.6;
        if (
          early &&
          player.money >= state.rules.jailFine + reserve(state, index)
        )
          return { type: 'payFine' };
      }
      return { type: 'roll' };
    }
    case 'buy': {
      const space = player.pos;
      const price = BOARD[space].price;
      const worth = valueTo(state, index, space);
      const keep = reserve(state, index);
      if (
        player.money >= price &&
        (player.money - price >= keep || worth >= price * 1.5)
      )
        return { type: 'buy' };
      return { type: 'decline' };
    }
    case 'auction': {
      const a = state.auction;
      if (!a || a.bidders[a.at] !== index) return null;
      const cap = Math.min(
        valueTo(state, index, a.space),
        player.money - reserve(state, index) * 0.5,
        player.money,
      );
      const step = a.bid < 10000 ? 1000 : a.bid < 40000 ? 2500 : 5000;
      const next = a.bid + step;
      if (next <= cap) return { type: 'bid', amount: next };
      return { type: 'passBid' };
    }
    case 'debt': {
      const debt = state.debts[0];
      if (!debt || debt.who !== index) return null;
      if (player.money < debt.amount) raiseMoney(state, index, debt.amount);
      if (player.money >= debt.amount) return { type: 'payDebt' };
      return { type: 'bankrupt' };
    }
    default:
      return null;
  }
}

// Sum of what an offer is worth to `index`, seen from their side of the table.
function offerValue(state, index, offer, receiving) {
  let total = offer.money + offer.jailCards * 4000;
  for (const space of offer.props) {
    const base = valueTo(state, index, space);
    // Giving a property away also loses whatever set it was part of.
    total += receiving ? base : base * 1.1;
    if (state.props[space].mortgaged) total -= BOARD[space].price * 0.55;
  }
  return total;
}

export function judgeTrade(state, index) {
  const t = state.trade;
  if (!t || t.to !== index) return null;
  const gain = offerValue(state, index, t.give, true);
  const cost = offerValue(state, index, t.get, false);
  return gain >= cost * 1.05 ? 'acceptTrade' : 'declineTrade';
}

// Now and then, a computer player asks for the one property that would finish a set,
// paying well over the odds in cash.
export function proposeTrade(state, index) {
  if (state.trade) return null;
  const player = state.players[index];
  for (const space of PROPERTY_INDICES) {
    const info = BOARD[space];
    if (info.type !== 'street') continue;
    const prop = state.props[space];
    if (prop.owner === null || prop.owner === index || prop.houses) continue;
    const spaces = groupSpaces(info.group);
    if (!spaces.every((s) => s === space || state.props[s].owner === index))
      continue;
    const owner = state.players[prop.owner];
    if (owner.bankrupt) continue;
    const price = Math.round(info.price * 1.6);
    if (player.money - price < reserve(state, index) + 10000) continue;
    return {
      type: 'trade',
      to: prop.owner,
      give: { money: price, props: [], jailCards: 0 },
      get: { money: 0, props: [space], jailCards: 0 },
    };
  }
  return null;
}
