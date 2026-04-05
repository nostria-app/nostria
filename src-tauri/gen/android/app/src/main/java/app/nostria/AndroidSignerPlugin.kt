package app.nostria

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.annotation.Keep
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONObject

@Keep
@InvokeArg
class AndroidSignerPermission {
  lateinit var type: String
  var kind: Int? = null
}

@Keep
@InvokeArg
class GetPublicKeyArgs {
  var permissions: List<AndroidSignerPermission>? = null
}

@Keep
@InvokeArg
class AndroidSignerCommandArgs {
  lateinit var content: String
  lateinit var currentUser: String
  lateinit var signerPackage: String
  var pubkey: String? = null
  var id: String? = null
}

@Keep
data class AndroidSignerResponse(
  val result: String,
  val packageName: String? = null,
  val id: String? = null,
  val event: String? = null,
)

@Keep
data class AndroidSignerPublicKeyResponse(
  val pubkey: String,
  val packageName: String,
)

private class SignerRejectedException(message: String) : Exception(message)

@TauriPlugin
class AndroidSignerPlugin(private val activity: Activity) : Plugin(activity) {
  private val pendingPublicKeyPackages = mutableMapOf<Long, String?>()

  @Command
  fun isAvailable(invoke: Invoke) {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:"))
    val infos = activity.packageManager.queryIntentActivities(intent, 0)
    invoke.resolveObject(infos.isNotEmpty())
  }

