import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fmtChange } from '../src/format';
import { GameRun } from '../src/game';

test('Double or Nothing starts at $100, stakes everything, and blocks additional balls', () => {
  const game = new GameRun('double');
  assert.equal(game.balance, 100);
  const bet = game.drop(0)!;
  assert.equal(bet.amount, 100);
  assert.equal(game.balance, 0);
  assert.equal(game.inPlay, 100);
  assert.equal(game.busted, false, 'money in flight must not end the run');
  assert.equal(game.drop(0), null);
  assert.equal(game.drop(4), null, 'tier shortcuts cannot bypass the single-ball rule');
  assert.equal(game.drops, 1);
  assert.equal(game.settle(bet.id, 1.5)!.profit, 50);
  assert.equal(game.balance, 150);
  assert.equal(game.peak, 150);
  assert.equal(game.drop(0)!.amount, 150, 'the next ball must stake the new full balance');
});

test('losses use the original stake, retain cents, and end only below $10', () => {
  const game = new GameRun('double');
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
  assert.equal(third.amount, 10.89);
  game.settle(third.id, 0.9);
  assert.equal(game.balance, 9.8);
  assert.equal(game.busted, true);
  assert.equal(game.drop(0), null);

  const boundary = new GameRun('double');
  boundary.settle(boundary.drop(0)!.id, 0.1);
  assert.equal(boundary.balance, 10);
  assert.equal(boundary.busted, false);
  const last = boundary.drop(0)!;
  boundary.settle(last.id, 0.999);
  assert.equal(boundary.balance, 9.99);
  assert.equal(boundary.busted, true);
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
