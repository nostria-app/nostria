package app.nostria.mediasession

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.os.Build
import android.os.SystemClock
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.annotation.Keep
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.media.app.NotificationCompat as MediaNotificationCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.net.HttpURLConnection
import java.net.URL

@Keep
@InvokeArg
class UpdateStateArgs {
    var title: String? = null
    var artist: String? = null
    var album: String? = null
    var artworkUrl: String? = null
    var duration: Double? = null
    var position: Double? = null
    var playbackSpeed: Double? = null
    var isPlaying: Boolean? = null
    var canPrev: Boolean? = null
    var canNext: Boolean? = null
    var canSeek: Boolean? = null
}

@Keep
@InvokeArg
class UpdateTimelineArgs {
    var position: Double? = null
    var duration: Double? = null
    var playbackSpeed: Double? = null
}

@TauriPlugin
class MediaSessionPlugin(private val activity: Activity) : Plugin(activity) {
    private var mediaSession: MediaSessionCompat? = null
    private var notificationManager: NotificationManagerCompat? = null
    private var cachedArtworkUrl: String? = null
    private var cachedArtworkBitmap: Bitmap? = null
    private var fallbackArtworkBitmap: Bitmap? = null
    private var notificationPermissionRequested = false

    private var currentTitle = ""
    private var currentArtist = ""
    private var currentAlbum = ""
    private var currentDuration = 0.0
    private var currentPosition = 0.0
    private var currentPlaybackSpeed = 1.0
    private var currentIsPlaying = false
    private var currentCanPrev = false
    private var currentCanNext = false
    private var currentCanSeek = true

    private val channelId: String by lazy { "${activity.packageName}.media" }
    private val sessionTag: String by lazy { "${activity.packageName}.MediaSession" }

    init {
        activeInstance = this
    }

    @Command
    fun initialize(invoke: Invoke) {
        requestNotificationPermission()
        ensureSession()
        invoke.resolve()
    }

    @Command
    fun updateState(invoke: Invoke) {
        val args = invoke.parseArgs(UpdateStateArgs::class.java)
        val session = ensureSession() ?: run {
            invoke.reject("media session unavailable")
            return
        }

        requestNotificationPermission()

        args.title?.let { currentTitle = it.trim() }
        args.artist?.let { currentArtist = it.trim() }
        args.album?.let { currentAlbum = it.trim() }
        args.duration?.let { currentDuration = it }
        args.position?.let { currentPosition = it }
        args.playbackSpeed?.let { currentPlaybackSpeed = it }
        args.isPlaying?.let { currentIsPlaying = it }
        args.canPrev?.let { currentCanPrev = it }
        args.canNext?.let { currentCanNext = it }
        args.canSeek?.let { currentCanSeek = it }

        args.artworkUrl?.let { artworkUrl ->
            if (artworkUrl.isBlank()) {
                cachedArtworkUrl = null
                recycleCachedArtworkBitmap()
                cachedArtworkBitmap = getFallbackArtworkBitmap()
            } else if (artworkUrl != cachedArtworkUrl) {
                cachedArtworkUrl = artworkUrl
                downloadAndApplyArtwork(artworkUrl)
            }
        }

        val metadata = buildMetadata()
        session.setMetadata(metadata)
        session.setPlaybackState(buildPlaybackState())
        session.isActive = true
        updateNotification(metadata)?.let { MediaSessionCleanupService.start(activity, it) }
        invoke.resolve()
    }

    @Command
    fun updateTimeline(invoke: Invoke) {
        val args = invoke.parseArgs(UpdateTimelineArgs::class.java)
        val session = mediaSession ?: run {
            invoke.reject("media session not initialized — call updateState first")
            return
        }

        args.position?.let { currentPosition = it }
        args.duration?.let { currentDuration = it }
        args.playbackSpeed?.let { currentPlaybackSpeed = it }

        session.setPlaybackState(buildPlaybackState())
        if (args.duration != null) {
            session.setMetadata(buildMetadata())
        }
        invoke.resolve()
    }

    @Command
    fun clear(invoke: Invoke) {
        releaseSession()
        invoke.resolve()
    }

    override fun onDestroy() {
        releaseSession()
        activeInstance = null
        super.onDestroy()
    }