  @Command
  fun getPublicKey(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(GetPublicKeyArgs::class.java)
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:"))
      intent.putExtra("type", "get_public_key")
      pendingPublicKeyPackages[invoke.id] = activity.packageManager.resolveActivity(intent, 0)?.activityInfo?.packageName

      args.permissions
        ?.takeIf { it.isNotEmpty() }
        ?.let { permissions ->
          intent.putExtra("permissions", permissionsToJson(permissions))
        }

      startActivityForResult(invoke, intent, "handleGetPublicKeyResult")
    } catch (error: ActivityNotFoundException) {
      invoke.reject("No NIP-55 signer app is installed.")
    } catch (error: Exception) {
      invoke.reject(error.message ?: "Failed to request public key from Android signer.")
    }
  }

  @ActivityCallback
  fun handleGetPublicKeyResult(invoke: Invoke, activityResult: ActivityResult) {
    val fallbackPackage = pendingPublicKeyPackages.remove(invoke.id)

    if (activityResult.resultCode != Activity.RESULT_OK) {
      invoke.reject("Android signer request was rejected.")
      return
    }

    val data = activityResult.data
    if (data == null) {
      if (!fallbackPackage.isNullOrBlank()) {
        invoke.reject("Android signer did not return any data. Try opening the signer once and approving the connection manually.")
      } else {
        invoke.reject("Android signer did not return any data.")
      }
      return
    }

    val response = parseIntentResponse(data)
    val packageName = response?.packageName ?: fallbackPackage
    if (response == null || packageName.isNullOrBlank()) {
      invoke.reject("Android signer did not return a public key.")
      return
    }

    invoke.resolveObject(
      AndroidSignerPublicKeyResponse(
        pubkey = response.result,
        packageName = packageName,
      )
    )
  }

  @Command
  fun signEvent(invoke: Invoke) {
    executeSignerCommand(invoke, "sign_event", "SIGN_EVENT")
  }

  @Command
  fun nip04Encrypt(invoke: Invoke) {
    executeSignerCommand(invoke, "nip04_encrypt", "NIP04_ENCRYPT")
  }

  @Command
  fun nip04Decrypt(invoke: Invoke) {
    executeSignerCommand(invoke, "nip04_decrypt", "NIP04_DECRYPT")
  }

  @Command
  fun nip44Encrypt(invoke: Invoke) {
    executeSignerCommand(invoke, "nip44_encrypt", "NIP44_ENCRYPT")
  }

  @Command
  fun nip44Decrypt(invoke: Invoke) {
    executeSignerCommand(invoke, "nip44_decrypt", "NIP44_DECRYPT")
  }

  private fun executeSignerCommand(invoke: Invoke, intentType: String, resolverMethod: String) {
    try {
      val args = invoke.parseArgs(AndroidSignerCommandArgs::class.java)
      val contentResolverResponse = tryContentResolver(resolverMethod, args)
      if (contentResolverResponse != null) {
        invoke.resolveObject(contentResolverResponse)
        return
      }

      val intent = buildCommandIntent(intentType, args)
      startActivityForResult(invoke, intent, "handleSignerCommandResult")
    } catch (error: SignerRejectedException) {
      invoke.reject(error.message ?: "Android signer rejected the request.")
    } catch (error: ActivityNotFoundException) {
      invoke.reject("No NIP-55 signer app is installed.")
    } catch (error: Exception) {
      invoke.reject(error.message ?: "Android signer command failed.")
    }
  }

  @ActivityCallback
  fun handleSignerCommandResult(invoke: Invoke, activityResult: ActivityResult) {
    if (activityResult.resultCode != Activity.RESULT_OK) {
      invoke.reject("Android signer request was rejected.")
      return
    }

    val data = activityResult.data
    if (data == null) {
      invoke.reject("Android signer did not return any data.")
      return
    }

    val response = parseIntentResponse(data)
    if (response == null) {
      invoke.reject("Android signer did not return a usable result.")
      return
    }

    invoke.resolveObject(response)
  }

  private fun tryContentResolver(
    resolverMethod: String,
    args: AndroidSignerCommandArgs,
  ): AndroidSignerResponse? {
    val uri = Uri.parse("content://${args.signerPackage}.$resolverMethod")
    val projection = when (resolverMethod) {
      "SIGN_EVENT" -> arrayOf(args.content, "", args.currentUser)
      else -> arrayOf(args.content, args.pubkey.orEmpty(), args.currentUser)
    }

    val cursor = try {
      activity.contentResolver.query(uri, projection, null, null, null)
    } catch (_: Exception) {
      null
    }

    cursor?.use {
      if (it.getColumnIndex("rejected") >= 0) {
        throw SignerRejectedException("Android signer rejected the request.")
      }

      if (!it.moveToFirst()) {
        return null
      }

      val resultIndex = it.getColumnIndex("result")
      if (resultIndex < 0) {
        return null
      }

      return AndroidSignerResponse(
        result = it.getString(resultIndex),
        id = args.id,
        event = it.getColumnIndex("event")
          .takeIf { columnIndex -> columnIndex >= 0 }
          ?.let { columnIndex -> it.getString(columnIndex) },
      )
    }

    return null
  }

  private fun buildCommandIntent(type: String, args: AndroidSignerCommandArgs): Intent {
    val payload = Uri.encode(args.content)
    return Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:$payload")).apply {
      `package` = args.signerPackage
      putExtra("type", type)
      putExtra("current_user", args.currentUser)
      args.id?.let { putExtra("id", it) }
      args.pubkey?.let { putExtra("pubkey", it) }
      addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
  }

  private fun parseIntentResponse(data: Intent): AndroidSignerResponse? {
    parseResultsArray(data.extras)?.let { return it }

    val result = data.getStringExtra("result") ?: return null
    return AndroidSignerResponse(
      result = result,
      packageName = data.getStringExtra("package") ?: data.getStringExtra("packageName"),
      id = data.getStringExtra("id"),
      event = data.getStringExtra("event"),
    )
  }

  private fun parseResultsArray(extras: Bundle?): AndroidSignerResponse? {
    val resultsJson = extras?.getString("results") ?: return null
    val results = JSONArray(resultsJson)
    if (results.length() == 0) {
      return null
    }

    val first = results.optJSONObject(0) ?: return null
    return AndroidSignerResponse(
      result = first.optString("result"),
      packageName = first.optString("package").ifBlank {
        first.optString("packageName").ifBlank { null }
      },
      id = first.optString("id").ifBlank { null },
      event = first.optString("event").ifBlank { null },
    )
  }

  private fun permissionsToJson(permissions: List<AndroidSignerPermission>): String {
    val array = JSONArray()
    permissions.forEach { permission ->
      array.put(
        JSONObject().apply {
          put("type", permission.type)
          permission.kind?.let { kind -> put("kind", kind) }
        }
      )
    }
    return array.toString()
  }
}