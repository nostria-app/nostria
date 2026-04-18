import AVFoundation
import Foundation
import MediaPlayer
import Tauri
import UIKit

struct UpdateStateArgs: Decodable {
    let title: String?
    let artist: String?
    let album: String?
    let artworkUrl: String?
    let duration: Double?
    let position: Double?
    let playbackSpeed: Double?
    let isPlaying: Bool?
    let canPrev: Bool?
    let canNext: Bool?
    let canSeek: Bool?
}

struct UpdateTimelineArgs: Decodable {
    let position: Double?
    let duration: Double?
    let playbackSpeed: Double?
}

struct MediaActionPayload: Encodable {
    let action: String
    let seekPosition: Double?
}

class MediaSessionPlugin: Plugin {
    private let tag = "plugin/media-session"

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

    private var cachedArtworkUrl: String?
    private var cachedArtworkImage: UIImage?
    private var artworkDownloadTask: URLSessionDataTask?
    private var artworkDownloadRequestId: UUID?
    private var isSessionActive = false

    private var interruptionObserver: NSObjectProtocol?
    private var routeChangeObserver: NSObjectProtocol?

    @objc public func initialize(_ invoke: Invoke) throws {
        setupAudioSession()
        setupRemoteCommands()
        isSessionActive = true
        invoke.resolve()
    }

    @objc public func updateState(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(UpdateStateArgs.self)

        if !isSessionActive {
            setupAudioSession()
            setupRemoteCommands()
            isSessionActive = true
        }

        if let title = args.title?.trimmingCharacters(in: .whitespaces) { currentTitle = title }
        if let artist = args.artist?.trimmingCharacters(in: .whitespaces) { currentArtist = artist }
        if let album = args.album?.trimmingCharacters(in: .whitespaces) { currentAlbum = album }
        if let duration = args.duration { currentDuration = duration }
        if let position = args.position { currentPosition = position }
        if let playbackSpeed = args.playbackSpeed { currentPlaybackSpeed = playbackSpeed }
        if let isPlaying = args.isPlaying { currentIsPlaying = isPlaying }
        if let canPrev = args.canPrev { currentCanPrev = canPrev }
        if let canNext = args.canNext { currentCanNext = canNext }
        if let canSeek = args.canSeek { currentCanSeek = canSeek }

        if let artworkUrl = args.artworkUrl {
            if artworkUrl.isEmpty {
                artworkDownloadRequestId = nil
                artworkDownloadTask?.cancel()
                artworkDownloadTask = nil
                cachedArtworkImage = fallbackArtworkImage()
                cachedArtworkUrl = nil
            } else if artworkUrl != cachedArtworkUrl {
                cachedArtworkUrl = artworkUrl
                downloadAndApplyArtwork(url: artworkUrl)
            }
        }

        updateNowPlayingInfo()
        updateRemoteCommandStates()
        invoke.resolve()
    }

    @objc public func updateTimeline(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(UpdateTimelineArgs.self)

        guard isSessionActive else {
            invoke.reject("media session not initialized — call updateState first")
            return
        }

        if let position = args.position { currentPosition = position }
        if let duration = args.duration { currentDuration = duration }
        if let playbackSpeed = args.playbackSpeed { currentPlaybackSpeed = playbackSpeed }

        updateNowPlayingInfo()
        invoke.resolve()
    }

    @objc public func clear(_ invoke: Invoke) throws {
        releaseSession()
        invoke.resolve()
    }

