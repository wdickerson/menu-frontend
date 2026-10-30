// Literal punctuation is often silent when submitted alone to speech synthesis.
const CHARACTER_NAMES: Record<string, string> = {
  ' ': 'space', '\t': 'tab', '\n': 'new line', '\r': 'carriage return',
  '.': 'period', ',': 'comma', ':': 'colon', ';': 'semicolon',
  '!': 'exclamation mark', '?': 'question mark',
  "'": 'apostrophe', '’': 'right single quotation mark', '‘': 'left single quotation mark',
  '"': 'quotation mark', '“': 'left quotation mark', '”': 'right quotation mark',
  '-': 'hyphen', '–': 'en dash', '—': 'em dash', '_': 'underscore',
  '(': 'left parenthesis', ')': 'right parenthesis',
  '[': 'left bracket', ']': 'right bracket', '{': 'left brace', '}': 'right brace',
  '/': 'slash', '\\': 'backslash', '|': 'vertical bar',
  '&': 'ampersand', '@': 'at sign', '#': 'number sign',
  '$': 'dollar sign', '€': 'euro sign', '£': 'pound sign', '¥': 'yen sign',
  '%': 'percent sign', '+': 'plus sign', '=': 'equals sign', '*': 'asterisk',
  '<': 'less than sign', '>': 'greater than sign', '^': 'caret',
  '~': 'tilde', '`': 'backtick', '…': 'ellipsis', '•': 'bullet', '°': 'degree sign',
};

export function quickNavCharacterSpeech(character: string) {
  return CHARACTER_NAMES[character] ?? (/\s/u.test(character) ? 'space' : character);
}