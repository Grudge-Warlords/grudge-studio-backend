# Local build and launch

Canonical source: `C:\grudgegit\grudge-studio-backend`. Build workspace: `D:\grudgegit\grudge-studio-backend\<component>\<runID>`. Completed outputs: `E:\grudgegit\grudge-studio-backend\<component>\<runID>`.

Use `Project-Console.ps1` for independent component build/launch windows, installer selection and administrator cleanup. Use `Build-Workspace.ps1 -Plan` to inspect without building, or `-Component <id>` to build one component. A build stages current source and dependencies on D; it never compiles in C. Successful output receipts and runnable dependencies are published to E. Failed builds never advance latest.

Each build offers to launch the completed program. Windows installers have an assisted finish page with a launch checkbox. Latest launch never triggers a build. Component and dependency details are in `.workspace-build.json`. Native Apple compilation requires macOS/Xcode; Windows can export its source kit.

Cleanup terminates processes owned by this project and removes managed D build runs. It preserves C source, E outputs and persistent data outside the grouped D project folder. UAC is requested only when the cleanup option is chosen.

Build scripts in package.json enter this workflow; their original commands are preserved in the manifest and restored in the D snapshot. No build was run during configuration.
