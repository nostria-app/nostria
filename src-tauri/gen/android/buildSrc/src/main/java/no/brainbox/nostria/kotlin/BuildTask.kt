import java.io.File
import org.apache.tools.ant.taskdefs.condition.Os
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.logging.LogLevel
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction

data class CommandSpec(
    val executable: String,
    val prefixArgs: List<String> = emptyList(),
)

open class BuildTask : DefaultTask() {
    @Input
    var rootDirRel: String? = null
    @Input
    var target: String? = null
    @Input
    var release: Boolean? = null

    @TaskAction
    fun assemble() {
        val tauriDir = resolveTauriDir()
        val workspaceDir = resolveWorkspaceDir(tauriDir)

        if (shouldReusePrebuiltRustLibrary(tauriDir)) {
            return
        }

        ensureRustBuildCanRun(tauriDir)

        val candidates = resolveCommandCandidates(workspaceDir)
        var lastException: Exception? = null
        for (candidate in candidates) {
            try {
                runTauriCli(workspaceDir, candidate)
                return
            } catch (e: Exception) {
                lastException = e
            }
        }

        throw lastException ?: GradleException("Unable to resolve a Tauri CLI command for Android build")
    }

    private fun resolveTauriDir(): File {
        val rootDirRel = rootDirRel ?: throw GradleException("rootDirRel cannot be null")
        return File(project.projectDir, rootDirRel)
    }

    private fun resolveWorkspaceDir(tauriDir: File): File {
        var current: File? = tauriDir
        while (current != null) {
            if (File(current, "package.json").exists()) {
                return current
            }
            current = current.parentFile
        }

        return tauriDir.parentFile ?: tauriDir
    }

    private fun resolveCommandCandidates(rootDir: File): List<CommandSpec> {
        val candidates = mutableListOf<CommandSpec>()
        val tauriScript = File(rootDir, "node_modules/@tauri-apps/cli/tauri.js")
        if (tauriScript.exists()) {
            resolveNodeCandidates().forEach { nodePath ->
                candidates += CommandSpec(nodePath, listOf(tauriScript.absolutePath))
            }
        }

        val tauriCmd = File(rootDir, if (Os.isFamily(Os.FAMILY_WINDOWS)) "node_modules/.bin/tauri.cmd" else "node_modules/.bin/tauri")
        if (tauriCmd.exists()) {
            candidates += CommandSpec(tauriCmd.absolutePath)
        }

        candidates += CommandSpec("npm", listOf("run", "--", "tauri"))

        if (Os.isFamily(Os.FAMILY_WINDOWS)) {
            candidates += listOf(
                CommandSpec("npm.exe", listOf("run", "--", "tauri")),
                CommandSpec("npm.cmd", listOf("run", "--", "tauri")),
                CommandSpec("npm.bat", listOf("run", "--", "tauri")),
            )
        }

        return candidates.distinctBy { it.executable.lowercase() + "|" + it.prefixArgs.joinToString(" ") }
    }

    private fun resolveNodeCandidates(): List<String> {
        val candidates = mutableListOf<String>()

        listOf(
            System.getenv("TAURI_NODE_PATH"),
            System.getenv("NODE_EXE"),
        ).filterNotNull().filter { it.isNotBlank() }.forEach { candidates += it }

        if (Os.isFamily(Os.FAMILY_WINDOWS)) {
            val nvmHome = System.getenv("NVM_HOME")
            if (!nvmHome.isNullOrBlank()) {
                candidates += File(nvmHome, "node.exe").absolutePath
            }

            listOf(
                System.getenv("LocalAppData")?.let { File(it, "Programs/nodejs/node.exe").absolutePath },
                System.getenv("ProgramFiles")?.let { File(it, "nodejs/node.exe").absolutePath },
                System.getenv("ProgramFiles(x86)")?.let { File(it, "nodejs/node.exe").absolutePath },
            ).filterNotNull().forEach { candidates += it }
        }

        candidates += "node"
        return candidates.distinct()
    }

