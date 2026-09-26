import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fmtChange } from '../src/format';
import { GameRun } from '../src/game';

function earned(balance = 100): GameRun {
  const game = new GameRun('double');
  game.settle(game.drop(0)!.id, balance / 100);
  return game;
}

test('the first ball is house-funded and only settled winnings are spendable', () => {
  for (const amount of [100, 150, 250, 500]) {
    const game = new GameRun('double', amount);
    assert.equal(game.balance, 0);
    assert.equal(game.busted, false);
    assert.equal(game.canSpend(25), false);
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
    assert.equal(game.canSpend(25), true);
    const next = game.drop(0)!;
    assert.equal(next.amount, amount * 1.5);
    assert.equal(next.cost, next.amount);
    assert.equal(game.balance, 0);
    assert.equal(game.settle(next.id, 0.5)!.profit, -next.amount / 2);
  }
});

test('house split proceeds remain unavailable until every child has landed', () => {
  const game = new GameRun('double');
  const bet = game.drop(0)!;
  game.settle(bet.id, 2, .5);
  assert.equal(game.balance, 100);
  assert.equal(game.spend(25), false);
  assert.equal(game.drop(0), null);
  game.settle(bet.id, 0, .5);
  assert.equal(game.spend(25), true);
  assert.equal(game.balance, 75);
});

test('split landings conserve the stake and wait for all children', () => {
  const game = earned();
  const bet = game.drop(0)!;
  const first = game.settle(bet.id, .1, .5)!;
  assert.equal(first.payout, 5);
  assert.equal(first.complete, false);
  assert.equal(game.busted, false);
  assert.equal(game.drop(0), null);
  assert.equal(game.inPlay, 50);
  assert.equal(game.settle(bet.id, 100, .75), null, 'cannot settle more than the remaining stake');
  game.settle(bet.id, 2, .25);
  const last = game.settle(bet.id, 0, .25)!;
  assert.equal(last.complete, true);
  assert.equal(last.totalProfit, -45);
  assert.equal(game.balance, 55);
  assert.equal(game.active, 0);
  assert.equal(game.settle(bet.id, 1000, .25), null);
});

test('fractional cents are carried across children without creating money', () => {
  const game = earned(10.01);
  const bet = game.drop(0)!;
  for (let i = 0; i < 128; i++) game.settle(bet.id, 1, 1 / 128);
  assert.equal(game.balance, 10.01);
  assert.equal(game.active, 0);
});

test('paid losses show net change, retain cents, and end only below $10', () => {
  const game = earned();
  const first = game.drop(0)!;
  const loss = game.settle(first.id, 0.3)!;
  assert.equal(loss.payout, 30);
  assert.equal(loss.profit, -70);
  assert.equal(fmtChange(loss.profit), '−$70.00');
  const second = game.drop(0)!;
  assert.equal(second.amount, 30);
  game.settle(second.id, 0.363);
  assert.equal(game.balance, 10.89);
  const third = game.drop(0)!;
  game.settle(third.id, 0.9);
  assert.equal(game.balance, 9.8);
  assert.equal(game.busted, true);
  assert.equal(game.drop(0), null);

  const boundary = earned(10);
  assert.equal(boundary.busted, false);
  boundary.settle(boundary.drop(0)!.id, 0.999);
  assert.equal(boundary.balance, 9.99);
  assert.equal(boundary.busted, true);
  assert.equal(earned(9.99).busted, true, 'house drop can also bust');
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
