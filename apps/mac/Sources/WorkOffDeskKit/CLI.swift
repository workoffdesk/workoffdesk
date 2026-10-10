import Foundation

// The workoffdesk command: everything the app shows comes from it and everything it does goes through it.
public struct CLI {
  public let path: String
  // The language it answers in: the menu's, whatever locale the app was started with.
  public let lang: Lang

  public init(path: String, lang: Lang = .current) {
    self.path = path
    self.lang = lang
  }

  // Where install writes it first (~/.local/bin), then where npm's global bin usually is.
  public static func find(home: String = NSHomeDirectory(), isExecutable: (String) -> Bool = FileManager.default.isExecutableFile(atPath:)) -> CLI? {
    ["\(home)/.local/bin/workoffdesk", "/opt/homebrew/bin/workoffdesk", "/usr/local/bin/workoffdesk"].first(where: isExecutable).map { CLI(path: $0) }
  }

  public struct Result {
    public let code: Int32
    public let out: String
    public let err: String
  }

  // An app started from Finder has launchd's PATH, which has none of Homebrew's.
  private static let path = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].joined(separator: ":")

  public func run(_ args: [String], timeout: TimeInterval = 90) async -> Result {
    await withCheckedContinuation { done in
      DispatchQueue.global().async { done.resume(returning: runNow(args, timeout: timeout)) }
    }
  }

  // A run of it, not yet started.
  func process(_ args: [String]) -> Process {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: path)
    process.arguments = args
    var env = ProcessInfo.processInfo.environment
    env["PATH"] = [env["PATH"], CLI.path].compactMap { $0 }.joined(separator: ":")
    // The CLI picks its words from LC_ALL before anything else.
    env["LC_ALL"] = lang == .zh ? "zh_CN.UTF-8" : "en_US.UTF-8"
    process.environment = env
    process.standardInput = FileHandle.nullDevice
    return process
  }

  private func runNow(_ args: [String], timeout: TimeInterval) -> Result {
    let process = process(args)
    let out = Pipe()
    let err = Pipe()
    process.standardOutput = out
    process.standardError = err
    do {
      try process.run()
    } catch {
      return Result(code: -1, out: "", err: error.localizedDescription)
    }
    // Both pipes read while it runs: one that fills its 64 KB would otherwise stop it for good.
    let group = DispatchGroup()
    var outData = Data()
    var errData = Data()
    DispatchQueue.global().async(group: group) { outData = out.fileHandleForReading.readDataToEndOfFile() }
    DispatchQueue.global().async(group: group) { errData = err.fileHandleForReading.readDataToEndOfFile() }
    let timer = DispatchWorkItem { if process.isRunning { process.terminate() } }
    DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: timer)
    process.waitUntilExit()
    timer.cancel()
    group.wait()
    return Result(code: process.terminationStatus, out: String(decoding: outData, as: UTF8.self), err: String(decoding: errData, as: UTF8.self))
  }

  public struct Failure: LocalizedError {
    public let message: String
    public var errorDescription: String? { message }
  }

  public func status() async throws -> Status {
    let r = await run(["status", "--json"])
    guard r.code == 0 else { throw Failure(message: r.err.trimmingCharacters(in: .whitespacesAndNewlines)) }
    return try Status.decode(Data(r.out.utf8))
  }
}
