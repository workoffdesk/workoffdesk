// swift-tools-version:5.9
import PackageDescription

// The menu bar app: the service's state at a glance, read from and done through the workoffdesk CLI.
let package = Package(
  name: "WorkOffDeskMenu",
  platforms: [.macOS(.v13)],
  targets: [
    .target(name: "WorkOffDeskKit"),
    .target(name: "WorkOffDeskUI", dependencies: ["WorkOffDeskKit"]),
    .executableTarget(name: "WorkOffDeskMenu", dependencies: ["WorkOffDeskUI"]),
    .testTarget(name: "WorkOffDeskKitTests", dependencies: ["WorkOffDeskKit"]),
    .testTarget(name: "WorkOffDeskUITests", dependencies: ["WorkOffDeskUI"]),
  ]
)
