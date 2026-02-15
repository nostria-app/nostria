import UIKit


@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
    
    var window : UIWindow?

    func application(_ application: UIApplication,
                       didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Register for remote notifications. This shows a permission dialog on first run, to
        // show the dialog at a more appropriate time move this registration accordingly.
   
        UNUserNotificationCenter.current().delegate = self

      //  let authOptions: UNAuthorizationOptions = [.alert, .badge, .sound]
      //  UNUserNotificationCenter.current().requestAuthorization(
      //      options: authOptions,
      //      completionHandler: {_, _ in })

  application.registerForRemoteNotifications()
        return true
      }

      func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any]) {
        print("push userInfo 1:", userInfo)
        sendPushToWebView(userInfo: userInfo)
      }

      func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any],
                       fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        print("push userInfo 2:", userInfo)
        sendPushToWebView(userInfo: userInfo)

        completionHandler(UIBackgroundFetchResult.newData)
      }

      // [END receive_message]
      func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("Unable to register for remote notifications: \(error.localizedDescription)")
      }

      func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        print("APNs token retrieved: \(deviceToken)")

        let tokenParts = deviceToken.map { data in String(format: "%02.2hhx", data) }
        apnsDeviceToken = tokenParts.joined()
        handlePushToken()
      }
    }

    extension AppDelegate : UNUserNotificationCenterDelegate {

      func userNotificationCenter(_ center: UNUserNotificationCenter,
                                  willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let userInfo = notification.request.content.userInfo
        print("push userInfo 3:", userInfo)
        sendPushToWebView(userInfo: userInfo)

        // Change this to your preferred presentation option
        completionHandler([[.banner, .list, .sound]])
      }

      func userNotificationCenter(_ center: UNUserNotificationCenter,
                                  didReceive response: UNNotificationResponse,
                                  withCompletionHandler completionHandler: @escaping () -> Void) {
        let userInfo = response.notification.request.content.userInfo
        print("push userInfo 4:", userInfo)
        sendPushClickToWebView(userInfo: userInfo)

        completionHandler()
      }
    }
