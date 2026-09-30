import test from 'node:test';
import assert from 'node:assert/strict';
import { isTimelinePickerCacheJsonUri } from './timelinePickerCache.ts';

const pickerDirectory = 'file:///private/app/cache/DocumentPicker/';

test('only direct JSON files in the app DocumentPicker cache are eligible for cleanup', () => {
  assert.equal(isTimelinePickerCacheJsonUri('file:///private/app/cache/DocumentPicker/timeline.json', pickerDirectory), true);
  assert.equal(isTimelinePickerCacheJsonUri('file:///private/app/cache/DocumentPicker/TIMELINE.JSON', pickerDirectory), true);
  assert.equal(isTimelinePickerCacheJsonUri('file:///private/app/cache/DocumentPicker/image.png', pickerDirectory), false);
  assert.equal(isTimelinePickerCacheJsonUri('file:///private/app/cache/other/timeline.json', pickerDirectory), false);
  assert.equal(isTimelinePickerCacheJsonUri('file:///private/app/cache/DocumentPicker/nested/timeline.json', pickerDirectory), false);
  assert.equal(isTimelinePickerCacheJsonUri('content://provider/document/timeline.json', pickerDirectory), false);
});