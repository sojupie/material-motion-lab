import { errorMessage } from "./errors";
import { prepareOffline } from "./offline";
import "./style.css";
import { WorkspaceController } from "./workspace";

async function start(): Promise<void> {
  const workspace = new WorkspaceController();
  try {
    const stylesheet =
      document.querySelector<HTMLLinkElement>("#workspace-styles")!;
    if (stylesheet.media === "print") {
      await new Promise<void>((resolve, reject) => {
        stylesheet.addEventListener(
          "load",
          () => {
            resolve();
          },
          { once: true },
        );
        stylesheet.addEventListener(
          "error",
          () => {
            reject(
              new Error("Workspace styles could not load. Reload to retry."),
            );
          },
          { once: true },
        );
      });
    }
    await workspace.start();
  } catch (error: unknown) {
    workspace.operations.status(errorMessage(error), true);
  }
  void prepareOffline();
}
void start();
