import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

/** Client-generatable UUID v4 — every local primary key is created this way (ARCHITECTURE.md §6.2). */
export function newId(): string {
  return uuidv4();
}
