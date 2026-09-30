import test from 'node:test';
import assert from 'node:assert/strict';
import { insertCloudPointsAtomically } from './cloudRestoreTransaction.mjs';

function transactionalDatabase({ failOnWrite = null } = {}) {
  const committed = [];
  let writes = 0;
  return {
    committed,
    async withExclusiveTransactionAsync(callback) {
      const staged = [];
      const transaction = {
        async runAsync(_sql, ...parameters) {
          writes++;
          if (writes === failOnWrite) throw new Error('simulated SQLite failure');
          for (let offset = 0; offset < parameters.length; offset += 6) staged.push(parameters.slice(offset, offset + 6));
          return { changes: parameters.length / 6 };
        },
      };
      await callback(transaction);
      committed.push(...staged);
    },
  };
}

const points = Array.from({ length: 101 }, (_, index) => ({
  timestamp: index, lat: 10, lng: 20, accuracy: 5, source: 'import', importId: 'timeline-a',
}));

test('restore rolls back all batches when a later SQLite write fails', async () => {
  const db = transactionalDatabase({ failOnWrite: 2 });
  await assert.rejects(insertCloudPointsAtomically(db, points), /simulated SQLite failure/);
  assert.equal(db.committed.length, 0);
});

test('restore checks cancellation immediately before exclusive transaction commit', async () => {
  const db = transactionalDatabase();
  let checks = 0;
  await assert.rejects(
    insertCloudPointsAtomically(db, points.slice(0, 1), () => ++checks < 2),
    /cancelled/,
  );
  assert.equal(db.committed.length, 0);
});

test('restore commits batches together when the exclusive transaction succeeds', async () => {
  const db = transactionalDatabase();
  const inserted = await insertCloudPointsAtomically(db, points);
  assert.equal(inserted, 101);
  assert.equal(db.committed.length, 101);
});