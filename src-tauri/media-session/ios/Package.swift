// swift-tools-version:5.5

import PackageDescription

let package = Package(
    name: "nostria-media-session",
    platforms: [
        .iOS(.v13),
    ],
    products: [
        .library(
            name: "nostria-media-session",
            type: .static,
            targets: ["nostria-media-session"]
        ),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "nostria-media-session",
            dependencies: [
                .byName(name: "Tauri"),
            ],
            path: "Sources"
        ),
    ]
)