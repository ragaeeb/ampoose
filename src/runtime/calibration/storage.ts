import { CALIBRATION_STORAGE_KEY, normalizeGraphqlArtifact } from "@/domain/calibration/artifact";
import type { GraphqlArtifactV1 } from "@/domain/types";
import { sendRuntimeMessage } from "@/runtime/bridge/contentBridge";

export async function loadCalibrationArtifact(): Promise<GraphqlArtifactV1 | null> {
  const raw = await sendRuntimeMessage("getPersistLocalStorage", [CALIBRATION_STORAGE_KEY, null]);
  return normalizeGraphqlArtifact(raw);
}

export async function saveCalibrationArtifact(artifact: GraphqlArtifactV1): Promise<void> {
  await sendRuntimeMessage("setPersistLocalStorage", [CALIBRATION_STORAGE_KEY, artifact]);
}

export async function clearCalibrationArtifact(): Promise<void> {
  await sendRuntimeMessage("removePersistLocalStorage", [CALIBRATION_STORAGE_KEY]);
}