    private func setupAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
            UIApplication.shared.beginReceivingRemoteControlEvents()
            setupInterruptionHandling()
        } catch {
            NSLog("%@: audio session setup failed: %@", tag, error.localizedDescription)
        }
    }

    private func setupInterruptionHandling() {
        if let observer = interruptionObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        if let observer = routeChangeObserver {
            NotificationCenter.default.removeObserver(observer)
        }

        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            self?.handleAudioInterruption(notification)
        }

        routeChangeObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            self?.handleRouteChange(notification)
        }
    }

    private func handleAudioInterruption(_ notification: Notification) {
        guard
            let userInfo = notification.userInfo,
            let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: typeValue)
        else {
            return
        }

        switch type {
        case .began:
            emitAction("pause")
        case .ended:
            let options = AVAudioSession.InterruptionOptions(
                rawValue: (userInfo[AVAudioSessionInterruptionOptionKey] as? UInt) ?? 0
            )
            if options.contains(.shouldResume) {
                try? AVAudioSession.sharedInstance().setActive(true)
                emitAction("play")
            }
        @unknown default:
            break
        }
    }

    private func handleRouteChange(_ notification: Notification) {
        guard
            let userInfo = notification.userInfo,
            let reasonValue = userInfo[AVAudioSessionRouteChangeReasonKey] as? UInt,
            let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue)
        else {
            return
        }

        if reason == .oldDeviceUnavailable {
            emitAction("pause")
        }
    }

    private func setupRemoteCommands() {
        let commandCenter = MPRemoteCommandCenter.shared()

        commandCenter.playCommand.addTarget { [weak self] _ in
            self?.emitAction("play")
            return .success
        }
        commandCenter.pauseCommand.addTarget { [weak self] _ in
            self?.emitAction("pause")
            return .success
        }
        commandCenter.stopCommand.addTarget { [weak self] _ in
            self?.emitAction("stop")
            return .success
        }
        commandCenter.nextTrackCommand.addTarget { [weak self] _ in
            self?.emitAction("next")
            return .success
        }
        commandCenter.previousTrackCommand.addTarget { [weak self] _ in
            self?.emitAction("previous")
            return .success
        }
        commandCenter.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let positionEvent = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            self?.emitSeek(positionSeconds: positionEvent.positionTime)
            return .success
        }
        commandCenter.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self else {
                return .commandFailed
            }
            self.emitAction(self.currentIsPlaying ? "pause" : "play")
            return .success
        }

        updateRemoteCommandStates()
    }

    private func updateRemoteCommandStates() {
        let commandCenter = MPRemoteCommandCenter.shared()
        commandCenter.playCommand.isEnabled = true
        commandCenter.pauseCommand.isEnabled = true
        commandCenter.stopCommand.isEnabled = true
        commandCenter.togglePlayPauseCommand.isEnabled = true
        commandCenter.nextTrackCommand.isEnabled = currentCanNext
        commandCenter.previousTrackCommand.isEnabled = currentCanPrev
        commandCenter.changePlaybackPositionCommand.isEnabled = currentCanSeek
    }

    private func updateNowPlayingInfo() {
        var info = [String: Any]()

        if !currentTitle.isEmpty { info[MPMediaItemPropertyTitle] = currentTitle }
        if !currentArtist.isEmpty { info[MPMediaItemPropertyArtist] = currentArtist }
        if !currentAlbum.isEmpty { info[MPMediaItemPropertyAlbumTitle] = currentAlbum }
        if currentDuration > 0 { info[MPMediaItemPropertyPlaybackDuration] = currentDuration }

        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentPosition
        info[MPNowPlayingInfoPropertyPlaybackRate] = currentIsPlaying ? currentPlaybackSpeed : 0.0
        info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = currentPlaybackSpeed

        if let image = cachedArtworkImage {
            info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        }

        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func emitAction(_ action: String) {
        let payload = MediaActionPayload(action: action, seekPosition: nil)
        DispatchQueue.main.async {
            try? self.trigger("media_action", data: payload)
        }
    }

    private func emitSeek(positionSeconds: Double) {
        let payload = MediaActionPayload(action: "seek", seekPosition: positionSeconds)
        DispatchQueue.main.async {
            try? self.trigger("media_action", data: payload)
        }
    }

    private func downloadAndApplyArtwork(url: String) {
        guard let imageUrl = URL(string: url) else {
            return
        }

        let requestId = UUID()
        artworkDownloadRequestId = requestId
        artworkDownloadTask?.cancel()

        let task = URLSession.shared.dataTask(with: imageUrl) { [weak self] data, _, error in
            guard let self else { return }
            guard self.artworkDownloadRequestId == requestId else { return }

            if error != nil || data == nil {
                DispatchQueue.main.async {
                    guard self.artworkDownloadRequestId == requestId else { return }
                    self.artworkDownloadRequestId = nil
                    self.artworkDownloadTask = nil
                    self.cachedArtworkUrl = nil
                    self.cachedArtworkImage = self.fallbackArtworkImage()
                    self.updateNowPlayingInfo()
                }
                return
            }

            guard let data, let image = UIImage(data: data) else {
                DispatchQueue.main.async {
                    guard self.artworkDownloadRequestId == requestId else { return }
                    self.artworkDownloadRequestId = nil
                    self.artworkDownloadTask = nil
                    self.cachedArtworkUrl = nil
                    self.cachedArtworkImage = self.fallbackArtworkImage()
                    self.updateNowPlayingInfo()
                }
                return
            }

            DispatchQueue.main.async {
                guard self.artworkDownloadRequestId == requestId else { return }
                guard self.cachedArtworkUrl == url else { return }
                self.artworkDownloadRequestId = nil
                self.artworkDownloadTask = nil
                self.cachedArtworkImage = image
                self.updateNowPlayingInfo()
            }
        }

        artworkDownloadTask = task
        task.resume()
    }

    private func releaseSession() {
        if let observer = interruptionObserver {
            NotificationCenter.default.removeObserver(observer)
            interruptionObserver = nil
        }
        if let observer = routeChangeObserver {
            NotificationCenter.default.removeObserver(observer)
            routeChangeObserver = nil
        }

        let commandCenter = MPRemoteCommandCenter.shared()
        commandCenter.playCommand.removeTarget(nil)
        commandCenter.pauseCommand.removeTarget(nil)
        commandCenter.stopCommand.removeTarget(nil)
        commandCenter.nextTrackCommand.removeTarget(nil)
        commandCenter.previousTrackCommand.removeTarget(nil)
        commandCenter.changePlaybackPositionCommand.removeTarget(nil)
        commandCenter.togglePlayPauseCommand.removeTarget(nil)

        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        UIApplication.shared.endReceivingRemoteControlEvents()

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

        cachedArtworkImage = nil
        cachedArtworkUrl = nil
        artworkDownloadRequestId = nil
        artworkDownloadTask?.cancel()
        artworkDownloadTask = nil
        isSessionActive = false
    }

    private func fallbackArtworkImage() -> UIImage? {
        if let image = UIImage(named: "icon") {
            return image
        }

        guard
            let icons = Bundle.main.infoDictionary?["CFBundleIcons"] as? [String: Any],
            let primary = icons["CFBundlePrimaryIcon"] as? [String: Any],
            let files = primary["CFBundleIconFiles"] as? [String],
            let last = files.last,
            let image = UIImage(named: last)
        else {
            return nil
        }

        return image
    }
}

@_cdecl("init_plugin_media_session")
func initPlugin() -> Plugin {
    MediaSessionPlugin()
}