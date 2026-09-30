/**
 * Google Timeline JSON parser, adapted from Orbit's MIT-licensed
 * src/lib/import/google-timeline.ts.
 *
 * Copyright (c) 2015-present 650 Industries, Inc. (aka Expo)
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 */

import type { RawLocation } from './visitProcessor';

export type GoogleTimelineFormat = 'android-semantic' | 'ios-semantic' | 'legacy-records';
export type TimelineImportResult = {
  format: GoogleTimelineFormat;
  points: RawLocation[];
  skipped: number;
};

const VISIT_SAMPLE_INTERVAL_MS = 10 * 60 * 1000;
const VISIT_MAX_SAMPLES = 100_000;
const VISIT_MAX_GAP_MS = 29 * 60 * 1000;
const DEFAULT_ACCURACY_METERS = 25;
type Coordinate = { lat: number; lng: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function validCoordinate(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180;
}

export function parseTimelineCoordinate(value: unknown): Coordinate | null {
  if (typeof value === 'string') {
    const parts = value.replace(/^geo:/i, '').replace(/°/g, '').split(',').map(part => Number(part.trim()));
    if (parts.length === 2 && validCoordinate(parts[0], parts[1])) return { lat: parts[0], lng: parts[1] };
    return null;
  }
  if (!isRecord(value)) return null;
  if ('latLng' in value) return parseTimelineCoordinate(value.latLng);
  if ('placeLocation' in value) return parseTimelineCoordinate(value.placeLocation);

  const latitudeE7 = asNumber(value.latitudeE7);
  const longitudeE7 = asNumber(value.longitudeE7);
  if (latitudeE7 !== null && longitudeE7 !== null) {
    const lat = latitudeE7 / 1e7;
    const lng = longitudeE7 / 1e7;
    return validCoordinate(lat, lng) ? { lat, lng } : null;
  }
  const lat = asNumber(value.lat ?? value.latitude);
  const lng = asNumber(value.lng ?? value.lon ?? value.longitude);
  return lat !== null && lng !== null && validCoordinate(lat, lng) ? { lat, lng } : null;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function detectFormat(json: unknown): GoogleTimelineFormat | null {
  if (Array.isArray(json)) {
    return json.length === 0 || json.some(entry =>
      isRecord(entry) && 'startTime' in entry && ('visit' in entry || 'activity' in entry || 'timelinePath' in entry),
    ) ? 'ios-semantic' : null;
  }
  if (!isRecord(json)) return null;
  if (Array.isArray(json.semanticSegments) || Array.isArray(json.rawSignals)) return 'android-semantic';
  return Array.isArray(json.locations) ? 'legacy-records' : null;
}

class PointCollector {
  private readonly seen = new Set<string>();
  readonly points: RawLocation[] = [];

  add(timestamp: number | null, coordinate: Coordinate | null, accuracy?: number | null): boolean {
    if (timestamp === null || !coordinate) return false;
    const pointAccuracy = accuracy !== null && accuracy !== undefined && accuracy >= 0 && accuracy <= 1000
      ? accuracy
      : DEFAULT_ACCURACY_METERS;
    const key = `${timestamp}:${coordinate.lat.toFixed(6)}:${coordinate.lng.toFixed(6)}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.points.push({ lat: coordinate.lat, lng: coordinate.lng, timestamp, accuracy: pointAccuracy });
    return true;
  }
}

function addVisitSamples(collector: PointCollector, coordinate: Coordinate | null, start: number | null, end: number | null): boolean {
  if (!coordinate || start === null) return false;
  const finish = end !== null && end > start ? end : start;
  const span = finish - start;
  const samples = Math.max(
    1,
    Math.ceil(span / VISIT_SAMPLE_INTERVAL_MS),
    Math.ceil(span / VISIT_MAX_GAP_MS),
  );
  if (samples > VISIT_MAX_SAMPLES) return false;
  let added = false;
  for (let index = 0; index <= samples; index += 1) {
    const timestamp = span === 0 ? start : Math.round(start + span * index / samples);
    added = collector.add(timestamp, coordinate) || added;
    if (span === 0) break;
  }
  return added;
}

function parseSemanticSegments(segments: unknown[], collector: PointCollector, skipped: { count: number }): void {
  for (const segment of segments) {
    if (!isRecord(segment)) {
      skipped.count += 1;
      continue;
    }
    const start = parseTimestamp(segment.startTime);
    const end = parseTimestamp(segment.endTime);
    if (Array.isArray(segment.timelinePath) && segment.timelinePath.length > 0) {
      for (const entry of segment.timelinePath) {
        if (!isRecord(entry)) continue;
        let timestamp = parseTimestamp(entry.time);
        if (timestamp === null && start !== null) {
          const offset = asNumber(entry.durationMinutesOffsetFromStartTime);
          if (offset !== null) timestamp = start + offset * 60_000;
        }
        if (!collector.add(timestamp, parseTimelineCoordinate(entry.point))) skipped.count += 1;
      }
      continue;
    }
    if (isRecord(segment.visit)) {
      const candidate = isRecord(segment.visit.topCandidate) ? segment.visit.topCandidate : null;
      const coordinate = parseTimelineCoordinate(candidate?.placeLocation ?? segment.visit.placeLocation);
      if (!addVisitSamples(collector, coordinate, start, end)) skipped.count += 1;
      continue;
    }
    if (isRecord(segment.activity)) {
      const startAdded = collector.add(start, parseTimelineCoordinate(segment.activity.start));
      const endAdded = collector.add(end, parseTimelineCoordinate(segment.activity.end));
      if (!startAdded && !endAdded) skipped.count += 1;
      continue;
    }
    skipped.count += 1;
  }
}

function parseRawSignals(signals: unknown[], collector: PointCollector, skipped: { count: number }): void {
  for (const signal of signals) {
    if (!isRecord(signal) || !isRecord(signal.position)) {
      skipped.count += 1;
      continue;
    }
    const position = signal.position;
    const added = collector.add(
      parseTimestamp(position.timestamp),
      parseTimelineCoordinate(position.LatLng ?? position.latLng),
      asNumber(position.accuracyMeters),
    );
    if (!added) skipped.count += 1;
  }
}

function parseLegacyRecords(records: unknown[], collector: PointCollector, skipped: { count: number }): void {
  for (const record of records) {
    if (!isRecord(record)) {
      skipped.count += 1;
      continue;
    }
    const added = collector.add(
      parseTimestamp(record.timestamp ?? record.timestampMs),
      parseTimelineCoordinate(record),
      asNumber(record.accuracy),
    );
    if (!added) skipped.count += 1;
  }
}

export function parseGoogleTimeline(value: unknown): TimelineImportResult {
  const format = detectFormat(value);
  if (!format) {
    throw new Error('This file is not a Google Timeline export. Choose Android or iOS Timeline JSON, or legacy Takeout Records.json.');
  }
  const collector = new PointCollector();
  const skipped = { count: 0 };
  if (format === 'ios-semantic') {
    parseSemanticSegments(value as unknown[], collector, skipped);
  } else if (format === 'android-semantic') {
    const root = value as Record<string, unknown>;
    if (Array.isArray(root.semanticSegments)) parseSemanticSegments(root.semanticSegments, collector, skipped);
    if (Array.isArray(root.rawSignals)) parseRawSignals(root.rawSignals, collector, skipped);
  } else {
    parseLegacyRecords((value as { locations: unknown[] }).locations, collector, skipped);
  }
  return { format, points: collector.points.sort((a, b) => a.timestamp - b.timestamp), skipped: skipped.count };
}

export function parseGoogleTimelineText(text: string): TimelineImportResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('The selected file is not valid JSON. Choose a Google Timeline .json export.');
  }
  const result = parseGoogleTimeline(json);
  if (result.points.length === 0) throw new Error('No usable location points were found in this Google Timeline file.');
  return result;
}