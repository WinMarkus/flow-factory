import { randomInt, randomUUID } from 'node:crypto';
import { ROOM_CODE_ALPHABET } from '../shared/constants.js';

export function newId(): string {
  return randomUUID();
}

export function newToken(): string {
  return randomUUID().replace(/-/g, '');
}

export function generateRoomCode(length = 4): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(0, ROOM_CODE_ALPHABET.length)];
  }
  return code;
}
