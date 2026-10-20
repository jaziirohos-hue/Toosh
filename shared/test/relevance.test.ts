import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isRelevantEvcMessage } from '../src/relevance.ts';

// The Android receiver (EvcFilter.java) is checked against the same vectors.
const vectors = JSON.parse(readFileSync(new URL('./relevance-vectors.json', import.meta.url), 'utf8')) as { sender: string; body: string; strict: boolean; relevant: boolean }[];

test('only relevant EVC Plus messages are imported', () => {
  for (const v of vectors) assert.equal(isRelevantEvcMessage(v.sender, v.body, v.strict), v.relevant, `${v.sender}: ${v.body}`);
});
