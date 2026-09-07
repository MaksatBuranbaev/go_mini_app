/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Базовый URL комнаты (Worker). В проде задаётся при сборке Pages. */
  readonly VITE_ROOM_URL?: string;

  /** Ссылка на мини-апп для приглашений: `t.me/<бот>/<приложение>`. */
  readonly VITE_MINIAPP_LINK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
