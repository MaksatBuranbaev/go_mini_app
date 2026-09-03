/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Базовый URL комнаты (Worker). В проде задаётся при сборке Pages. */
  readonly VITE_ROOM_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
