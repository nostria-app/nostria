import Foundation
import StoreKit
import Tauri
import UIKit
import WebKit

struct GetProductsArgs: Decodable {
    let productIds: [String]
}

struct PurchaseArgs: Decodable {
    let productId: String
}

enum StoreKitPluginError: LocalizedError {
    case unsupportedOS
    case productNotFound(String)
    case unverified

    var errorDescription: String? {
        switch self {
        case .unsupportedOS:
            return "In-app purchases require iOS 15 or later"
        case .productNotFound(let productId):
            return "Product not found in App Store: \(productId)"
        case .unverified:
            return "Transaction failed App Store verification"
        }
    }
}

class StoreKitPlugin: Plugin {
    private var updatesTask: Task<Void, Never>?

    /// Finishes renewals and interrupted purchases so StoreKit stays in sync.
    @objc public override func load(webview: WKWebView) {
        guard #available(iOS 15.0, *) else { return }

        updatesTask = Task.detached {
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

    @objc public func initialize(_ invoke: Invoke) throws {
        guard #available(iOS 15.0, *) else {
            invoke.reject(StoreKitPluginError.unsupportedOS.localizedDescription)
            return
        }

        Task {
            let storefront = await Storefront.current?.countryCode ?? ""
            invoke.resolve([
                "available": true,
                "storefront": storefront,
            ])
        }
    }

    @objc public func getProducts(_ invoke: Invoke) throws {
        guard #available(iOS 15.0, *) else {
            invoke.reject(StoreKitPluginError.unsupportedOS.localizedDescription)
            return
        }

        let args = try invoke.parseArgs(GetProductsArgs.self)

        Task {
            do {
                let products = try await Product.products(for: Set(args.productIds))
                let details: [[String: Any]] = products.map { product in
                    [
                        "productId": product.id,
                        "displayName": product.displayName,
                        "description": product.description,
                        "displayPrice": product.displayPrice,
                        "price": NSDecimalNumber(decimal: product.price).stringValue,
                    ]
                }
                invoke.resolve(["success": true, "products": details])
            } catch {
                invoke.resolve(["success": false, "error": error.localizedDescription])
            }
        }
    }

    @objc public func purchase(_ invoke: Invoke) throws {
        guard #available(iOS 15.0, *) else {
            invoke.reject(StoreKitPluginError.unsupportedOS.localizedDescription)
            return
        }

        let args = try invoke.parseArgs(PurchaseArgs.self)

        Task {
            do {
                let products = try await Product.products(for: [args.productId])
                guard let product = products.first else {
                    throw StoreKitPluginError.productNotFound(args.productId)
                }

                let result = try await product.purchase()

                switch result {
                case .success(let verification):
                    let transaction = try Self.checkVerified(verification)
                    let jws = verification.jwsRepresentation
                    await transaction.finish()

                    invoke.resolve([
                        "success": true,
                        "transactionId": String(transaction.id),
                        "originalTransactionId": String(transaction.originalID),
                        "productId": transaction.productID,
                        // Preferred verification payload for the App Store Server API
                        "jwsRepresentation": jws,
                    ])

                case .userCancelled:
                    invoke.resolve([
                        "success": false,
                        "productId": args.productId,
                        "error": "Purchase cancelled by user",
                    ])

                case .pending:
                    invoke.resolve([
                        "success": false,
                        "productId": args.productId,
                        "error": "Purchase is pending approval (Ask to Buy or similar)",
                    ])

                @unknown default:
                    invoke.resolve([
                        "success": false,
                        "productId": args.productId,
                        "error": "Unknown purchase result",
                    ])
                }
            } catch {
                invoke.resolve([
                    "success": false,
                    "productId": args.productId,
                    "error": error.localizedDescription,
                ])
            }
        }
    }

    @objc public func restore(_ invoke: Invoke) throws {
        guard #available(iOS 15.0, *) else {
            invoke.reject(StoreKitPluginError.unsupportedOS.localizedDescription)
            return
        }

        Task {
            do {
                try await AppStore.sync()

                var restored: [[String: Any]] = []
                for await result in Transaction.currentEntitlements {
                    if let transaction = try? Self.checkVerified(result) {
                        restored.append([
                            "transactionId": String(transaction.id),
                            "originalTransactionId": String(transaction.originalID),
                            "productId": transaction.productID,
                            "jwsRepresentation": result.jwsRepresentation,
                        ])
                    }
                }

                invoke.resolve(["success": true, "purchases": restored])
            } catch {
                invoke.resolve(["success": false, "error": error.localizedDescription])
            }
        }
    }

    @available(iOS 15.0, *)
    private static func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified:
            throw StoreKitPluginError.unverified
        case .verified(let safe):
            return safe
        }
    }
}

@_cdecl("init_plugin_storekit")
func initPlugin() -> Plugin {
    return StoreKitPlugin()
}
