import UIKit
import Social
import UniformTypeIdentifiers

final class ShareViewController: SLComposeServiceViewController {
    private let appGroupId = "group.app.nostria"
    private let targetUrl = URL(string: "nostr://share")!

    override func isContentValid() -> Bool {
        return true
    }

    override func didSelectPost() {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
              let attachments = item.attachments,
              let provider = attachments.first else {
            completeExtensionRequest()
            return
        }

        if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil) { [weak self] item, _ in
                self?.handleLoadedImage(item)
            }
            return
        }

        completeExtensionRequest()
    }

    override func configurationItems() -> [Any]! {
        []
    }

    private func handleLoadedImage(_ item: NSSecureCoding?) {
        var sourceUrl: URL?

        if let directUrl = item as? URL {
            sourceUrl = directUrl
        }

        if sourceUrl == nil, let image = item as? UIImage {
            sourceUrl = persistTemporaryImage(image)
        }

        guard let imageUrl = sourceUrl,
              let imageData = try? Data(contentsOf: imageUrl) else {
            completeExtensionRequest()
            return
        }

        let encoded = imageData.base64EncodedString()
        let fileName = imageUrl.lastPathComponent

        if let defaults = UserDefaults(suiteName: appGroupId) {
            defaults.set(encoded, forKey: "shared_base64")
            defaults.set(fileName, forKey: "shared_name")
            defaults.set("image/jpeg", forKey: "shared_mime")
            defaults.synchronize()
        }

        DispatchQueue.main.async {
            self.extensionContext?.open(self.targetUrl, completionHandler: { _ in
                self.completeExtensionRequest()
            })
        }
    }

    private func persistTemporaryImage(_ image: UIImage) -> URL? {
        guard let jpeg = image.jpegData(compressionQuality: 0.9) else {
            return nil
        }

        let tempUrl = FileManager.default.temporaryDirectory
            .appendingPathComponent("share_\(UUID().uuidString).jpg")

        do {
            try jpeg.write(to: tempUrl)
            return tempUrl
        } catch {
            return nil
        }
    }

    private func completeExtensionRequest() {
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
