import CryptoKit
import Foundation
import Security
import UserNotifications

// A published build's notifications come through a relay that cannot read them: what they say is sealed by
// the Mac with a key this phone made (src/notifications.ts), AES-256-GCM as nonce, ciphertext and tag. Opened
// here, they say it; a notification that cannot be opened says the words it was sent with.
class NotificationService: UNNotificationServiceExtension {
  private var deliver: ((UNNotificationContent) -> Void)?
  private var shown: UNNotificationContent?

  override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
    deliver = contentHandler
    shown = request.content
    guard let content = request.content.mutableCopy() as? UNMutableNotificationContent,
          let sealed = content.userInfo["sealed"] as? String,
          let said = Self.open(sealed) else {
      return contentHandler(request.content)
    }
    if let alert = said["alert"] as? [String: Any] {
      content.title = alert["title"] as? String ?? ""
      content.subtitle = alert["subtitle"] as? String ?? ""
      content.body = alert["body"] as? String ?? content.body
    }
    var info = content.userInfo
    info.removeValue(forKey: "sealed")
    if let sessionId = said["sessionId"] as? String { info["body"] = ["sessionId": sessionId] }
    content.userInfo = info
    contentHandler(content)
  }

  override func serviceExtensionTimeWillExpire() {
    if let deliver, let shown { deliver(shown) }
  }

  static func open(_ sealed: String) -> [String: Any]? {
    guard let key = keyData(),
          let data = Data(base64Encoded: sealed),
          let box = try? AES.GCM.SealedBox(combined: data),
          let plain = try? AES.GCM.open(box, using: SymmetricKey(data: key)) else { return nil }
    return (try? JSONSerialization.jsonObject(with: plain)) as? [String: Any]
  }

  // Where expo-secure-store keeps it: service "push" (":no-auth" as it needs no Face ID), account "key".
  private static func keyData() -> Data? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "WorkOffDeskKeychainGroup") as? String else { return nil }
    let account = Data("key".utf8)
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "push:no-auth",
      kSecAttrGeneric as String: account,
      kSecAttrAccount as String: account,
      kSecAttrAccessGroup as String: group,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
          let stored = item as? Data,
          let text = String(data: stored, encoding: .utf8) else { return nil }
    return Data(base64Encoded: text)
  }
}
