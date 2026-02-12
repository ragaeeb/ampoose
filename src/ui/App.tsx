import type { ReactNode, RefObject } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import type { ControllerState } from '@/runtime/controller/types';
import { FETCH_MODE, type FetchingCountType } from '@/runtime/settings/types';
import './styles.css';

export type AppProps = {
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

function resolveLogoUrl(): string {
    return typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL('src/assets/logo/icon.svg') : '';
}

function getStepPillClass(step: ControllerState['step']): string {
    if (step === 'DOWNLOADING') {
        return 'pill-step';
    }
    if (step === 'DONE') {
        return 'pill-done';
    }
    return 'pill-default';
}

function getCalibrationPillClass(status: ControllerState['calibrationStatus']): string {
    if (status === 'ready') {
        return 'pill-calibration-ready';
    }
    if (status === 'capturing') {
        return 'pill-calibration-capturing';
    }
    return 'pill-calibration-missing';
}

function compactValue(value: string | null | undefined, head = 14, tail = 12): string {
    const input = String(value ?? 'null');
    if (input.length <= head + tail + 3) {
        return input;
    }
    return `${input.slice(0, head)}...${input.slice(-tail)}`;
}

function compactLogMessage(message: string): string {
    return message
        .replace(
            /(cursor=)([^\s]+)/g,
            (_match, prefix: string, value: string) => `${prefix}${compactValue(value, 12, 10)}`,
        )
        .replace(
            /(nextCursor=|next=)([^\s]+)/g,
            (_match, prefix: string, value: string) => `${prefix}${compactValue(value, 12, 10)}`,
        );
}

function getCalibrationLabel(status: ControllerState['calibrationStatus']): string {
    if (status === 'ready') {
        return 'Ready';
    }
    if (status === 'capturing') {
        return 'Capturing';
    }
    return 'Missing';
}

function formatStats(state: ControllerState): string {
    return [
        `cursor=${compactValue(state.progress.cursor)}`,
        `next=${compactValue(state.progress.nextCursor)}`,
        `pages=${state.progress.pagesFetched}`,
        `batch=${state.progress.lastBatchCount}`,
        `dup=${state.progress.duplicateStreak}`,
        `posts=${state.progress.totalPosts}`,
    ].join('  ·  ');
}

function getPrimaryText(step: ControllerState['step'], isOnLimit: boolean): string {
    if (step === 'START') {
        return 'Start';
    }
    if (step === 'DOWNLOADING') {
        return isOnLimit ? 'Continue' : 'Stop';
    }
    return 'Close';
}

function Pill({
    label,
    value,
    pillClass,
    action,
}: {
    label: string;
    value: string;
    pillClass: string;
    action?: { title: string; onClick: () => void };
}) {
    return (
        <div className={`pill ${pillClass}`}>
            <span className="pill-label">{label}</span>
            <span>{value}</span>
            {action && (
                <button
                    type="button"
                    onClick={action.onClick}
                    title={action.title}
                    aria-label={action.title}
                    className="pill-action-button"
                >
                    ↻
                </button>
            )}
        </div>
    );
}

function LauncherButton({ logoUrl, onOpen }: { logoUrl: string; onOpen: (open: boolean) => void }) {
    return (
        <button type="button" className="launcher-button" onClick={() => onOpen(true)}>
            <span style={{ alignItems: 'center', display: 'inline-flex', gap: 8 }}>
                {logoUrl ? (
                    <img
                        src={logoUrl}
                        alt="Ampoose logo"
                        width={18}
                        height={18}
                        style={{ borderRadius: 4, display: 'block' }}
                    />
                ) : (
                    <span aria-hidden="true" style={{ display: 'inline-flex', height: 18, width: 18 }} />
                )}
                <span>Download These Posts</span>
            </span>
        </button>
    );
}

function ModalShell({ children, onClose }: { children: ReactNode; onClose: () => void }) {
    return (
        <div className="modal-overlay">
            <button
                type="button"
                aria-label="Close dialog"
                onClick={onClose}
                className="modal-overlay-backdrop"
            />
            {children}
        </div>
    );
}

function ModalHeader({ onClose }: { onClose: () => void }) {
    return (
        <div className="modal-header">
            <h3>Ampoose</h3>
            <button type="button" onClick={onClose} className="modal-header-close">
                ×
            </button>
        </div>
    );
}

function ErrorBanner({ error }: { error: string }) {
    return <div className="error-banner">{error}</div>;
}

function CalibrationBanner() {
    return <div className="calibration-banner">Complete calibration first. Export controls are hidden until calibration is ready.</div>;
}

function SettingsPanel({
    state,
    onSetMode,
    onSetCount,
    onSetDays,
    onSetUseDateFilter,
}: {
    state: ControllerState;
    onSetMode: (mode: FetchingCountType) => void;
    onSetCount: (count: number) => void;
    onSetDays: (days: number) => void;
    onSetUseDateFilter: (value: boolean) => void;
}) {
    if (state.step !== 'START') {
        return null;
    }
    if (state.calibrationStatus !== 'ready') {
        return null;
    }

    return (
        <div className="settings-panel">
            <label className="settings-label">
                Fetch mode
                <select
                    value={state.settings.fetchingCountType}
                    onChange={(event) => onSetMode(Number(event.target.value) as FetchingCountType)}
                >
                    <option value={FETCH_MODE.ALL}>Fetch ALL</option>
                    <option value={FETCH_MODE.BY_POST_COUNT}>By posts count</option>
                    <option value={FETCH_MODE.BY_DAYS_COUNT}>By days count</option>
                    <option value={FETCH_MODE.PACK}>Pack</option>
                </select>
            </label>

            {state.settings.fetchingCountType === FETCH_MODE.BY_POST_COUNT && (
                <label className="settings-label">
                    Posts count
                    <input
                        type="number"
                        min={1}
                        value={state.settings.fetchingCountByPostCountValue}
                        onChange={(event) => onSetCount(Math.max(1, Number(event.target.value) || 1))}
                    />
                </label>
            )}

            {state.settings.fetchingCountType === FETCH_MODE.BY_DAYS_COUNT && (
                <label className="settings-label">
                    Days back
                    <input
                        type="number"
                        min={1}
                        value={state.settings.fetchingCountByPostDaysValue}
                        onChange={(event) => onSetDays(Math.max(1, Number(event.target.value) || 1))}
                    />
                </label>
            )}

            <label className="settings-checkbox-label">
                <input
                    type="checkbox"
                    checked={state.settings.isUsePostsFilter}
                    onChange={(event) => onSetUseDateFilter(event.target.checked)}
                />
                Use date filter
            </label>
        </div>
    );
}

function CalibrationControls({
    state,
    onCalibrationStart,
    onCalibrationStop,
    onCalibrationSave,
}: {
    state: ControllerState;
    onCalibrationStart: () => void;
    onCalibrationStop: () => void;
    onCalibrationSave: () => Promise<void>;
}) {
    if (state.step !== 'START') {
        return null;
    }

    return (
        <div className="controls">
            {state.calibrationStatus === 'missing' && (
                <button type="button" onClick={onCalibrationStart} className="button button-primary">
                    Start Calibration
                </button>
            )}
            {state.calibrationStatus === 'capturing' && (
                <>
                    <button type="button" onClick={onCalibrationStop} className="button button-secondary">
                        Stop
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            void onCalibrationSave().catch(() => {});
                        }}
                        className="button button-primary"
                    >
                        Save Calibration
                    </button>
                </>
            )}
        </div>
    );
}

