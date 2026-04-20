package app.nostria.mediasession

import android.app.Notification
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log

class MediaSessionCleanupService : Service() {
    companion object {
        private const val TAG = "plugin/media-session"
        private const val ACTION_INIT = "app.nostria.mediasession.ACTION_INIT"
        internal const val NOTIFICATION_ID = 9401

        @Volatile
        internal var instance: MediaSessionCleanupService? = null

        @Volatile
        internal var pendingNotification: Notification? = null

        fun start(context: Context, notification: Notification) {
            pendingNotification = notification
            val service = instance
            if (service != null) {
                service.reinforcePlayback(notification)
                return
            }

            try {
                context.startForegroundService(
                    Intent(context, MediaSessionCleanupService::class.java).setAction(ACTION_INIT)
                )
            } catch (error: Exception) {
                Log.e(TAG, "startForegroundService failed: ${error.message}")
            }
        }

        fun stop() {
            instance?.handleStop()
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    private var noisyReceiver: BroadcastReceiver? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_INIT) {
            val notification = pendingNotification ?: run {
                stopSelf()
                return START_STICKY
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }

            acquireWakeLock()
            requestAudioFocus()
            registerNoisyReceiver()
        }

        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onTaskRemoved(rootIntent: Intent?) {
        instance = null
        releaseResources()
        MediaSessionPlugin.forceCleanup(applicationContext)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        instance = null
        releaseResources()
        MediaSessionPlugin.forceCleanup(applicationContext)
        super.onDestroy()
    }

    internal fun postNotification(notification: Notification) {
        val manager = getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
        manager.notify(NOTIFICATION_ID, notification)
    }

    internal fun reinforcePlayback(notification: Notification) {
        postNotification(notification)
        acquireWakeLock()
        requestAudioFocus(force = true)
        registerNoisyReceiver()
    }

    private fun handleStop() {
        releaseResources()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
    }

    private fun releaseResources() {
        unregisterNoisyReceiver()
        releaseWakeLock()
        abandonAudioFocus()
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) {
            return
        }

        val powerManager = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "app.nostria.mediasession:PlaybackWakeLock"
        ).apply {
            acquire(24 * 60 * 60 * 1000L)
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) {
                it.release()
            }
        }
        wakeLock = null
    }

    private fun requestAudioFocus(force: Boolean = false) {
        val audioManager = getSystemService(AUDIO_SERVICE) as AudioManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (audioFocusRequest != null && !force) {
                return
            }

            if (force) {
                audioFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
                audioFocusRequest = null
            }

            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                )
                .setAcceptsDelayedFocusGain(true)
                .setOnAudioFocusChangeListener { change ->
                    when (change) {
                        AudioManager.AUDIOFOCUS_LOSS,
                        AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
                        AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> MediaSessionPlugin.handleMediaAction("pause")
                        AudioManager.AUDIOFOCUS_GAIN -> MediaSessionPlugin.handleMediaAction("play")
                    }
                }
                .build()

            val result = audioManager.requestAudioFocus(request)
            if (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED ||
                result == AudioManager.AUDIOFOCUS_REQUEST_DELAYED) {
                audioFocusRequest = request
            }
        } else {
            if (force) {
                @Suppress("DEPRECATION")
                audioManager.abandonAudioFocus(null)
            }

            @Suppress("DEPRECATION")
            audioManager.requestAudioFocus(
                { change ->
                    when (change) {
                        AudioManager.AUDIOFOCUS_LOSS,
                        AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
                        AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> MediaSessionPlugin.handleMediaAction("pause")
                        AudioManager.AUDIOFOCUS_GAIN -> MediaSessionPlugin.handleMediaAction("play")
                    }
                },
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN
            )
        }
    }

    private fun abandonAudioFocus() {
        val audioManager = getSystemService(AUDIO_SERVICE) as AudioManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
            audioFocusRequest = null
        } else {
            @Suppress("DEPRECATION")
            audioManager.abandonAudioFocus(null)
        }
    }

    private fun registerNoisyReceiver() {
        if (noisyReceiver != null) {
            return
        }

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent?) {
                if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
                    MediaSessionPlugin.handleMediaAction("pause")
                }
            }
        }

        registerReceiver(receiver, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY))
        noisyReceiver = receiver
    }

    private fun unregisterNoisyReceiver() {
        noisyReceiver?.let {
            try {
                unregisterReceiver(it)
            } catch (_: Exception) {
            }
            noisyReceiver = null
        }
    }
}