import { defineContentScript } from 'wxt/utils/define-content-script';
import { createCalibrationCaptureManager } from '@/runtime/calibration/capture';
import { installMainWorldCalibrationBridge } from '@/runtime/calibration/mainWorldBridge';
import { DOMAIN_MATCHES } from '@/shared/constants';

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

export default defineContentScript({
    main() {
        const manager = createCalibrationCaptureManager();
        installMainWorldCalibrationBridge(manager);
        window.__ampooseCalibration = manager;
    },
    matches: DOMAIN_MATCHES,
    runAt: 'document_start',
    world: 'MAIN',
});
