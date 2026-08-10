// swift-tools-version:5.5

import PackageDescription

let package = Package(
    name: "nostria-storekit",
    platforms: [
        .iOS(.v14),
    ],
    products: [
        .library(
            name: "nostria-storekit",
            type: .static,
            targets: ["nostria-storekit"]
        ),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "nostria-storekit",
            dependencies: [
                .byName(name: "Tauri"),
            ],
            path: "Sources"
        ),
    ]
)
