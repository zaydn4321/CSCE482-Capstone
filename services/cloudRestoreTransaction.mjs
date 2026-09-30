export async function insertCloudPointsAtomically(database, points, canContinue = () => true) {
  let inserted = 0;
  await database.withExclusiveTransactionAsync(async transaction => {
    for (let offset = 0; offset < points.length; offset += 100) {
      if (!canContinue()) throw new Error('Cloud restore was cancelled.');
      const batch = points.slice(offset, offset + 100);
      const values = batch.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
      const parameters = batch.flatMap(point => [
        point.timestamp, point.lat, point.lng, point.accuracy, point.source, point.importId ?? '',
      ]);
      const result = await transaction.runAsync(
        `INSERT OR IGNORE INTO cloud_restore_points (timestamp, latitude, longitude, accuracy, source, import_id) VALUES ${values}`,
        ...parameters,
      );
      inserted += result.changes;
    }
    if (!canContinue()) throw new Error('Cloud restore was cancelled.');
  });
  return inserted;
}