import Foundation

// `workoffdesk activity --json` kept running: each count of working sessions it prints is told; when it ends
// (the service stopped, restarted or was deployed), 0 is told and it runs again a little later, twice as late
// each time it answered nothing.
public final class ActivityWatch: @unchecked Sendable {
  private let cli: CLI
  private let restartAfter: TimeInterval
  private let maxRestartAfter: TimeInterval
  private let onCount: @Sendable (Int) -> Void
  private let onEnd: @Sendable () -> Void
  private let run = Run()

  // onCount, and onEnd when a run that answered ends, are told on a background thread.
  public init(cli: CLI, restartAfter: TimeInterval = 5, maxRestartAfter: TimeInterval = 60, onCount: @escaping @Sendable (Int) -> Void,
    onEnd: @escaping @Sendable () -> Void = {}) {
    self.cli = cli
    self.restartAfter = restartAfter
    self.maxRestartAfter = maxRestartAfter
    self.onCount = onCount
    self.onEnd = onEnd
  }

  deinit { run.stop() }

  public func start() {
    // The thread holds what it needs, not the watch, so letting go of the watch stops it.
    let (cli, restartAfter, maxRestartAfter, onCount, onEnd, run) = (cli, restartAfter, maxRestartAfter, onCount, onEnd, run)
    Thread.detachNewThread {
      var wait = restartAfter
      while !run.stopped {
        let answered = ActivityWatch.once(cli, run, onCount)
        if run.stopped { return }
        onCount(0)
        if answered {
          onEnd()
          wait = restartAfter
        }
        run.pause(wait)
        wait = min(wait * 2, maxRestartAfter)
      }
    }
  }

  public func stop() { run.stop() }

  private struct Line: Decodable { let working: Int }

  // Whether it told a count.
  private static func once(_ cli: CLI, _ run: Run, _ onCount: (Int) -> Void) -> Bool {
    let process = cli.process(["activity", "--json"])
    let out = Pipe()
    process.standardOutput = out
    process.standardError = FileHandle.nullDevice
    guard run.started(process) else { return false }
    let reader = out.fileHandleForReading
    var rest = Data()
    var answered = false
    while case let data = reader.availableData, !data.isEmpty {
      rest.append(data)
      while let end = rest.firstIndex(of: 0x0A) {
        let line = rest[rest.startIndex..<end]
        rest.removeSubrange(rest.startIndex...end)
        if let count = try? JSONDecoder().decode(Line.self, from: line).working {
          answered = true
          onCount(count)
        }
      }
    }
    process.waitUntilExit()
    return answered
  }

  private final class Run: @unchecked Sendable {
    private let lock = NSLock()
    private var isStopped = false
    private var process: Process?
    private let wake = DispatchSemaphore(value: 0)

    var stopped: Bool { lock.withLock { isStopped } }

    // Runs it unless stopped; false when it did not run.
    func started(_ p: Process) -> Bool {
      lock.withLock {
        guard !isStopped, (try? p.run()) != nil else { return false }
        process = p
        return true
      }
    }

    func pause(_ seconds: TimeInterval) { _ = wake.wait(timeout: .now() + seconds) }

    func stop() {
      lock.withLock {
        isStopped = true
        if process?.isRunning == true { process?.terminate() }
      }
      wake.signal()
    }
  }
}
