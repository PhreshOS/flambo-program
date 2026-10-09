// Downloads Chromium for Playwright when Flambo is installed. On Linux, Chromium also needs native
// libraries, which Playwright installs with apt-get; that only works where nobody has to type a
// password and apt-get exists. Elsewhere, such as Arch or an unprivileged account, only Chromium is
// downloaded, and Playwright names any library it misses when Chromium first starts.
import { execFileSync, spawnSync } from "node:child_process"

const linux = process.platform === "linux"
const succeeds = (command, ...args) => spawnSync(command, args, { stdio: "ignore" }).status === 0
const privileged = process.getuid?.() === 0 || succeeds("sudo", "-n", "true")
const libraries = linux && privileged && succeeds("sh", "-c", "command -v apt-get")

execFileSync("npx", ["playwright", "install", ...libraries ? ["--with-deps"] : [], "chromium"], {
    stdio: "inherit",
    shell: process.platform === "win32"
})
