import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LatestRequestCoordinator,
  SerialTaskCoordinator,
} from '../src/lib/latest-request.ts';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('an older response cannot replace a cache after a newer read starts', async () => {
  const coordinator = new LatestRequestCoordinator();
  const oldResponse = deferred();
  const newResponse = deferred();
  const commits = [];

  const oldRead = coordinator.run(() => oldResponse.promise, (value) => commits.push(value));
  await Promise.resolve();
  const newRead = coordinator.run(() => newResponse.promise, (value) => commits.push(value));

  newResponse.resolve('new canonical value');
  await newRead;
  oldResponse.resolve('stale value');
  await oldRead;

  assert.deepEqual(commits, ['new canonical value']);
});

test('a superseded caller waits until the newer canonical read completes', async () => {
  const coordinator = new LatestRequestCoordinator();
  const oldResponse = deferred();
  const newResponse = deferred();
  const commits = [];
  let oldCallerFinished = false;

  const oldRead = coordinator
    .run(() => oldResponse.promise, (value) => commits.push(value))
    .then(() => { oldCallerFinished = true; });
  await Promise.resolve();
  const newRead = coordinator.run(() => newResponse.promise, (value) => commits.push(value));

  oldResponse.resolve('stale value');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(oldCallerFinished, false);
  assert.deepEqual(commits, []);

  newResponse.resolve('new canonical value');
  await Promise.all([oldRead, newRead]);
  assert.equal(oldCallerFinished, true);
  assert.deepEqual(commits, ['new canonical value']);
});

test('a superseded failure follows the newer successful read', async () => {
  const coordinator = new LatestRequestCoordinator();
  const oldResponse = deferred();
  const newResponse = deferred();
  const commits = [];

  const oldRead = coordinator.run(() => oldResponse.promise, (value) => commits.push(value));
  await Promise.resolve();
  const newRead = coordinator.run(() => newResponse.promise, (value) => commits.push(value));

  oldResponse.reject(new Error('stale request failed'));
  newResponse.resolve('new canonical value');

  await Promise.all([oldRead, newRead]);
  assert.deepEqual(commits, ['new canonical value']);
});

test('a superseded caller observes failure of the required newer read', async () => {
  const coordinator = new LatestRequestCoordinator();
  const oldResponse = deferred();
  const newResponse = deferred();

  const oldRead = coordinator.run(() => oldResponse.promise, () => {
    assert.fail('the stale response must not commit');
  });
  await Promise.resolve();
  const newRead = coordinator.run(() => newResponse.promise, () => {
    assert.fail('a failed response must not commit');
  });

  oldResponse.resolve('stale value');
  newResponse.reject(new Error('latest refresh failed'));

  await Promise.all([
    assert.rejects(oldRead, /latest refresh failed/),
    assert.rejects(newRead, /latest refresh failed/),
  ]);
});

test('a reserved proposal write finishes before a later editor can open', async () => {
  const coordinator = new SerialTaskCoordinator();
  const unrelatedSync = deferred();
  const proposalWrite = deferred();
  const proposalStarted = deferred();
  const events = [];

  const writer = coordinator.run(async () => {
    await unrelatedSync.promise;
    events.push('proposal-write-started');
    proposalStarted.resolve();
    await proposalWrite.promise;
    events.push('proposal-write-confirmed');
  });
  const opener = coordinator.run(async () => {
    await unrelatedSync.promise;
    events.push('editor-opened');
  });

  unrelatedSync.resolve();
  await proposalStarted.promise;
  assert.deepEqual(events, ['proposal-write-started']);

  proposalWrite.resolve();
  await Promise.all([writer, opener]);
  assert.deepEqual(events, [
    'proposal-write-started',
    'proposal-write-confirmed',
    'editor-opened',
  ]);
});
