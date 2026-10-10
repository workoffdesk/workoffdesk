import Foundation

public enum Lang: Equatable {
  case en, zh

  // The Mac's first language, as the server's own messages pick theirs.
  public static func of(_ preferred: [String]) -> Lang {
    preferred.first?.hasPrefix("zh") == true ? .zh : .en
  }

  public static var current: Lang { of(Locale.preferredLanguages) }
}

public struct Words {
  // For dates and times said in the same language.
  public let locale: Locale
  public let running: String
  public let stopped: String
  public let problems: (Int) -> String
  public let allGood: String
  public let notInstalled: String
  public let installHint: String
  public let couldNotRead: String
  public let start: String
  public let stop: String
  public let restart: String
  public let working: String
  public let openBrowser: String
  public let openLogs: String
  public let openAtLogin: String
  public let showCode: String
  public let hideCode: String
  public let scanCode: String
  public let recentErrors: String
  public let clickToCopy: String
  public let copied: String
  public let refresh: String
  public let quit: String
  public let claudeAccount: String
  public let accountSignedOut: String
  public let accountNotReady: String
  public let accountApart: String
  public let moveSessions: (Int) -> String
  public let movingSessions: (Int) -> String
  public let checkNames: [String: String]

  public static let en = Words(
    locale: Locale(identifier: "en_US"),
    running: "Running",
    stopped: "Stopped",
    problems: { $0 == 1 ? "1 problem" : "\($0) problems" },
    allGood: "Everything works",
    notInstalled: "WorkOffDesk is not installed",
    installHint: "Install it in Terminal:",
    couldNotRead: "Could not read the service's state",
    start: "Start",
    stop: "Stop",
    restart: "Restart",
    working: "Working…",
    openBrowser: "Open in Browser",
    openLogs: "Open Logs Folder",
    openAtLogin: "Open at Login",
    showCode: "Show Code for the Phone",
    hideCode: "Hide the Code",
    scanCode: "Point the phone's camera at it",
    recentErrors: "Recent errors",
    clickToCopy: "Click to copy",
    copied: "Copied",
    refresh: "Refresh",
    quit: "Quit",
    claudeAccount: "Claude Account",
    accountSignedOut: "Signed out",
    accountNotReady: "Open Claude Code with it in a terminal once first",
    accountApart: "Its conversations are kept apart from this Mac’s",
    moveSessions: { $0 == 1 ? "Move 1 Open Session to This Account" : "Move \($0) Open Sessions to This Account" },
    movingSessions: { $0 == 1 ? "1 session moves once its reply is done" : "\($0) sessions move once their reply is done" },
    checkNames: [
      "macos": "macOS", "node": "Node.js", "tmux": "tmux", "claude": "Claude Code", "codex": "Codex", "setup": "Account",
      "service": "Service", "origin": "Address", "sleep": "Staying awake", "apns": "iPhone notifications",
    ]
  )

  public static let zh = Words(
    locale: Locale(identifier: "zh_CN"),
    running: "运行中",
    stopped: "已停止",
    problems: { "\($0) 个问题" },
    allGood: "一切正常",
    notInstalled: "还没有安装 WorkOffDesk",
    installHint: "在终端里安装：",
    couldNotRead: "读不到服务的状态",
    start: "启动",
    stop: "停止",
    restart: "重启",
    working: "正在处理…",
    openBrowser: "在浏览器中打开",
    openLogs: "打开日志文件夹",
    openAtLogin: "登录时打开",
    showCode: "显示给手机扫的码",
    hideCode: "收起二维码",
    scanCode: "用手机相机对准它",
    recentErrors: "最近的错误",
    clickToCopy: "点一下复制",
    copied: "已复制",
    refresh: "刷新",
    quit: "退出",
    claudeAccount: "Claude 账号",
    accountSignedOut: "已退出登录",
    accountNotReady: "先在终端里用它打开一次 Claude Code",
    accountApart: "它的对话没有和这台 Mac 的共用",
    moveSessions: { "把 \($0) 个开着的会话搬到这个账号" },
    movingSessions: { "\($0) 个会话等这轮回复完就搬过来" },
    checkNames: [
      "macos": "macOS", "node": "Node.js", "tmux": "tmux", "claude": "Claude Code", "codex": "Codex", "setup": "账号",
      "service": "服务", "origin": "地址", "sleep": "防休眠", "apns": "iPhone 通知",
    ]
  )

  public static var current: Words { Lang.current == .zh ? zh : en }
}
