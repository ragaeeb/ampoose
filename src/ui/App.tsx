import { useEffect, useMemo, useRef } from "react";
import type { ControllerState } from "@/runtime/controller/types";
import { FETCH_MODE, type FetchingCountType } from "@/runtime/settings/types";

type Props = {
  state: ControllerState;
  onOpen: (open: boolean) => void;
  onStart: () => Promise<void>;
  onStop: () => void;
  onContinue: () => Promise<void>;
  onDownload: () => Promise<void>;
  onDownloadLogs: () => Promise<void>;
  onSetMode: (mode: FetchingCountType) => void;
  onSetCount: (count: number) => void;
  onSetDays: (days: number) => void;
  onSetUseDateFilter: (value: boolean) => void;
  onCalibrationStart: () => void;
  onCalibrationStop: () => void;
  onCalibrationSave: () => Promise<void>;
};

const shellFont = '"IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif';
const monoFont = '"IBM Plex Mono", "SFMono-Regular", "Consolas", monospace';

function getStepTone(step: ControllerState["step"]): { text: string; bg: string; border: string } {
  if (step === "DOWNLOADING") return { text: "#1d4ed8", bg: "#eff6ff", border: "#dbeafe" };
  if (step === "DONE") return { text: "#047857", bg: "#ecfdf5", border: "#d1fae5" };
  return { text: "#4b5563", bg: "#f9fafb", border: "#e5e7eb" };
}

function getCalibrationTone(status: ControllerState["calibrationStatus"]): { text: string; bg: string; border: string } {
  if (status === "ready") return { text: "#047857", bg: "#ecfdf5", border: "#d1fae5" };
  if (status === "capturing") return { text: "#1d4ed8", bg: "#eff6ff", border: "#dbeafe" };
  return { text: "#b91c1c", bg: "#fef2f2", border: "#fee2e2" };
}

function compactValue(value: string | null | undefined, head = 14, tail = 12): string {
  const input = String(value ?? "null");
  if (input.length <= head + tail + 3) return input;
  return `${input.slice(0, head)}...${input.slice(-tail)}`;
}

function compactLogMessage(message: string): string {
  return message
    .replace(/(cursor=)([^\s]+)/g, (_match, prefix: string, value: string) => `${prefix}${compactValue(value, 12, 10)}`)
    .replace(/(nextCursor=|next=)([^\s]+)/g, (_match, prefix: string, value: string) => `${prefix}${compactValue(value, 12, 10)}`);
}

function Pill({
  label,
  value,
  tone,
  action
}: {
  label: string;
  value: string;
  tone: { text: string; bg: string; border: string };
  action?: { title: string; onClick: () => void };
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        border: `1px solid ${tone.border}`,
        background: tone.bg,
        color: tone.text,
        borderRadius: 999,
        padding: "6px 12px",
        fontSize: 12,
        fontWeight: 700
      }}
    >
      <span style={{ opacity: 0.8 }}>{label}</span>
      <span>{value}</span>
      {action && (
        <button
          onClick={action.onClick}
          title={action.title}
          aria-label={action.title}
          style={{
            width: 18,
            height: 18,
            borderRadius: 9,
            border: `1px solid ${tone.border}`,
            background: "#fff",
            color: tone.text,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            lineHeight: 1,
            padding: 0,
            cursor: "pointer"
          }}
        >
          ↻
        </button>
      )}
    </div>
  );
}

