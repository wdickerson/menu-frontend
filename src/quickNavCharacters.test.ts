import { describe, expect, it } from 'vitest';
import { quickNavCharacterSpeech } from './quickNavCharacters';

describe('Quick Nav character speech', () => {
  it.each(Array.from('.,:;!?\'’‘"“”-–—_()[]{} /\\|&@#$€£¥%+=*<>^~`…•°\t\n\r'))(
    'gives punctuation or whitespace %j an audible name', (character) => {
      const spoken = quickNavCharacterSpeech(character);
      expect(spoken).not.toBe(character);
      expect(spoken).toMatch(/[a-z]/);
    },
  );

  it.each(['A', 'z', '7', 'é', '食', '😀'])('retains character %s', (character) => {
    expect(quickNavCharacterSpeech(character)).toBe(character);
  });

  it('names non-breaking whitespace instead of silently skipping it', () => {
    expect(quickNavCharacterSpeech('\u00a0')).toBe('space');
  });
});