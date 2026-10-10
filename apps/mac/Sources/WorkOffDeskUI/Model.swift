import AppKit
import ServiceManagement
import SwiftUI
import WorkOffDeskKit

// The service's state as the CLI last told it, asked again when the menu opens and every minute.
@MainActor
public final class Model: ObservableObject {
  @Published public private(set) var status: Status?
  // The Claude accounts, read while the service runs.
  @Published private(set) var accounts: Accounts?
  @Published private(set) var error: String?
  // The start, stop or restart under way.
  @Published private(set) var working = false
  @Published private(set) var openAtLogin = SMAppService.mainApp.status == .enabled

  let words: Words
  private let find: () -> CLI?
  private var cli: CLI?
  private var timer: Timer?

  // find: where the CLI is, asked again until it is there (it may be installed while the app runs).
  public init(find: @escaping () -> CLI? = { CLI.find() }, words: Words = .current) {
    self.find = find
    self.words = words
    cli = find()
  }

  // Asked now and every minute after.
  public func watch() {
    timer?.invalidate()
    timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
      Task { await self?.refresh() }
    }
    Task { await refresh() }
  }

  var installed: Bool { cli != nil }

  public var symbol: String {
    guard installed, let status else { return "questionmark.circle" }
    switch status.health {
    case .ok: return "apple.terminal"
    case .problems: return "exclamationmark.triangle"
    case .stopped: return "stop.circle"
    }
  }

  public func refresh() async {
    cli = cli ?? find()
    guard let cli else { return }
    do {
      let status = try await cli.status()
      self.status = status
      error = nil
      accounts = status.running ? try? await cli.accounts() : nil
    } catch {
      self.error = error.localizedDescription.isEmpty ? words.couldNotRead : error.localizedDescription
    }
  }

  // start, stop or restart, each waiting until the service answers or says why not.
  func perform(_ command: String) async {
    guard let cli, !working else { return }
    working = true
    let r = await cli.run([command])
    await refresh()
    if r.code != 0 { error = [r.err, r.out].first { !$0.isEmpty }?.trimmingCharacters(in: .whitespacesAndNewlines) }
    working = false
  }

  // New sessions start on it.
  func pick(_ account: ClaudeAccount) async { await act { try await $0.pick(account) } }

  // The open sessions on another account move to the one in use, each once its reply is done.
  func moveSessions() async { await act { try await $0.moveSessions() } }

  // Done through the CLI, then the accounts read again; what went wrong is said.
  private func act(_ f: (CLI) async throws -> Void) async {
    guard let cli, !working else { return }
    working = true
    var failure: String?
    do { try await f(cli) } catch { failure = error.localizedDescription }
    accounts = try? await cli.accounts()
    error = failure
    working = false
  }

  func toggleOpenAtLogin() {
    do {
      if openAtLogin { try SMAppService.mainApp.unregister() } else { try SMAppService.mainApp.register() }
    } catch {
      self.error = error.localizedDescription
    }
    openAtLogin = SMAppService.mainApp.status == .enabled
  }

  func openBrowser() {
    if let origin = status?.origin, let url = URL(string: origin) { NSWorkspace.shared.open(url) }
  }

  func openLogs() {
    let home = status?.home ?? "\(NSHomeDirectory())/.workoffdesk"
    NSWorkspace.shared.open(URL(fileURLWithPath: "\(home)/logs", isDirectory: true))
  }
}
