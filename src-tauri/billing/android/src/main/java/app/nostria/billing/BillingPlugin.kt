package app.nostria.billing

import android.app.Activity
import android.util.Log
import androidx.annotation.Keep
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import org.json.JSONArray

@Keep
@InvokeArg
class GetProductsArgs {
    var productIds: List<String> = emptyList()
}

@Keep
@InvokeArg
class PurchaseArgs {
    var productId: String = ""
}

@Keep
@InvokeArg
class AcknowledgeArgs {
    var purchaseToken: String = ""
}

@TauriPlugin
class BillingPlugin(private val activity: Activity) : Plugin(activity) {
    private var billingClient: BillingClient? = null
    private var pendingPurchase: Invoke? = null
    private var pendingProductId: String? = null

    private val purchasesUpdatedListener = PurchasesUpdatedListener { result, purchases ->
        val invoke = pendingPurchase ?: return@PurchasesUpdatedListener
        pendingPurchase = null
        val productId = pendingProductId
        pendingProductId = null

        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> {
                val purchase = purchases?.firstOrNull { productId == null || it.products.contains(productId) }
                    ?: purchases?.firstOrNull()

                if (purchase == null) {
                    invoke.resolve(failure("No purchase returned by Google Play", productId))
                } else {
                    invoke.resolve(purchaseResult(purchase))
                }
            }

            BillingClient.BillingResponseCode.USER_CANCELED ->
                invoke.resolve(failure("Purchase cancelled by user", productId))

            else -> invoke.resolve(failure(describe(result), productId))
        }
    }

    @Command
    fun initialize(invoke: Invoke) {
        withClient(invoke) {
            val response = JSObject()
            response.put("success", true)
            response.put("available", true)
            invoke.resolve(response)
        }
    }

    @Command
    fun getProducts(invoke: Invoke) {
        val args = invoke.parseArgs(GetProductsArgs::class.java)
        if (args.productIds.isEmpty()) {
            invoke.resolve(failure("No product IDs requested", null))
            return
        }

        withClient(invoke) { client ->
            // Subscriptions and one-time products live in separate Play catalogs.
            queryProducts(client, args.productIds, BillingClient.ProductType.SUBS) { subs ->
                queryProducts(client, args.productIds, BillingClient.ProductType.INAPP) { inapp ->
                    val products = JSONArray()
                    (subs + inapp).forEach { products.put(productJson(it)) }

                    val response = JSObject()
                    response.put("success", true)
                    response.put("products", products)
                    invoke.resolve(response)
                }
            }
        }
    }

    @Command
    fun purchase(invoke: Invoke) {
        val args = invoke.parseArgs(PurchaseArgs::class.java)
        if (args.productId.isEmpty()) {
            invoke.resolve(failure("A product ID is required", null))
            return
        }

        withClient(invoke) { client ->
            queryProducts(client, listOf(args.productId), BillingClient.ProductType.SUBS) { subs ->
                if (subs.isNotEmpty()) {
                    launchPurchase(client, invoke, subs.first())
                    return@queryProducts
                }

                queryProducts(client, listOf(args.productId), BillingClient.ProductType.INAPP) { inapp ->
                    val product = inapp.firstOrNull()
                    if (product == null) {
                        invoke.resolve(failure("Product not found in Google Play: ${args.productId}", args.productId))
                    } else {
                        launchPurchase(client, invoke, product)
                    }
                }
            }
        }
    }

    @Command
    fun restore(invoke: Invoke) {
        withClient(invoke) { client ->
            queryPurchases(client, BillingClient.ProductType.SUBS) { subs ->
                queryPurchases(client, BillingClient.ProductType.INAPP) { inapp ->
                    val purchases = JSONArray()
                    (subs + inapp).forEach { purchases.put(purchaseResult(it)) }

                    val response = JSObject()
                    response.put("success", true)
                    response.put("purchases", purchases)
                    invoke.resolve(response)
                }
            }
        }
    }

    @Command
    fun acknowledge(invoke: Invoke) {
        val args = invoke.parseArgs(AcknowledgeArgs::class.java)
        if (args.purchaseToken.isEmpty()) {
            invoke.resolve(failure("A purchase token is required", null))
            return
        }

        withClient(invoke) { client ->
            val params = AcknowledgePurchaseParams.newBuilder()
                .setPurchaseToken(args.purchaseToken)
                .build()

            client.acknowledgePurchase(params) { result ->
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    val response = JSObject()
                    response.put("success", true)
                    invoke.resolve(response)
                } else {
                    invoke.resolve(failure(describe(result), null))
                }
            }
        }
    }

    private fun launchPurchase(client: BillingClient, invoke: Invoke, product: ProductDetails) {
        val offerToken = product.subscriptionOfferDetails?.firstOrNull()?.offerToken

        val productParams = BillingFlowParams.ProductDetailsParams.newBuilder()
            .setProductDetails(product)
            .apply { offerToken?.let { setOfferToken(it) } }
            .build()

        val flowParams = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(productParams))
            .build()

        pendingPurchase = invoke
        pendingProductId = product.productId

        activity.runOnUiThread {
            val result = client.launchBillingFlow(activity, flowParams)
            if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                pendingPurchase = null
                pendingProductId = null
                invoke.resolve(failure(describe(result), product.productId))
            }
        }
    }

    /** Ensures a connected billing client, rejecting the invoke when Play billing is unavailable. */
    private fun withClient(invoke: Invoke, block: (BillingClient) -> Unit) {
        val existing = billingClient
        if (existing != null && existing.isReady) {
            block(existing)
            return
        }

        val client = existing ?: BillingClient.newBuilder(activity)
            .setListener(purchasesUpdatedListener)
            .enablePendingPurchases(
                PendingPurchasesParams.newBuilder().enableOneTimeProducts().build()
            )
            .build()
        billingClient = client

        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    block(client)
                } else {
                    Log.w(TAG, "Billing setup failed: ${describe(result)}")
                    invoke.resolve(failure(describe(result), null))
                }
            }

            override fun onBillingServiceDisconnected() {
                Log.w(TAG, "Billing service disconnected")
            }
        })
    }

    private fun queryProducts(
        client: BillingClient,
        productIds: List<String>,
        productType: String,
        onResult: (List<ProductDetails>) -> Unit
    ) {
        val products = productIds.map {
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(it)
                .setProductType(productType)
                .build()
        }

        val params = QueryProductDetailsParams.newBuilder().setProductList(products).build()
        client.queryProductDetailsAsync(params) { result, details ->
            if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                Log.w(TAG, "queryProductDetails($productType) failed: ${describe(result)}")
                onResult(emptyList())
            } else {
                onResult(details)
            }
        }
    }

    private fun queryPurchases(
        client: BillingClient,
        productType: String,
        onResult: (List<Purchase>) -> Unit
    ) {
        val params = QueryPurchasesParams.newBuilder().setProductType(productType).build()
        client.queryPurchasesAsync(params) { result, purchases ->
            if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                Log.w(TAG, "queryPurchases($productType) failed: ${describe(result)}")
                onResult(emptyList())
            } else {
                onResult(purchases)
            }
        }
    }

    private fun productJson(product: ProductDetails): JSObject {
        val price = product.subscriptionOfferDetails
            ?.firstOrNull()
            ?.pricingPhases
            ?.pricingPhaseList
            ?.firstOrNull()
            ?.formattedPrice
            ?: product.oneTimePurchaseOfferDetails?.formattedPrice
            ?: ""

        val json = JSObject()
        json.put("productId", product.productId)
        json.put("displayName", product.name)
        json.put("description", product.description)
        json.put("displayPrice", price)
        json.put("price", price)
        return json
    }

    private fun purchaseResult(purchase: Purchase): JSObject {
        val json = JSObject()
        json.put("success", true)
        json.put("productId", purchase.products.firstOrNull() ?: "")
        json.put("purchaseToken", purchase.purchaseToken)
        json.put("orderId", purchase.orderId ?: "")
        json.put("acknowledged", purchase.isAcknowledged)
        json.put("pending", purchase.purchaseState == Purchase.PurchaseState.PENDING)
        return json
    }

    private fun failure(message: String, productId: String?): JSObject {
        val json = JSObject()
        json.put("success", false)
        json.put("error", message)
        productId?.let { json.put("productId", it) }
        return json
    }

    private fun describe(result: BillingResult): String {
        val debug = result.debugMessage
        return if (debug.isNullOrEmpty()) {
            "Google Play billing error ${result.responseCode}"
        } else {
            "Google Play billing error ${result.responseCode}: $debug"
        }
    }

    companion object {
        private const val TAG = "NostriaBilling"
    }
}
