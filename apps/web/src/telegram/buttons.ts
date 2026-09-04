import { backButton, mainButton } from '@telegram-apps/sdk-react';
import { useEffect } from 'react';
import { isMockedEnv } from './mockEnv.js';

export interface MainButtonConfig {
  text: string;
  onClick: () => void;
  /**
   * Кнопка остаётся на экране, но не нажимается. Прятать её на время чужого
   * хода нельзя: появление и исчезновение MainButton меняет высоту вьюпорта,
   * доска пересчитывает раскладку, и второй тап двухтапового подтверждения
   * попадает уже в соседнее пересечение.
   */
  enabled?: boolean;
}

/**
 * Есть ли у нас настоящая нижняя кнопка клиента. За моком SDK рапортует, что
 * метод доступен, но рисовать кнопку некому — экраны в этом случае показывают
 * своё действие сами.
 */
export function hasNativeButtons(): boolean {
  return mainButton.setParams.isAvailable() && !isMockedEnv();
}

/**
 * Держит MainButton в согласии с экраном. `config` обязан быть мемоизирован:
 * от его ссылки зависит переподписка обработчика.
 */
export function useMainButton(config: MainButtonConfig | null): void {
  useEffect(() => {
    if (!mainButton.setParams.isAvailable()) return;
    if (config) {
      mainButton.setParams({
        text: config.text,
        isVisible: true,
        isEnabled: config.enabled ?? true,
      });
    }
    else mainButton.setParams({ isVisible: false });
  }, [config]);

  useEffect(() => {
    if (!config || !mainButton.onClick.isAvailable()) return;
    mainButton.onClick(config.onClick);
    return () => mainButton.offClick(config.onClick);
  }, [config]);

  useEffect(
    () => () => {
      if (mainButton.setParams.isAvailable()) mainButton.setParams({ isVisible: false });
    },
    [],
  );
}

/** Показывает системную кнопку «назад», пока экран жив. */
export function useBackButton(handler: (() => void) | null): void {
  useEffect(() => {
    if (!handler || !backButton.show.isAvailable()) return;
    backButton.show();
    backButton.onClick(handler);
    return () => {
      backButton.offClick(handler);
      if (backButton.hide.isAvailable()) backButton.hide();
    };
  }, [handler]);
}
