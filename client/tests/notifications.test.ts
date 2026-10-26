import { NotifyApp } from '@/ble/protocol/display';
import { androidCategoryToApp, ancsCategoryToApp } from '@/notifications/phoneNotifications';

describe('категории уведомлений', () => {
  it('ANCS', () => {
    expect(ancsCategoryToApp(1)).toBe(NotifyApp.CALL);
    expect(ancsCategoryToApp(4)).toBe(NotifyApp.MESSENGER);
    expect(ancsCategoryToApp(6)).toBe(NotifyApp.MAIL);
    expect(ancsCategoryToApp(42)).toBe(NotifyApp.OTHER);
  });

  it('Android', () => {
    expect(androidCategoryToApp('msg')).toBe(NotifyApp.MESSENGER);
    expect(androidCategoryToApp('')).toBe(NotifyApp.OTHER);
  });
});
