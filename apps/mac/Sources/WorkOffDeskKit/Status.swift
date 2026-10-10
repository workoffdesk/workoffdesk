import Foundation

// What `workoffdesk status --json` prints (apps/server/src/cli.ts): the checks doctor runs, the build, and the
// recent warnings and errors in the service's log.

public struct Check: Decodable, Equatable, Identifiable {
  public let id: String
  public let ok: Bool
  public let detail: String
  public let fix: String?
}

public struct Problem: Decodable, Equatable {
  public let at: String
  public let level: String
  public let msg: String
  public let detail: String

  private static let iso: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
  }()

  public var date: Date? { Problem.iso.date(from: at) }
}

public struct Build: Decodable, Equatable {
  public let commit: String?
  public let dirty: Bool
}

public struct Status: Decodable, Equatable {
  public let checks: [Check]
  public let version: String
  public let build: Build?
  public let release: String?
  public let home: String
  public let origin: String?
  public let port: Int?
  public let running: Bool
  public let problems: [Problem]

  public enum Health: Equatable {
    case ok
    case problems(Int)
    case stopped
  }

  public var failed: [Check] { checks.filter { !$0.ok } }

  public var health: Health {
    guard running else { return .stopped }
    return failed.isEmpty ? .ok : .problems(failed.count)
  }

  // The log's errors, newest first as the CLI gives them; warnings are left to the This Mac page.
  public var errors: [Problem] { problems.filter { $0.level == "error" || $0.level == "fatal" } }

  public static func decode(_ data: Data) throws -> Status {
    try JSONDecoder().decode(Status.self, from: data)
  }
}
