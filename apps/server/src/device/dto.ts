import type { M1State, Zm1Task } from '../device/zm1.ts';
import { hasAnyTask, parseState } from '../device/zm1.ts';

export interface DeviceDTO {
  mac: string;
  name: string;
  type: number;
  typeName: string;
  online: boolean;
  ip: string | null;
  order: number;
  state: M1State;
  updatedAt: number;
}
