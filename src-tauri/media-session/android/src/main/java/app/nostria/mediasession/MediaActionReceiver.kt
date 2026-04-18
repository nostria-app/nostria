package app.nostria.mediasession

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class MediaActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.getStringExtra(EXTRA_ACTION) ?: return
        Log.d(TAG, "onReceive: action=\"$action\"")
        MediaSessionPlugin.handleMediaAction(action)
    }

    companion object {
        internal const val EXTRA_ACTION = "app.nostria.mediasession.EXTRA_ACTION"
        private const val TAG = "plugin/media-session"
    }
}