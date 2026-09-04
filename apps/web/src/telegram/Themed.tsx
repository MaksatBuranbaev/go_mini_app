import { isMiniAppDark, useSignal } from '@telegram-apps/sdk-react';
import { AppRoot } from '@telegram-apps/telegram-ui';
import { useEffect, type ReactNode } from 'react';

/**
 * Тема приложения одним местом.
 *
 * Цвета Telegram отдаёт переменными, но часть своих значений telegram-ui
 * держит внутри темы компонентов — и без явного `appearance` он остаётся
 * светлым даже под тёмной палитрой клиента. На телефоне это выглядело так:
 * подложки и текст приходят тёмные, а обводки и надписи кнопок остаются
 * чёрными — то есть невидимыми. Поэтому тему выставляем сами.
 *
 * Тот же признак кладётся на `<html>`: собственному CSS нужен не цвет, а сам
 * факт «темно сейчас» — тени и подложки в двух темах считаются по-разному.
 */
export function Themed({ children }: { children: ReactNode }) {
  const isDark = useSignal(isMiniAppDark);

  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  }, [isDark]);

  return (
    <AppRoot appearance={isDark ? 'dark' : 'light'} style={{ height: '100%' }}>
      {children}
    </AppRoot>
  );
}