function ExportControls({
    state,
    primaryText,
    onPrimary,
    onDownload,
    onDownloadLogs,
}: {
    state: ControllerState;
    primaryText: string;
    onPrimary: () => void;
    onDownload: () => Promise<void>;
    onDownloadLogs: () => Promise<void>;
}) {
    if (state.calibrationStatus !== 'ready') {
        return null;
    }

    return (
        <>
            <div className="stats-display">{formatStats(state)}</div>

            <div className="controls">
                <button type="button" onClick={onPrimary} className="button button-primary button-large">
                    {primaryText}
                </button>
                <button
                    type="button"
                    onClick={() => {
                        void onDownload().catch(() => {});
                    }}
                    className="button button-secondary button-large"
                >
                    JSON
                </button>
                <button
                    type="button"
                    onClick={() => {
                        void onDownloadLogs().catch(() => {});
                    }}
                    className="button button-secondary button-large"
                >
                    Logs
                </button>
            </div>
        </>
    );
}

function LogsPanel({
    logsViewportRef,
    logs,
}: {
    logsViewportRef: RefObject<HTMLDivElement | null>;
    logs: ControllerState['logs'];
}) {
    return (
        <div ref={logsViewportRef} className="logs-panel">
            <div className="logs-header">Runtime Logs</div>
            <div className="logs-content">
                {logs.length === 0 && <div className="logs-empty">No logs yet.</div>}
                {logs.map((entry) => (
                    <div key={entry.id} className={`logs-entry ${entry.type}`}>
                        [{entry.type}] {compactLogMessage(entry.msg)}
                    </div>
                ))}
            </div>
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
    onCalibrationSave,
}: AppProps) {
    const logsViewportRef = useRef<HTMLDivElement | null>(null);
    const logoUrl = resolveLogoUrl();
    const showExportControls = state.calibrationStatus === 'ready';
    const stepPillClass = getStepPillClass(state.step);
    const calibrationPillClass = getCalibrationPillClass(state.calibrationStatus);
    const calibrationLabel = getCalibrationLabel(state.calibrationStatus);

    const primaryText = useMemo(() => {
        return getPrimaryText(state.step, state.isOnLimit);
    }, [state.step, state.isOnLimit]);

    useEffect(() => {
        const node = logsViewportRef.current;
        if (!node) {
            return;
        }
        node.scrollTop = node.scrollHeight;
    }, [state.logs.length]);

    useEffect(() => {
        if (!state.open) {
            return;
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onOpen(false);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [state.open, onOpen]);

    const handlePrimary = async () => {
        if (state.step === 'START') {
            await onStart();
            return;
        }
        if (state.step === 'DOWNLOADING') {
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
            <LauncherButton logoUrl={logoUrl} onOpen={onOpen} />

            {state.open && (
                <ModalShell onClose={() => onOpen(false)}>
                    <div className="modal-dialog" role="dialog" aria-modal="true" aria-label="Ampoose export dialog">
                        <ModalHeader onClose={() => onOpen(false)} />

                        <div className="modal-content">
                            <div className="pill-group">
                                <Pill label="Step" value={state.step} pillClass={stepPillClass} />
                                <Pill
                                    label="Calibration"
                                    value={calibrationLabel}
                                    pillClass={calibrationPillClass}
                                    {...(state.calibrationStatus === 'ready' && state.step === 'START'
                                        ? { action: { onClick: onCalibrationStart, title: 'Recalibrate' } }
                                        : {})}
                                />
                            </div>

                            {state.error && <ErrorBanner error={state.error} />}

                            {state.calibrationStatus !== 'ready' && <CalibrationBanner />}

                            <SettingsPanel
                                state={state}
                                onSetMode={onSetMode}
                                onSetCount={onSetCount}
                                onSetDays={onSetDays}
                                onSetUseDateFilter={onSetUseDateFilter}
                            />

                            <CalibrationControls
                                state={state}
                                onCalibrationStart={onCalibrationStart}
                                onCalibrationStop={onCalibrationStop}
                                onCalibrationSave={onCalibrationSave}
                            />

                            {showExportControls && (
                                <ExportControls
                                    state={state}
                                    primaryText={primaryText}
                                    onPrimary={() => void handlePrimary()}
                                    onDownload={onDownload}
                                    onDownloadLogs={onDownloadLogs}
                                />
                            )}

                            <LogsPanel logsViewportRef={logsViewportRef} logs={state.logs} />
                        </div>
                    </div>
                </ModalShell>
            )}
        </>
    );
}
