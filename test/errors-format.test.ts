import { describe, expect, it } from 'vitest';
import { formatDuration, progressBar, truncate } from '../src/util/format.js';
import { classifyStderr, isFilterRejection, YtError } from '../src/youtube/errors.js';

describe('classifyStderr', () => {
  it.each([
    ['ERROR: [youtube] x: Private video. Sign in if you\'ve been granted access', 'private'],
    ['ERROR: Join this channel to get access to members-only content', 'private'],
    ['ERROR: [youtube] x: Sign in to confirm your age. This video may be inappropriate for some users.', 'age_restricted'],
    ["ERROR: [youtube] x: Sign in to confirm you're not a bot.", 'bot_check'],
    ['ERROR: unable to download webpage: HTTP Error 429: Too Many Requests', 'bot_check'],
    ['ERROR: The uploader has not made this video available in your country', 'geo_blocked'],
    ['ERROR: Video not available in your country', 'geo_blocked'],
    ['ERROR: [youtube] x: This live event will begin in 3 hours.', 'live'],
    ['ERROR: [youtube] x: Video unavailable. This video has been removed by the uploader', 'unavailable'],
    ['ERROR: [youtube:tab] The playlist does not exist.', 'unavailable'],
    ['ERROR: unable to download video data: HTTP Error 403: Forbidden', 'forbidden'],
    ['ERROR: [youtube] x: Requested format is not available', 'extractor'],
    ['WARNING: nsig extraction failed', 'extractor'],
    ['algo totalmente novo', 'unknown'],
  ])('%s → %s', (stderr, code) => {
    expect(classifyStderr(stderr)).toBe(code);
  });

  it('marca como retentáveis só as falhas transitórias', () => {
    expect(new YtError('forbidden').retriable).toBe(true);
    expect(new YtError('extractor').retriable).toBe(true);
    expect(new YtError('timeout').retriable).toBe(true);
    expect(new YtError('unknown').retriable).toBe(true);
    expect(new YtError('private').retriable).toBe(false);
    expect(new YtError('age_restricted').retriable).toBe(false);
    expect(new YtError('bot_check').retriable).toBe(false);
  });

  it('detecta rejeição do --match-filter', () => {
    expect(isFilterRejection('[download] x does not pass filter (!is_live & duration <= 7200), skipping ..')).toBe(true);
    expect(isFilterRejection('[download] 100%')).toBe(false);
  });
});

describe('format', () => {
  it.each([
    [0, '0:00'],
    [59, '0:59'],
    [61, '1:01'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [7325, '2:02:05'],
    [61.9, '1:01'],
    [-5, '0:00'],
    [null, '??:??'],
  ] as const)('formatDuration(%s) = %s', (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });

  it('progressBar posiciona o marcador e sempre tem a mesma largura', () => {
    expect(progressBar(0, 100, 10)).toBe(`🔘${'▬'.repeat(9)}`);
    expect(progressBar(50, 100, 10)).toBe(`${'▬'.repeat(5)}🔘${'▬'.repeat(4)}`);
    expect(progressBar(100, 100, 10)).toBe(`${'▬'.repeat(9)}🔘`);
    expect(progressBar(500, 100, 10)).toBe(`${'▬'.repeat(9)}🔘`);
    expect(progressBar(10, null, 10)).toBe(`🔘${'▬'.repeat(10)}`);
  });

  it('truncate', () => {
    expect(truncate('abc', 5)).toBe('abc');
    expect(truncate('abcdef', 4)).toBe('abc…');
  });
});
