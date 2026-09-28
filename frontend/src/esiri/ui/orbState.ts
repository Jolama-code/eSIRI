import type { Status } from '../esiriStore';
import type { OrbState } from './Orb';

export function orbStateFor(status: Status, micOpen: boolean, error: boolean): OrbState {
  if (error) return 'error';
  if (micOpen || status === 'listening') return 'listening';
  switch (status) {
    case 'thinking':
      return 'thinking';
    case 'acting':
      return 'acting';
    case 'speaking':
    case 'awaiting_confirmation':
    case 'awaiting_answer':
      return 'speaking';
    default:
      return 'idle';
  }
}