    private fun buildPlaybackState(): PlaybackStateCompat {
        val positionMs = (currentPosition * 1000.0).toLong()
        val state = if (currentIsPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
        val speed = if (currentIsPlaying) currentPlaybackSpeed.toFloat() else 0.0f

        return PlaybackStateCompat.Builder()
            .setActions(buildAvailableActions())
            .setState(state, positionMs, speed, SystemClock.elapsedRealtime())
            .build()
    }

    private fun buildAvailableActions(): Long {
        var actions = PlaybackStateCompat.ACTION_PLAY_PAUSE or
            PlaybackStateCompat.ACTION_PLAY or
            PlaybackStateCompat.ACTION_PAUSE or
            PlaybackStateCompat.ACTION_STOP

        if (currentCanSeek) {
            actions = actions or PlaybackStateCompat.ACTION_SEEK_TO
        }
        if (currentCanPrev) {
            actions = actions or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
        }
        if (currentCanNext) {
            actions = actions or PlaybackStateCompat.ACTION_SKIP_TO_NEXT
        }

        return actions
    }

    private fun buildMetadata(): MediaMetadataCompat {
        val builder = MediaMetadataCompat.Builder()
        if (currentTitle.isNotEmpty()) {
            builder.putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
        }
        if (currentArtist.isNotEmpty()) {
            builder.putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
        }
        if (currentAlbum.isNotEmpty()) {
            builder.putString(MediaMetadataCompat.METADATA_KEY_ALBUM, currentAlbum)
        }
        val durationMs = (currentDuration * 1000.0).toLong()
        if (durationMs > 0) {
            builder.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs)
        }
        cachedArtworkBitmap?.let {
            builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it)
        }
        return builder.build()
    }

    private fun releaseSession() {
        mediaSession?.let { session ->
            try {
                session.setPlaybackState(
                    PlaybackStateCompat.Builder()
                        .setActions(0)
                        .setState(PlaybackStateCompat.STATE_NONE, 0L, 0f)
                        .build()
                )
                session.setMetadata(MediaMetadataCompat.Builder().build())
            } catch (_: Throwable) {
            }
            session.isActive = false
            session.release()
        }

        mediaSession = null
        notificationManager?.cancel(MediaSessionCleanupService.NOTIFICATION_ID)
        MediaSessionCleanupService.stop()

        currentTitle = ""
        currentArtist = ""
        currentAlbum = ""
        currentDuration = 0.0
        currentPosition = 0.0
        currentPlaybackSpeed = 1.0
        currentIsPlaying = false
        currentCanPrev = false
        currentCanNext = false
        currentCanSeek = true

        recycleCachedArtworkBitmap()
        cachedArtworkUrl = null
    }

    private fun requestNotificationPermission() {
        if (notificationPermissionRequested) {
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                NOTIFICATION_PERMISSION_REQUEST_CODE
            )
        }
        notificationPermissionRequested = true
    }

    private fun ensureSession(): MediaSessionCompat? {
        if (mediaSession != null) {
            return mediaSession
        }

        val session = MediaSessionCompat(activity, sessionTag)
        session.setCallback(sessionCallback)
        session.setFlags(
            MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
                MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        )
        session.isActive = true

        activity.packageManager.getLaunchIntentForPackage(activity.packageName)?.let { launchIntent ->
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
            session.setSessionActivity(PendingIntent.getActivity(activity, 0, launchIntent, flags))
        }

        mediaSession = session
        notificationManager = NotificationManagerCompat.from(activity)
        createNotificationChannel()
        return mediaSession
    }

    private fun downloadAndApplyArtwork(url: String) {
        Thread {
            val bitmap = fetchBitmapFromImageUrl(url) ?: getFallbackArtworkBitmap()
            activity.runOnUiThread {
                if (cachedArtworkUrl != url) {
                    bitmap?.takeIf { it !== fallbackArtworkBitmap }?.recycle()
                    return@runOnUiThread
                }
                recycleCachedArtworkBitmap()
                cachedArtworkBitmap = bitmap
                mediaSession?.let { session ->
                    val metadata = buildMetadata()
                    session.setMetadata(metadata)
                    updateNotification(metadata)?.let { MediaSessionCleanupService.pendingNotification = it }
                }
            }
        }.start()
    }

    private fun fetchBitmapFromImageUrl(url: String): Bitmap? {
        var connection: HttpURLConnection? = null
        return try {
            connection = URL(url).openConnection() as HttpURLConnection
            connection.connectTimeout = 10000
            connection.readTimeout = 10000
            connection.instanceFollowRedirects = true
            connection.connect()
            val bytes = connection.inputStream.use { it.readBytes() }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } catch (_: Exception) {
            null
        } finally {
            connection?.disconnect()
        }
    }

    private fun recycleCachedArtworkBitmap() {
        val bitmap = cachedArtworkBitmap
        if (bitmap != null && bitmap !== fallbackArtworkBitmap) {
            bitmap.recycle()
        }
        cachedArtworkBitmap = null
    }

    private fun getFallbackArtworkBitmap(): Bitmap? {
        if (fallbackArtworkBitmap != null) {
            return fallbackArtworkBitmap
        }

        return try {
            val drawable = activity.packageManager.getApplicationIcon(activity.applicationInfo)
            fallbackArtworkBitmap = drawableToBitmap(drawable)
            fallbackArtworkBitmap
        } catch (_: Throwable) {
            null
        }
    }

    private fun drawableToBitmap(drawable: Drawable): Bitmap {
        if (drawable is BitmapDrawable && drawable.bitmap != null) {
            return drawable.bitmap
        }

        val width = if (drawable.intrinsicWidth > 0) drawable.intrinsicWidth else MAX_ARTWORK_SIZE
        val height = if (drawable.intrinsicHeight > 0) drawable.intrinsicHeight else MAX_ARTWORK_SIZE
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        drawable.setBounds(0, 0, canvas.width, canvas.height)
        drawable.draw(canvas)
        return bitmap
    }

    private fun buildActionPendingIntent(action: String, requestCode: Int): PendingIntent {
        val intent = Intent(activity, MediaActionReceiver::class.java)
            .putExtra(MediaActionReceiver.EXTRA_ACTION, action)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        return PendingIntent.getBroadcast(activity, requestCode, intent, flags)
    }

    private fun getSmallIcon(): Int {
        val resources = activity.resources
        val packageName = activity.packageName
        var resourceId = resources.getIdentifier("ic_notification", "drawable", packageName)
        if (resourceId != 0) {
            return resourceId
        }
        resourceId = resources.getIdentifier("ic_notification", "mipmap", packageName)
        if (resourceId != 0) {
            return resourceId
        }
        return android.R.drawable.ic_media_play
    }

    private fun updateNotification(metadata: MediaMetadataCompat): Notification? {
        val session = mediaSession ?: return null
        val manager = notificationManager ?: return null
        val title = metadata.getString(MediaMetadataCompat.METADATA_KEY_TITLE)
            ?: activity.applicationInfo.loadLabel(activity.packageManager).toString()
        val artist = metadata.getString(MediaMetadataCompat.METADATA_KEY_ARTIST)
        val album = metadata.getString(MediaMetadataCompat.METADATA_KEY_ALBUM)
        val subtitle = listOfNotNull(artist, album).filter { it.isNotBlank() }.joinToString(" • ")
        val artwork = metadata.getBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART)

        val actions = mutableListOf<NotificationCompat.Action>()
        if (currentCanPrev) {
            actions.add(
                NotificationCompat.Action(
                    android.R.drawable.ic_media_previous,
                    "Previous",
                    buildActionPendingIntent("previous", RC_PREV)
                )
            )
        }
        actions.add(
            if (currentIsPlaying) {
                NotificationCompat.Action(
                    android.R.drawable.ic_media_pause,
                    "Pause",
                    buildActionPendingIntent("pause", RC_PAUSE)
                )
            } else {
                NotificationCompat.Action(
                    android.R.drawable.ic_media_play,
                    "Play",
                    buildActionPendingIntent("play", RC_PLAY)
                )
            }
        )
        if (currentCanNext) {
            actions.add(
                NotificationCompat.Action(
                    android.R.drawable.ic_media_next,
                    "Next",
                    buildActionPendingIntent("next", RC_NEXT)
                )
            )
        }

        val builder = NotificationCompat.Builder(activity, channelId)
            .setSmallIcon(getSmallIcon())
            .setContentTitle(title)
            .setContentText(subtitle)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setSilent(true)

        if (artwork != null) {
            builder.setLargeIcon(artwork)
        }

        activity.packageManager.getLaunchIntentForPackage(activity.packageName)?.let { launchIntent ->
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
            builder.setContentIntent(PendingIntent.getActivity(activity, 0, launchIntent, flags))
        }

        val compactIndices = IntArray(actions.size.coerceAtMost(3)) { it }
        val style = MediaNotificationCompat.MediaStyle().setMediaSession(session.sessionToken)
        if (compactIndices.isNotEmpty()) {
            style.setShowActionsInCompactView(*compactIndices)
        }
        builder.setStyle(style)
        actions.forEach { builder.addAction(it) }

        val notification = builder.build()
        manager.notify(MediaSessionCleanupService.NOTIFICATION_ID, notification)
        return notification
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }

        val manager = activity.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(channelId) != null) {
            return
        }

        val channel = NotificationChannel(
            channelId,
            "Media playback",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Media playback controls"
        }
        manager.createNotificationChannel(channel)
    }

    internal fun emitAction(action: String) {
        val payload = JSObject()
        payload.put("action", action)
        activity.runOnUiThread { trigger("media_action", payload) }
    }

    private fun emitSeek(positionMs: Long) {
        val payload = JSObject()
        payload.put("action", "seek")
        payload.put("seekPosition", positionMs / 1000.0)
        activity.runOnUiThread { trigger("media_action", payload) }
    }

    private val sessionCallback = object : MediaSessionCompat.Callback() {
        override fun onPlay() = emitAction("play")
        override fun onPause() = emitAction("pause")
        override fun onStop() = emitAction("stop")
        override fun onSkipToNext() = emitAction("next")
        override fun onSkipToPrevious() = emitAction("previous")
        override fun onSeekTo(pos: Long) = emitSeek(pos)
    }

    companion object {
        private const val NOTIFICATION_PERMISSION_REQUEST_CODE = 9402
        private const val MAX_ARTWORK_SIZE = 512
        private const val RC_PLAY = 1
        private const val RC_PAUSE = 2
        private const val RC_NEXT = 3
        private const val RC_PREV = 4

        @Volatile
        internal var activeInstance: MediaSessionPlugin? = null

        internal fun forceCleanup(context: Context) {
            activeInstance?.releaseSession()
            try {
                NotificationManagerCompat.from(context).cancel(MediaSessionCleanupService.NOTIFICATION_ID)
            } catch (_: Throwable) {
            }
        }

        internal fun handleMediaAction(action: String) {
            activeInstance?.emitAction(action)
        }
    }
}