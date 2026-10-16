import AppKit
import SwiftUI
import WorkOffDeskKit

public struct MenuView: View {
  @ObservedObject var model: Model
  @State private var showCode: Bool

  public init(model: Model, showCode: Bool = false) {
    self.model = model
    _showCode = State(initialValue: showCode)
  }
  private var w: Words { model.words }

  public var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if !model.installed {
        NotInstalled(words: w)
      } else if let status = model.status {
        Header(status: status, words: w)
        if let error = model.error { Text(error).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
        if !status.failed.isEmpty {
          ForEach(status.failed) { CheckView(check: $0, words: w) }
        }
        let errors = status.errors(at: Date())
        if !errors.isEmpty { Errors(problems: Array(errors.prefix(3)), words: w) }
        if let origin = status.origin, showCode, let image = qrImage(origin, side: 180) {
          VStack(spacing: 6) {
            Image(nsImage: image).interpolation(.none).padding(10).background(.white, in: RoundedRectangle(cornerRadius: 10))
            Text(w.scanCode).font(.caption).foregroundStyle(.secondary)
          }
          .frame(maxWidth: .infinity)
        }
        Divider()
        Controls(model: model, running: status.running)
        if status.running, let accounts = model.accounts, accounts.accounts.count >= 2 {
          Divider()
          AccountsSection(model: model, accounts: accounts)
        }
        Divider()
        if status.origin != nil {
          MenuRow(title: w.openBrowser) { model.openBrowser() }
          if status.origin?.hasPrefix("https://") == true {
            MenuRow(title: showCode ? w.hideCode : w.showCode) { showCode.toggle() }
          }
        }
        MenuRow(title: w.openLogs) { model.openLogs() }
      } else if let error = model.error {
        Text(w.couldNotRead).font(.headline)
        Text(error).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
      } else {
        ProgressView().frame(maxWidth: .infinity)
      }
      Divider()
      SwitchRow(title: w.openAtLogin, on: model.openAtLogin) { model.toggleOpenAtLogin() }
      MenuRow(title: w.refresh) { Task { await model.refresh() } }
      MenuRow(title: w.quit) { NSApplication.shared.terminate(nil) }
    }
    .padding(12)
    .frame(width: 320)
    .task { await model.refresh() }
  }
}

private struct Header: View {
  let status: Status
  let words: Words

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Circle().fill(color).frame(width: 9, height: 9)
      Text(title).font(.headline)
      Spacer()
      Text(status.version).font(.caption).foregroundStyle(.secondary)
    }
    if let origin = status.origin {
      Text(origin).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
    }
  }

  private var title: String {
    switch status.health {
    case .ok: return words.allGood
    case .problems(let n): return words.problems(n)
    case .stopped: return words.stopped
    }
  }

  private var color: Color {
    switch status.health {
    case .ok: return .green
    case .problems: return .orange
    case .stopped: return .secondary
    }
  }
}

private struct CheckView: View {
  let check: Check
  let words: Words
  @State private var copied = false

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      HStack(spacing: 6) {
        Circle().fill(.red).frame(width: 7, height: 7)
        Text(words.checkNames[check.id] ?? check.id).font(.callout.weight(.semibold))
      }
      Text(check.detail).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
      if let fix = check.fix {
        Button {
          NSPasteboard.general.clearContents()
          NSPasteboard.general.setString(fix, forType: .string)
          copied = true
          DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copied = false }
        } label: {
          VStack(alignment: .leading, spacing: 2) {
            Text(fix).font(.system(.caption, design: .monospaced)).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
            Text(copied ? words.copied : words.clickToCopy).font(.caption2).foregroundStyle(.secondary)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(7)
          .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
      }
    }
  }
}

private struct Errors: View {
  let problems: [Problem]
  let words: Words