    private fun shouldReusePrebuiltRustLibrary(tauriDir: File): Boolean {
        if (release == true) {
            return false
        }

        val prebuiltLibrary = resolveReusableRustLibrary(tauriDir) ?: return false
        if (!prebuiltLibrary.exists() || prebuiltLibrary.length() <= 0L) {
            return false
        }

        val packagedLibrary = resolvePackagedRustLibrary() ?: return false
        packagedLibrary.parentFile?.mkdirs()
        prebuiltLibrary.copyTo(packagedLibrary, overwrite = true)

        logger.lifecycle(
            "No active Tauri Android dev session detected; staging prebuilt Rust library from ${prebuiltLibrary.absolutePath} to ${packagedLibrary.absolutePath}"
        )
        return true
    }

    private fun ensureRustBuildCanRun(tauriDir: File) {
        if (release == true) {
            return
        }

        val serverAddrFile = resolveServerAddrFile(tauriDir) ?: return
        if (serverAddrFile.exists()) {
            return
        }

        val prebuiltLibrary = resolveReusableRustLibrary(tauriDir)
        throw GradleException(
            buildString {
                append("Android Studio debug builds require either an active Tauri mobile dev session or a prebuilt Rust library.")
                if (prebuiltLibrary != null) {
                    append(" Missing prebuilt library: ${prebuiltLibrary.absolutePath}.")
                }
                append(" Start Android Studio from `npm run tauri:android:dev:emulator` or `npm run tauri:android:dev:device`, or generate the native libraries with a Tauri Android build first.")
            }
        )
    }

    private fun resolveServerAddrFile(tauriDir: File): File? {
        val identifier = resolveTauriIdentifier(tauriDir) ?: return null
        return File(System.getProperty("java.io.tmpdir"), "$identifier-server-addr")
    }

    private fun resolveReusableRustLibrary(tauriDir: File): File? {
        val targetLibrary = resolveTargetRustLibrary(tauriDir)
        if (targetLibrary != null && targetLibrary.exists() && targetLibrary.length() > 0L) {
            return targetLibrary
        }

        val packagedLibrary = resolvePackagedRustLibrary()
        if (packagedLibrary != null && packagedLibrary.exists() && packagedLibrary.length() > 0L) {
            return packagedLibrary
        }

        return targetLibrary ?: packagedLibrary
    }

    private fun resolvePackagedRustLibrary(): File? {
        val targetName = target ?: return null
        val abiDir = when (targetName) {
            "aarch64" -> "arm64-v8a"
            "armv7" -> "armeabi-v7a"
            "i686" -> "x86"
            "x86_64" -> "x86_64"
            else -> return null
        }

        return File(project.projectDir, "src/main/jniLibs/$abiDir/libnostria_lib.so")
    }

    private fun resolveTargetRustLibrary(tauriDir: File): File? {
        val targetName = target ?: return null
        val targetTriple = when (targetName) {
            "aarch64" -> "aarch64-linux-android"
            "armv7" -> "armv7-linux-androideabi"
            "i686" -> "i686-linux-android"
            "x86_64" -> "x86_64-linux-android"
            else -> return null
        }
        val profileDir = if (release == true) "release" else "debug"
        return File(tauriDir, "target/$targetTriple/$profileDir/libnostria_lib.so")
    }

    private fun resolveTauriIdentifier(tauriDir: File): String? {
        val tauriConfig = File(tauriDir, "tauri.conf.json")
        if (!tauriConfig.exists()) {
            return null
        }

        val identifierPattern = Regex("\"identifier\"\\s*:\\s*\"([^\"]+)\"")
        return identifierPattern.find(tauriConfig.readText())?.groupValues?.getOrNull(1)
    }

    private fun runTauriCli(rootDir: File, command: CommandSpec) {
        val target = target ?: throw GradleException("target cannot be null")
        val release = release ?: throw GradleException("release cannot be null")
        val args = command.prefixArgs + listOf("android", "android-studio-script")

        project.exec {
            workingDir(rootDir)
            executable(command.executable)
            args(args)
            if (project.logger.isEnabled(LogLevel.DEBUG)) {
                args("-vv")
            } else if (project.logger.isEnabled(LogLevel.INFO)) {
                args("-v")
            }
            if (release) {
                args("--release")
            }
            args(listOf("--target", target))
        }.assertNormalExitValue()
    }
}