import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fmtChange } from '../src/format';
import { GameRun } from '../src/game';

function earned(balance = 100, starting = 10): GameRun {
  const game = new GameRun('double', starting);
  game.settle(game.drop(0)!.id, balance / starting);
  return game;
}

test('the first ball is house-funded at the chosen starting amount', () => {
  assert.equal(new GameRun('double').houseStake, 10);
  for (const amount of [10, 50, 100, 150, 250, 500, 1000, 10000]) {
    const game = new GameRun('double', amount);
    assert.equal(game.balance, 0);
    assert.equal(game.minimumBet, amount / 10);
    assert.equal(game.busted, false);
    assert.equal(game.canSpend(1), false);
    const bet = game.drop(0)!;
    assert.equal(bet.amount, amount);
    assert.equal(bet.cost, 0);
    assert.equal(game.houseDropAvailable, false);
    assert.equal(game.inPlay, amount);
    assert.equal(game.busted, false);
    assert.equal(game.drop(0), null);
    assert.equal(game.drop(4), null);
    assert.equal(game.settle(bet.id, 1.5)!.profit, amount * 1.5);
    assert.equal(game.balance, amount * 1.5);
    assert.equal(game.canSpend(1), true);
    const next = game.drop(0)!;
    assert.equal(next.amount, amount * 1.5);
    assert.equal(next.cost, next.amount);
    assert.equal(game.balance, 0);
    assert.equal(game.settle(next.id, 0.5)!.profit, -next.amount / 2);
  }
});

test('split house proceeds remain unavailable until both half-value balls land', () => {
  const game = new GameRun('double');
  const bet = game.drop(0)!;
  assert.ok(game.duplicate(bet.id));
  assert.equal(game.inPlay, 10);
  game.settle(bet.id, 2, .5);
  assert.equal(game.balance, 10);
  assert.equal(game.inPlay, 5);
  assert.equal(game.spend(5), false);
  assert.equal(game.drop(0), null);
  game.settle(bet.id, 0, .5);
  assert.equal(game.spend(5), true);
  assert.equal(game.balance, 5);
});

test('split children divide the wager and their different buckets settle once', () => {
  const game = earned();
  const bet = game.drop(0)!;
  game.duplicate(bet.id);
  game.duplicate(bet.id);
  assert.equal(game.inPlay, 100);
  const first = game.settle(bet.id, .1, .5)!;
  assert.equal(first.payout, 5);
  assert.equal(first.profit, -45);
  assert.equal(first.complete, false);
  assert.equal(game.busted, false);
  assert.equal(game.drop(0), null);
  assert.equal(game.inPlay, 50);
  assert.equal(game.settle(bet.id, 100, 2), null);
  game.settle(bet.id, 2, .25);
  const last = game.settle(bet.id, 0, .25)!;
  assert.equal(last.complete, true);
  assert.equal(last.totalProfit, -45);
  assert.equal(game.balance, 55);
  assert.equal(game.active, 0);
  assert.equal(game.settle(bet.id, 1000, .25), null);
  assert.equal(game.duplicate(bet.id), false);
});

test('fractional cents are accumulated across split shares', () => {
  const game = earned(10.01);
  const bet = game.drop(0)!;
  for (let i = 1; i < 128; i++) game.duplicate(bet.id);
  for (let i = 0; i < 128; i++) game.settle(bet.id, .01, 1 / 128);
  assert.equal(game.balance, 0.1);
  assert.equal(game.active, 0);
});

test('every life loses strictly below 10% of its starting amount', () => {
  for (const starting of [10, 50, 100, 150, 250, 500, 2500]) {
    const game = earned(starting / 10, starting);
    assert.equal(game.minimumBet, starting / 10);
    assert.equal(game.busted, false, 'exact threshold is playable');
    const bet = game.drop(0)!;
    game.settle(bet.id, (starting / 10 - .01) / bet.amount);
    assert.equal(game.busted, true, 'one cent below threshold loses');
    assert.equal(game.drop(0), null);
    assert.equal(earned(starting * .09, starting).busted, true, 'house ball can bust');
  }
});

test('Double loss threshold is 5% of peak with a 10% starting floor', () => {
  const game = earned(2000);
  assert.equal(game.minimumBet, 100);
  assert.equal(game.spend(1900.01), false);
  assert.equal(game.balance, 2000);
  assert.equal(game.spend(1900), true);
  assert.equal(game.minimumBet, 100);
  const wager = game.drop(0)!;
  game.duplicate(wager.id);
  game.settle(wager.id, 1, .5);
  assert.equal(game.busted, false);
  game.settle(wager.id, .9998, .5);
  assert.equal(game.balance, 99.99);
  assert.equal(game.busted, true);
  assert.equal(new GameRun('double').minimumBet, 1);
});

test('paid losses still show the actual net loss', () => {
  const game = earned();
  const loss = game.settle(game.drop(0)!.id, .3)!;
  assert.equal(loss.payout, 30);
  assert.equal(loss.profit, -70);
  assert.equal(fmtChange(loss.profit), '−$70.00');
});

test('classic bets settle independently and cannot pay twice', () => {
  const game = new GameRun('classic');
  assert.equal(game.balance, 5);
  const bets = Array.from({ length: 5 }, () => game.drop(0)!);
  assert.equal(game.balance, 0);
  assert.equal(game.busted, false);
  assert.equal(game.drop(0), null);
  const loss = game.settle(bets[4].id, 0.3)!;
  assert.equal(loss.profit, -0.7);
  assert.equal(game.settle(bets[4].id, 110), null);
  assert.equal(game.balance, 0.3);
  game.settle(bets[0].id, 100);
  const expensive = game.drop(2)!;
  assert.equal(expensive.amount, 100);
  assert.equal(expensive.tier, 2);
  assert.equal(game.settle(expensive.id, 0.5)!.profit, -50);
  for (const bet of bets.slice(1, 4)) game.settle(bet.id, 1);
  assert.equal(game.active, 0);
  assert.equal(game.balance, 53.3);
});

test('normal mode allows $1 balls and loses only below $1 after all balls settle', () => {
  const game = new GameRun('classic');
  assert.equal(game.minimumBet, 1);
  assert.equal(game.drop(-1), null);
  assert.equal(game.drop(1.5), null);
  for (let i = 0; i < 5; i++) {
    const bet = game.drop(0)!;
    game.settle(bet.id, i === 4 ? 1 : 0);
  }
  assert.equal(game.balance, 1);
  assert.equal(game.busted, false);
  const last = game.drop(0)!;
  assert.equal(last.amount, 1);
  assert.equal(game.balance, 0);
  assert.equal(game.busted, false);
  game.settle(last.id, 0.99);
  assert.equal(game.balance, 0.99);
  assert.equal(game.busted, true);
  assert.equal(game.drop(0), null);
});

test('results show net wins, losses and break-even with the correct sign', () => {
  assert.equal(fmtChange(50), '+$50.00');
  assert.equal(fmtChange(-7.25), '−$7.25');
  assert.equal(fmtChange(0), '$0.00');
  assert.equal(fmtChange(-70, true), '−$70');
  assert.equal(fmtChange(-23.85, true), '−$23.85');
});