  private func ago(_ date: Date) -> String {
    let f = RelativeDateTimeFormatter()
    f.locale = words.locale
    return f.localizedString(for: date, relativeTo: Date())
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(words.recentErrors).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
      ForEach(Array(problems.enumerated()), id: \.offset) { _, p in
        HStack(alignment: .firstTextBaseline) {
          Text(p.msg.isEmpty ? "—" : p.msg).font(.caption).lineLimit(2)
          Spacer()
          if let date = p.date { Text(ago(date)).font(.caption2).foregroundStyle(.secondary) }
        }
      }
    }
  }
}

private struct Controls: View {
  @ObservedObject var model: Model
  let running: Bool

  var body: some View {
    HStack(spacing: 8) {
      if model.working {
        ProgressView().controlSize(.small)
        Text(model.words.working).font(.callout).foregroundStyle(.secondary)
      } else if running {
        Button(model.words.restart) { Task { await model.perform("restart") } }
        Button(model.words.stop) { Task { await model.perform("stop") } }
      } else {
        Button(model.words.start) { Task { await model.perform("start") } }.keyboardShortcut(.defaultAction)
      }
      Spacer()
    }
  }
}

// Which account new sessions start on, a click picking another; and the open sessions on another one, to move.
private struct AccountsSection: View {
  @ObservedObject var model: Model
  let accounts: Accounts
  private var w: Words { model.words }

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(w.claudeAccount).font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(.bottom, 2)
      ForEach(accounts.accounts) { a in
        let bar = a.bar(w)
        let inUse = a.id == accounts.inUse
        MenuRow(title: a.email, checked: inUse, note: bar, disabled: bar != nil || model.working) {
          if !inUse { Task { await model.pick(a) } }
        }
      }
      if accounts.moving > 0 {
        Text(w.movingSessions(accounts.moving)).font(.caption).foregroundStyle(.secondary).padding(.top, 2)
      } else if accounts.elsewhere > 0 {
        MenuRow(title: w.moveSessions(accounts.elsewhere), disabled: model.working) { Task { await model.moveSessions() } }
      }
    }
  }
}

private struct NotInstalled: View {
  let words: Words

  var body: some View {
    Text(words.notInstalled).font(.headline)
    Text(words.installHint).font(.callout).foregroundStyle(.secondary)
    Text("curl -fsSL https://raw.githubusercontent.com/workoffdesk/workoffdesk/main/install.sh | sh")
      .font(.system(.caption, design: .monospaced))
      .textSelection(.enabled)
      .fixedSize(horizontal: false, vertical: true)
  }
}

// A row that looks like a menu item: full width, highlighted under the pointer. Its title lines up with the
// header and the buttons above; the highlight reaches past it, as in a Mac menu.
// checked: a mark before it, as on a menu item that is on; note: a line under it; disabled: dimmed, and no highlight.
private struct MenuRow: View {
  let title: String
  var checked: Bool? = nil
  var note: String? = nil
  var disabled = false
  let action: () -> Void
  @State private var hover = false

  var body: some View {
    let lit = hover && !disabled
    Button(action: action) {
      HStack(alignment: .firstTextBaseline, spacing: 4) {
        if let checked { Image(systemName: "checkmark").font(.caption.weight(.semibold)).opacity(checked ? 1 : 0) }
        VStack(alignment: .leading, spacing: 1) {
          Text(title).lineLimit(1).truncationMode(.middle)
          if let note { Text(note).font(.caption).foregroundStyle(lit ? .white : .secondary) }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 4).padding(.horizontal, 6)
      .background(lit ? Color.accentColor.opacity(0.85) : .clear, in: RoundedRectangle(cornerRadius: 5))
      .foregroundStyle(lit ? .white : .primary)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(disabled)
    .onHover { hover = $0 }
    .padding(.horizontal, -6)
  }
}

// A setting that is on or off, as in Control Center: its title, and a switch at the far end.
private struct SwitchRow: View {
  let title: String
  let on: Bool
  let toggle: () -> Void

  var body: some View {
    HStack {
      Text(title)
      Spacer()
      Toggle(title, isOn: Binding(get: { on }, set: { _ in toggle() })).toggleStyle(.switch).controlSize(.mini).labelsHidden()
    }
    .padding(.vertical, 4)
  }
}
