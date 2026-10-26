package expo.modules.notificationlistener

import android.content.Intent
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NotificationListenerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NotificationListener")

    Events("onNotification")

    OnStartObserving {
      OchkoNotificationListenerService.listener = { payload -> sendEvent("onNotification", payload) }
    }

    OnStopObserving {
      OchkoNotificationListenerService.listener = null
    }

    Function("isPermissionGranted") {
      val context = appContext.reactContext ?: return@Function false
      NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
    }

    Function("openPermissionSettings") {
      val context = appContext.reactContext ?: return@Function
      context.startActivity(
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
    }
  }
}
