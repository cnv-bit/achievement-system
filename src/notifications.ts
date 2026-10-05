export type NotificationLevel = 'success' | 'error' | 'info';

export interface NotificationPort {
  success(message: string): void;
  error(message: string): void;
  info(message: string): void;
}

export type TavernToastr = Record<NotificationLevel,
  (message: string, title: string, options: { escapeHtml: boolean }) => unknown>;

/** UI 边界统一通知；复用宿主酒馆的位置、颜色和显示时长。 */
export class AchievementNotifications implements NotificationPort {
  private readonly getToastr: () => TavernToastr;

  constructor(getToastr: () => TavernToastr = () => window.parent.toastr) {
    this.getToastr = getToastr;
  }

  show(level: NotificationLevel, message: string): void {
    this.getToastr()[level](message, '成就系统', { escapeHtml: true });
  }

  success(message: string): void { this.show('success', message); }
  error(message: string): void { this.show('error', message); }
  info(message: string): void { this.show('info', message); }
}

export const notifications = new AchievementNotifications();
