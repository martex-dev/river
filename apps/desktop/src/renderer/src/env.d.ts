/// <reference types="vite/client" />
import type { RiverApi } from '../../shared/ipc.ts';

declare global {
  interface Window {
    river: RiverApi;
  }
}