export function App({
  state,
  onOpen,
  onStart,
  onStop,
  onContinue,
  onDownload,
  onDownloadLogs,
  onSetMode,
  onSetCount,
  onSetDays,
  onSetUseDateFilter,
  onCalibrationStart,
  onCalibrationStop,
  onCalibrationSave
}: Props) {
  const logsViewportRef = useRef<HTMLDivElement | null>(null);
  const logoUrl =
    typeof chrome !== "undefined" && chrome.runtime?.getURL
      ? chrome.runtime.getURL("src/assets/logo/icon.svg")
      : "";
  const isCalibrated = state.calibrationStatus === "ready";
  const showExportControls = isCalibrated;
  const stepTone = getStepTone(state.step);
  const calibrationTone = getCalibrationTone(state.calibrationStatus);
  const calibrationLabel = state.calibrationStatus === "ready" ? "Ready" : state.calibrationStatus === "capturing" ? "Capturing" : "Missing";
  const stats = [
    `cursor=${compactValue(state.progress.cursor)}`,
    `next=${compactValue(state.progress.nextCursor)}`,
    `pages=${state.progress.pagesFetched}`,
    `batch=${state.progress.lastBatchCount}`,
    `dup=${state.progress.duplicateStreak}`,
    `posts=${state.progress.totalPosts}`
  ].join("  ·  ");

  const primaryText = useMemo(() => {
    if (state.step === "START") return "Start";
    if (state.step === "DOWNLOADING") return state.isOnLimit ? "Continue" : "Stop";
    return "Close";
  }, [state.step, state.isOnLimit]);

  useEffect(() => {
    const node = logsViewportRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [state.logs.length]);

  const handlePrimary = async () => {
    if (state.step === "START") {
      await onStart();
      return;
    }
    if (state.step === "DOWNLOADING") {
      if (state.isOnLimit) {
        await onContinue();
        return;
      }
      onStop();
      return;
    }
    onOpen(false);
  };

  return (
    <>
      <button
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          zIndex: 2147483646,
          background: "#111827",
          color: "#f9fafb",
          border: "1px solid #1f2937",
          borderRadius: 12,
          padding: "8px 12px",
          fontFamily: shellFont,
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: "0 8px 24px rgba(17, 24, 39, 0.32)"
        }}
        onClick={() => onOpen(true)}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="Ampoose logo"
              width={18}
              height={18}
              style={{ display: "block", borderRadius: 4 }}
            />
          ) : (
            <span aria-hidden="true" style={{ width: 18, height: 18, display: "inline-flex" }} />
          )}
          <span>Download These Posts</span>
        </span>
      </button>

      {state.open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.36)",
            backdropFilter: "blur(2px)",
            zIndex: 2147483646,
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) onOpen(false);
          }}
        >
          <div
            style={{
              width: "min(920px, 94vw)",
              maxHeight: "90vh",
              overflow: "hidden",
              background: "#ffffff",
              borderRadius: 16,
              border: "1px solid #dbe2ea",
              boxShadow: "0 18px 45px rgba(15, 23, 42, 0.22)",
              fontFamily: shellFont
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "14px 16px",
                borderBottom: "1px solid #e2e8f0",
                background: "#f8fafc"
              }}
            >
              <h3 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: "#0f172a", letterSpacing: -0.2 }}>Ampoose Next</h3>
              <button
                onClick={() => onOpen(false)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  background: "#ffffff",
                  color: "#374151",
                  fontWeight: 700,
                  cursor: "pointer"
                }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: 16, display: "grid", gap: 12, maxHeight: "calc(90vh - 68px)", overflow: "auto" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Pill label="Step" value={state.step} tone={stepTone} />
                <Pill
                  label="Calibration"
                  value={calibrationLabel}
                  tone={calibrationTone}
                  {...(state.calibrationStatus === "ready" && state.step === "START"
                    ? { action: { title: "Recalibrate", onClick: onCalibrationStart } }
                    : {})}
                />
              </div>

              {state.error && (
                <div style={{ border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 10, padding: 10, background: "#fef2f2" }}>
                  {state.error}
                </div>
              )}

              {!isCalibrated && (
                <div
                  style={{
                    border: "1px solid #bfdbfe",
                    color: "#1e3a8a",
                    borderRadius: 10,
                    padding: 10,
                    background: "#eff6ff",
                    fontSize: 13,
                    fontWeight: 600
                  }}
                >
                  Complete calibration first. Export controls are hidden until calibration is ready.
                </div>
              )}

              {state.step === "START" && showExportControls && (
                <div style={{ display: "grid", gap: 10, padding: 12, border: "1px solid #e2e8f0", borderRadius: 12, background: "#f8fafc" }}>
                  <label style={{ display: "grid", gap: 6, fontSize: 12, color: "#334155", fontWeight: 700 }}>
                    Fetch mode
                    <select
                      value={state.settings.fetchingCountType}
                      onChange={(event) => onSetMode(Number(event.target.value) as FetchingCountType)}
                      style={{
                        appearance: "none",
                        WebkitAppearance: "none",
                        height: 34,
                        borderRadius: 8,
                        border: "1px solid #cbd5e1",
                        background: "#fff",
                        backgroundImage:
                          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 20 20'%3E%3Cpath d='M5 7l5 5 5-5' fill='none' stroke='%2364748b' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E\")",
                        backgroundRepeat: "no-repeat",
                        backgroundPosition: "right 10px center",
                        padding: "0 34px 0 10px",
                        fontFamily: shellFont,
                        fontSize: 13
                      }}
                    >
                      <option value={FETCH_MODE.ALL}>Fetch ALL</option>
                      <option value={FETCH_MODE.BY_POST_COUNT}>By posts count</option>
                      <option value={FETCH_MODE.BY_DAYS_COUNT}>By days count</option>
                      <option value={FETCH_MODE.PACK}>Pack</option>
                    </select>
                  </label>

                  {state.settings.fetchingCountType === FETCH_MODE.BY_POST_COUNT && (
                    <label style={{ display: "grid", gap: 6, fontSize: 12, color: "#334155", fontWeight: 700 }}>
                      Posts count
                      <input
                        type="number"
                        min={1}
                        value={state.settings.fetchingCountByPostCountValue}
                        onChange={(event) => onSetCount(Math.max(1, Number(event.target.value) || 1))}
                        style={{
                          height: 34,
                          borderRadius: 8,
                          border: "1px solid #cbd5e1",
                          background: "#fff",
                          padding: "0 10px",
                          fontFamily: shellFont,
                          fontSize: 13
                        }}
                      />
                    </label>
                  )}

                  {state.settings.fetchingCountType === FETCH_MODE.BY_DAYS_COUNT && (
                    <label style={{ display: "grid", gap: 6, fontSize: 12, color: "#334155", fontWeight: 700 }}>
                      Days back
                      <input
                        type="number"
                        min={1}
                        value={state.settings.fetchingCountByPostDaysValue}
                        onChange={(event) => onSetDays(Math.max(1, Number(event.target.value) || 1))}
                        style={{
                          height: 34,
                          borderRadius: 8,
                          border: "1px solid #cbd5e1",
                          background: "#fff",
                          padding: "0 10px",
                          fontFamily: shellFont,
                          fontSize: 13
                        }}
                      />
                    </label>
                  )}

                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#334155", fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={state.settings.isUsePostsFilter}
                      onChange={(event) => onSetUseDateFilter(event.target.checked)}
                    />
                    Use date filter
                  </label>
                </div>
              )}

              {state.step === "START" && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={onCalibrationStart}
                    style={{
                      display: state.calibrationStatus === "missing" ? "inline-flex" : "none",
                      height: 34,
                      alignItems: "center",
                      borderRadius: 8,
                      border: "1px solid #334155",
                      background: "#111827",
                      color: "#f8fafc",
                      fontSize: 13,
                      fontWeight: 600,
                      padding: "0 12px",
                      cursor: "pointer"
                    }}
                  >
                    Start Calibration
                  </button>
                  <button
                    onClick={onCalibrationStop}
                    style={{
                      display: state.calibrationStatus === "capturing" ? "inline-flex" : "none",
                      height: 34,
                      alignItems: "center",
                      borderRadius: 8,
                      border: "1px solid #d1d5db",
                      background: "#ffffff",
                      color: "#374151",
                      fontSize: 13,
                      fontWeight: 600,
                      padding: "0 12px",
                      cursor: "pointer"
                    }}
                  >
                    Stop
                  </button>
                  <button
                    onClick={() => void onCalibrationSave()}
                    style={{
                      display: state.calibrationStatus === "capturing" ? "inline-flex" : "none",
                      height: 34,
                      alignItems: "center",
                      borderRadius: 8,
                      border: "1px solid #334155",
                      background: "#111827",
                      color: "#f8fafc",
                      fontSize: 13,
                      fontWeight: 600,
                      padding: "0 12px",
                      cursor: "pointer"
                    }}
                  >
                    Save Calibration
                  </button>
                </div>
              )}

              {showExportControls && (
                <>
                  <div
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 10,
                      background: "#f8fafc",
                      padding: "10px 12px",
                      fontSize: 12,
                      color: "#334155",
                      fontFamily: monoFont,
                      overflowX: "auto",
                      whiteSpace: "nowrap"
                    }}
                  >
                    {stats}
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      onClick={() => void handlePrimary()}
                      style={{
                        height: 36,
                        borderRadius: 8,
                        border: "1px solid #0f172a",
                        background: "#0f172a",
                        color: "#f8fafc",
                        fontSize: 13,
                        fontWeight: 600,
                        padding: "0 14px",
                        cursor: "pointer"
                      }}
                    >
                      {primaryText}
                    </button>
                    <button
                      onClick={() => void onDownload()}
                      style={{
                        height: 36,
                        borderRadius: 8,
                        border: "1px solid #cbd5e1",
                        background: "#fff",
                        color: "#0f172a",
                        fontSize: 13,
                        fontWeight: 600,
                        padding: "0 14px",
                        cursor: "pointer"
                      }}
                    >
                      JSON
                    </button>
                    <button
                      onClick={() => void onDownloadLogs()}
                      style={{
                        height: 36,
                        borderRadius: 8,
                        border: "1px solid #cbd5e1",
                        background: "#fff",
                        color: "#0f172a",
                        fontSize: 13,
                        fontWeight: 600,
                        padding: "0 14px",
                        cursor: "pointer"
                      }}
                    >
                      Logs
                    </button>
                  </div>
                </>
              )}

              <div
                ref={logsViewportRef}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  background: "#f8fafc",
                  color: "#334155",
                  maxHeight: 220,
                  overflow: "auto",
                  fontSize: 12,
                  fontFamily: monoFont
                }}
              >
                <div
                  style={{
                    position: "sticky",
                    top: 0,
                    padding: "8px 10px",
                    borderBottom: "1px solid #e2e8f0",
                    background: "#f8fafc",
                    fontSize: 11,
                    color: "#64748b",
                    letterSpacing: 0.2
                  }}
                >
                  Runtime Logs
                </div>
                <div style={{ padding: "8px 10px" }}>
                  {state.logs.length === 0 && <div style={{ color: "#94a3b8" }}>No logs yet.</div>}
                  {state.logs.map((entry) => {
                    const color = entry.type === "error" ? "#b91c1c" : entry.type === "warn" ? "#a16207" : "#334155";
                    return (
                      <div
                        key={entry.id}
                        style={{
                          color,
                          lineHeight: 1.45,
                          marginBottom: 2,
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                          wordBreak: "break-word"
                        }}
                      >
                        [{entry.type}] {compactLogMessage(entry.msg)}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
