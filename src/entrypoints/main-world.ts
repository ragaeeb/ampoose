import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { createCalibrationCaptureManager } from "@/runtime/calibration/capture";
import { installMainWorldBridge } from "@/runtime/bridge/mainBridge";
import { installMainWorldCalibrationBridge } from "@/runtime/calibration/mainWorldBridge";

declare global {
  interface Window {
    __ampooseCalibration?: {
      start: () => void;
      stop: () => void;
      getCaptureCount: () => number;
      getMissing: () => string[];
      getCapturedNames: () => string[];
      getUnmatchedNames: () => string[];
      buildArtifact: () => unknown;
      isActive: () => boolean;
    };
  }
}

export default defineUnlistedScript(() => {
  installMainWorldBridge();
  const manager = createCalibrationCaptureManager();
  installMainWorldCalibrationBridge(manager);
  window.__ampooseCalibration = manager;
});
