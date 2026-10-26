package expo.modules.notificationlistener

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Системный сервис чтения уведомлений (включается пользователем в настройках
 * «Доступ к уведомлениям»). Пересылает новые уведомления в модуль JS.
 */
class OchkoNotificationListenerService : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    val n = sbn.notification ?: return
    // Постоянные (музыка, навигация, фоновые сервисы) и сводки групп не показываем
    if (sbn.isOngoing || (n.flags and Notification.FLAG_GROUP_SUMMARY) != 0) return
    if (sbn.packageName == applicationContext.packageName) return
    val extras = n.extras
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
    val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
      ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString().orEmpty()
    if (title.isEmpty() && text.isEmpty()) return
    listener?.invoke(
      mapOf(
        "packageName" to sbn.packageName,
        "category" to (n.category ?: ""),
        "title" to title,
        "text" to text,
        "postedAt" to sbn.postTime.toDouble(),
      )
    )
  }

  companion object {
    @Volatile
    var listener: ((Map<String, Any?>) -> Unit)? = null
  }
}
