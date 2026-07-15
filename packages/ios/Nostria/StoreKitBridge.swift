import Foundation
import StoreKit
import WebKit

/// Bridges Angular `InAppPurchaseService` to StoreKit 2 via WKWebView message handlers.
///
/// JS → native: `window.webkit.messageHandlers.nostriaStoreKit.postMessage({ action, productId })`
/// native → JS: `window.nostriaStoreKitCallback({ success, transactionId, ... })`
@available(iOS 15.0, *)
final class StoreKitBridge {
    static let shared = StoreKitBridge()
    static let messageHandlerName = "nostriaStoreKit"

    private var updatesTask: Task<Void, Never>?

    private init() {
        // Finish any unfinished transactions (including renewals) so StoreKit stays in sync.
        updatesTask = Task {
            for await update in Transaction.updates {
                if let transaction = try? Self.checkVerified(update) {
                    await transaction.finish()
                }
            }
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    func handle(message: WKScriptMessage, webView: WKWebView) {
        guard let body = message.body as? [String: Any] else {
            postCallback(webView: webView, payload: [
                "success": false,
                "error": "Invalid StoreKit message payload"
            ])
            return
        }

        let action = (body["action"] as? String)?.lowercased() ?? "purchase"
        let productId = body["productId"] as? String

        switch action {
        case "purchase":
            guard let productId, !productId.isEmpty else {
                postCallback(webView: webView, payload: [
                    "success": false,
                    "error": "Missing productId"
                ])
                return
            }
            Task { await purchase(productId: productId, webView: webView) }

        case "restore":
            Task { await restore(webView: webView) }

        case "getproducts":
            let ids = body["productIds"] as? [String] ?? []
            Task { await getProducts(productIds: ids, webView: webView) }

        default:
            postCallback(webView: webView, payload: [
                "success": false,
                "error": "Unknown StoreKit action: \(action)"
            ])
        }
    }

    // MARK: - StoreKit actions

    private func purchase(productId: String, webView: WKWebView) async {
        do {
            let products = try await Product.products(for: [productId])
            guard let product = products.first else {
                postCallback(webView: webView, payload: [
                    "success": false,
                    "productId": productId,
                    "error": "Product not found in App Store: \(productId)"
                ])
                return
            }

            let result = try await product.purchase()

            switch result {
            case .success(let verification):
                let transaction = try Self.checkVerified(verification)
                let jws = verification.jwsRepresentation

                await transaction.finish()

                postCallback(webView: webView, payload: [
                    "success": true,
                    "transactionId": String(transaction.id),
                    "originalTransactionId": String(transaction.originalID),
                    "productId": transaction.productID,
                    // Preferred verification payload for App Store Server API / backend
                    "jwsRepresentation": jws
                ])

            case .userCancelled:
                postCallback(webView: webView, payload: [
                    "success": false,
                    "productId": productId,
                    "error": "Purchase cancelled by user"
                ])

            case .pending:
                postCallback(webView: webView, payload: [
                    "success": false,
                    "productId": productId,
                    "error": "Purchase is pending approval (Ask to Buy or similar)"
                ])

            @unknown default:
                postCallback(webView: webView, payload: [
                    "success": false,
                    "productId": productId,
                    "error": "Unknown purchase result"
                ])
            }
        } catch {
            postCallback(webView: webView, payload: [
                "success": false,
                "productId": productId,
                "error": error.localizedDescription
            ])
        }
    }

    private func restore(webView: WKWebView) async {
        do {
            try await AppStore.sync()

            var restored: [[String: Any]] = []
            for await result in Transaction.currentEntitlements {
                if let transaction = try? Self.checkVerified(result) {
                    restored.append([
                        "transactionId": String(transaction.id),
                        "originalTransactionId": String(transaction.originalID),
                        "productId": transaction.productID
                    ])
                }
            }

            postCallback(webView: webView, payload: [
                "success": true,
                "action": "restore",
                "purchases": restored
            ])
        } catch {
            postCallback(webView: webView, payload: [
                "success": false,
                "action": "restore",
                "error": error.localizedDescription
            ])
        }
    }

    private func getProducts(productIds: [String], webView: WKWebView) async {
        do {
            let products = try await Product.products(for: Set(productIds))
            let details: [[String: Any]] = products.map { product in
                [
                    "productId": product.id,
                    "displayName": product.displayName,
                    "description": product.description,
                    "displayPrice": product.displayPrice,
                    "price": NSDecimalNumber(decimal: product.price).stringValue
                ]
            }

            postCallback(webView: webView, payload: [
                "success": true,
                "action": "getProducts",
                "products": details
            ])
        } catch {
            postCallback(webView: webView, payload: [
                "success": false,
                "action": "getProducts",
                "error": error.localizedDescription
            ])
        }
    }

    // MARK: - Helpers

    private static func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified(_, let error):
            throw error
        case .verified(let safe):
            return safe
        }
    }

    private func postCallback(webView: WKWebView, payload: [String: Any]) {
        guard
            let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
            let json = String(data: data, encoding: .utf8)
        else {
            return
        }

        let script = """
        (function() {
          if (typeof window.nostriaStoreKitCallback === 'function') {
            window.nostriaStoreKitCallback(\(json));
          } else {
            console.warn('[Nostria StoreKit] nostriaStoreKitCallback is not defined', \(json));
          }
        })();
        """

        DispatchQueue.main.async {
            webView.evaluateJavaScript(script, completionHandler: nil)
        }
    }
}
