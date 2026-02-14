import UIKit
import UniformTypeIdentifiers

@available(iOS 13.0, *)
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    // If our app is launched with a universal link, we'll store it in this variable
    static var universalLinkToLaunch: URL? = nil; 
    static var shortcutLinkToLaunch: URL? = nil
    static var pendingSharedPayload: String? = nil

    private func mappedInboundUrl(_ inbound: URL) -> URL? {
        guard let scheme = inbound.scheme?.lowercased() else {
            return nil
        }

        if scheme == "http" || scheme == "https" {
            return inbound
        }

        if scheme == "nostr" || scheme == "nostr+walletconnect" {
            if scheme == "nostr", inbound.host?.lowercased() == "share" {
                return rootUrl
            }
            let encoded = inbound.absoluteString.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
            return URL(string: "\(rootUrl.absoluteString)?open=\(encoded)")
        }

        var comps = URLComponents(url: inbound, resolvingAgainstBaseURL: false)
        comps?.scheme = "https"
        return comps?.url
    }

    private func jsEscaped(_ value: String) -> String {
        return value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")
    }

    private func navigateWebView(_ targetUrl: URL) {
        let escaped = jsEscaped(targetUrl.absoluteString)
        Nostria.webView.evaluateJavaScript("location.href = '\(escaped)'")
    }

    private func deliverSharedPayload(_ payloadString: String) {
        if Nostria.webView != nil && !Nostria.webView.isLoading && !Nostria.webView.isHidden {
            Nostria.webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('native-share', { detail: \(payloadString) }))")
            SceneDelegate.pendingSharedPayload = nil
            return
        }

        SceneDelegate.pendingSharedPayload = payloadString

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            self.deliverSharedPayload(payloadString)
        }
    }

    static func flushPendingSharedPayloadIfAny() {
        guard
            let payloadString = pendingSharedPayload,
            Nostria.webView != nil,
            !Nostria.webView.isLoading,
            !Nostria.webView.isHidden
        else {
            return
        }

        Nostria.webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('native-share', { detail: \(payloadString) }))")
        pendingSharedPayload = nil
    }

    private func dispatchSharedFile(_ fileUrl: URL) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let fileData = try? Data(contentsOf: fileUrl) else {
                return
            }

            let fileName = fileUrl.lastPathComponent
            let ext = fileUrl.pathExtension
            let mime = UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
            let dataUrl = "data:\(mime);base64,\(fileData.base64EncodedString())"

            let payload: [String: String] = [
                "name": fileName,
                "mimeType": mime,
                "dataUrl": dataUrl
            ]

            guard
                let payloadData = try? JSONSerialization.data(withJSONObject: payload, options: []),
                let payloadString = String(data: payloadData, encoding: .utf8)
            else {
                return
            }

            DispatchQueue.main.async {
                self.deliverSharedPayload(payloadString)
            }
        }
    }

    private func dispatchSharedFromAppGroupIfPresent() {
        guard let defaults = UserDefaults(suiteName: sharedAppGroupId) else {
            return
        }

        guard
            let base64 = defaults.string(forKey: "shared_base64"),
            let name = defaults.string(forKey: "shared_name")
        else {
            return
        }

        let mime = defaults.string(forKey: "shared_mime") ?? "application/octet-stream"

        defaults.removeObject(forKey: "shared_base64")
        defaults.removeObject(forKey: "shared_name")
        defaults.removeObject(forKey: "shared_mime")

        let payload: [String: String] = [
            "name": name,
            "mimeType": mime,
            "dataUrl": "data:\(mime);base64,\(base64)"
        ]

        guard
            let payloadData = try? JSONSerialization.data(withJSONObject: payload, options: []),
            let payloadString = String(data: payloadData, encoding: .utf8)
        else {
            return
        }

        deliverSharedPayload(payloadString)
    }


    // This function is called when your app launches.
    // Check to see if we were launched via a universal link or a shortcut.
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // See if our app is being launched via universal link.
        // If so, store that link so we can navigate to it once our webView is initialized.
        for userActivity in connectionOptions.userActivities {
            if let universalLink = userActivity.webpageURL {
                SceneDelegate.universalLinkToLaunch = universalLink;
                break
            }
        }

        // See if we were launched via shortcut
        if let shortcutUrl = connectionOptions.shortcutItem?.type {            
            SceneDelegate.shortcutLinkToLaunch = URL.init(string: shortcutUrl)
        }
        
        // See if we were launched via scheme URL
        if let schemeUrl = connectionOptions.urlContexts.first?.url {
            if schemeUrl.isFileURL {
                dispatchSharedFile(schemeUrl)
            } else if let url = mappedInboundUrl(schemeUrl) {
                SceneDelegate.universalLinkToLaunch = url;
            }
        }
    }
    
    // This function is called when our app is already running and the user clicks a custom scheme URL
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        if let scheme = URLContexts.first?.url {
            if scheme.isFileURL {
                dispatchSharedFile(scheme)
            } else if let url = mappedInboundUrl(scheme) {
                // Handle it inside our web view in a SPA-friendly way.
                navigateWebView(url)
                if scheme.scheme?.lowercased() == "nostr", scheme.host?.lowercased() == "share" {
                    dispatchSharedFromAppGroupIfPresent()
                }
            }
        }
    }

    // This function is called when our app is already running and the user clicks a universal link.
    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        // Handle universal links into our app when the app is already running.
        // This allows your PWA to open links to your domain, rather than opening in a browser tab.
        // For more info about universal links, see https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app
        
        // Ensure we're trying to launch a link.
        guard userActivity.activityType == NSUserActivityTypeBrowsingWeb,
            let universalLink = userActivity.webpageURL else {
            return
        }

        // Handle it inside our web view in a SPA-friendly way.
        navigateWebView(universalLink)
    }

    // This function is called if our app is already loaded and the user activates the app via shortcut
    func windowScene(_ windowScene: UIWindowScene,
                     performActionFor shortcutItem: UIApplicationShortcutItem,
                     completionHandler: @escaping (Bool) -> Void) {
        if let shortcutUrl = URL.init(string: shortcutItem.type) {
            navigateWebView(shortcutUrl);
        }
    }

    func sceneDidDisconnect(_ scene: UIScene) {
        // Called as the scene is being released by the system.
        // This occurs shortly after the scene enters the background, or when its session is discarded.
        // Release any resources associated with this scene that can be re-created the next time the scene connects.
        // The scene may re-connect later, as its session was not neccessarily discarded (see `application:didDiscardSceneSessions` instead).
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        // Called when the scene has moved from an inactive state to an active state.
        // Use this method to restart any tasks that were paused (or not yet started) when the scene was inactive.
    }

    func sceneWillResignActive(_ scene: UIScene) {
        // Called when the scene will move from an active state to an inactive state.
        // This may occur due to temporary interruptions (ex. an incoming phone call).
    }

    func sceneWillEnterForeground(_ scene: UIScene) {
        // Called as the scene transitions from the background to the foreground.
        // Use this method to undo the changes made on entering the background.
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        // Called as the scene transitions from the foreground to the background.
        // Use this method to save data, release shared resources, and store enough scene-specific state information
        // to restore the scene back to its current state.
    }


}

