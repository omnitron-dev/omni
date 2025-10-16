/**
 * Types for collaboration extensions
 */

export interface User {
  id: string;
  name: string;
  color: string;
  cursor?: {
    anchor: number;
    head: number;
  };
}

export interface AwarenessState {
  user: User;
  cursor?: {
    anchor: number;
    head: number;
  };
}
