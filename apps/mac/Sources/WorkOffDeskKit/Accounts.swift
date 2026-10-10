import Foundation

// What `workoffdesk account --json` prints: the Claude accounts on the Mac, the one new sessions start on, and the
// open sessions on another account (apps/server/src/agents/claude/accounts.ts).

public struct ClaudeAccount: Decodable, Equatable, Identifiable {
  // Its config dir, "" for the default.
  public let id: String
  public let folder: String
  public let email: String
  public let signedIn: Bool
  public let ready: Bool
  public let shared: Bool

  // Why it cannot be picked, or nil when it can.
  public func bar(_ words: Words) -> String? {
    !signedIn ? words.accountSignedOut : !ready ? words.accountNotReady : !shared ? words.accountApart : nil
  }
}

public struct Accounts: Decodable, Equatable {
  public let accounts: [ClaudeAccount]
  public let inUse: String
  public let picked: Bool
  // The open sessions on another account, and those of them to move once their reply is done.
  public let elsewhere: Int
  public let moving: Int

  public static func decode(_ data: Data) throws -> Accounts {
    try JSONDecoder().decode(Accounts.self, from: data)
  }
}

extension CLI {
  public func accounts() async throws -> Accounts {
    try Accounts.decode(Data(try await ran(["account", "--json"]).utf8))
  }

  // By its folder, which names one account where an email may name two.
  public func pick(_ account: ClaudeAccount) async throws {
    _ = try await ran(["account", "use", account.folder])
  }

  public func moveSessions() async throws {
    _ = try await ran(["account", "move"])
  }

  // What it printed, or a failure with what it said instead.
  private func ran(_ args: [String]) async throws -> String {
    let r = await run(args)
    guard r.code == 0 else { throw Failure(message: [r.err, r.out].first { !$0.isEmpty }?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "") }
    return r.out
  }
}
