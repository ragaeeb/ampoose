import { describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createChunkState } from '@/domain/chunk/chunking';
import { createInitialProgress } from '@/runtime/state/runState';
import { createDefaultSettings, FETCH_MODE } from '@/runtime/settings/types';
import type { ControllerState } from '@/runtime/controller/types';
import { App } from '@/ui/App';

function makeState(patch: Partial<ControllerState> = {}): ControllerState {
    return {
        calibrationStatus: 'missing',
        chunkState: createChunkState(),
        collectionId: '',
        error: null,
        folderNames: [],
        isOnLimit: false,
        isStopManually: true,
        logs: [],
        open: true,
        posts: [],
        progress: createInitialProgress(),
        runId: 1,
        settings: createDefaultSettings(),
        step: 'START',
        ...patch,
    };
}

describe('App', () => {
    it('should call onOpen(true) when launcher is clicked', async () => {
        const onOpen = mock(() => {});
        render(
            <App
                state={makeState({ open: false })}
                onOpen={onOpen}
                onStart={mock(async () => {})}
                onStop={mock(() => {})}
                onContinue={mock(async () => {})}
                onDownload={mock(async () => {})}
                onDownloadLogs={mock(async () => {})}
                onSetMode={mock(() => {})}
                onSetCount={mock(() => {})}
                onSetDays={mock(() => {})}
                onSetUseDateFilter={mock(() => {})}
                onCalibrationStart={mock(() => {})}
                onCalibrationStop={mock(() => {})}
                onCalibrationSave={mock(async () => {})}
            />,
        );

        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: /download these posts/i }));
        expect(onOpen).toHaveBeenCalledWith(true);
    });

    it('should close the dialog when overlay is clicked', async () => {
        const onOpen = mock(() => {});
        render(
            <App
                state={makeState({ open: true })}
                onOpen={onOpen}
                onStart={mock(async () => {})}
                onStop={mock(() => {})}
                onContinue={mock(async () => {})}
                onDownload={mock(async () => {})}
                onDownloadLogs={mock(async () => {})}
                onSetMode={mock(() => {})}
                onSetCount={mock(() => {})}
                onSetDays={mock(() => {})}
                onSetUseDateFilter={mock(() => {})}
                onCalibrationStart={mock(() => {})}
                onCalibrationStop={mock(() => {})}
                onCalibrationSave={mock(async () => {})}
            />,
        );

        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: /close dialog/i }));
        expect(onOpen).toHaveBeenCalledWith(false);
    });

    it('should close the dialog on Escape key', async () => {
        const onOpen = mock(() => {});
        render(
            <App
                state={makeState({ open: true })}
                onOpen={onOpen}
                onStart={mock(async () => {})}
                onStop={mock(() => {})}
                onContinue={mock(async () => {})}
                onDownload={mock(async () => {})}
                onDownloadLogs={mock(async () => {})}
                onSetMode={mock(() => {})}
                onSetCount={mock(() => {})}
                onSetDays={mock(() => {})}
                onSetUseDateFilter={mock(() => {})}
                onCalibrationStart={mock(() => {})}
                onCalibrationStop={mock(() => {})}
                onCalibrationSave={mock(async () => {})}
            />,
        );

        const user = userEvent.setup();
        await user.keyboard('{Escape}');
        expect(onOpen).toHaveBeenCalledWith(false);
    });

    it('should show calibration banner and allow starting calibration when missing', async () => {
        const onCalibrationStart = mock(() => {});
        render(
            <App
                state={makeState({ calibrationStatus: 'missing', step: 'START' })}
                onOpen={mock(() => {})}
                onStart={mock(async () => {})}
                onStop={mock(() => {})}
                onContinue={mock(async () => {})}
                onDownload={mock(async () => {})}
                onDownloadLogs={mock(async () => {})}
                onSetMode={mock(() => {})}
                onSetCount={mock(() => {})}
                onSetDays={mock(() => {})}
                onSetUseDateFilter={mock(() => {})}
                onCalibrationStart={onCalibrationStart}
                onCalibrationStop={mock(() => {})}
                onCalibrationSave={mock(async () => {})}
            />,
        );

        expect(
            screen.getByText(/complete calibration first\. export controls are hidden/i),
        ).toBeTruthy();

        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: /start calibration/i }));
        expect(onCalibrationStart).toHaveBeenCalledTimes(1);
    });

    it('should show stop/save buttons when capturing', async () => {
        const onCalibrationStop = mock(() => {});
        const onCalibrationSave = mock(async () => {});
        render(
            <App
                state={makeState({ calibrationStatus: 'capturing', step: 'START' })}
                onOpen={mock(() => {})}
                onStart={mock(async () => {})}
                onStop={mock(() => {})}
                onContinue={mock(async () => {})}
                onDownload={mock(async () => {})}
                onDownloadLogs={mock(async () => {})}
                onSetMode={mock(() => {})}
                onSetCount={mock(() => {})}
                onSetDays={mock(() => {})}
                onSetUseDateFilter={mock(() => {})}
                onCalibrationStart={mock(() => {})}
                onCalibrationStop={onCalibrationStop}
                onCalibrationSave={onCalibrationSave}
            />,
        );

        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: /^stop$/i }));
        expect(onCalibrationStop).toHaveBeenCalledTimes(1);

        await user.click(screen.getByRole('button', { name: /save calibration/i }));
        expect(onCalibrationSave).toHaveBeenCalledTimes(1);
    });

    it('should allow changing settings when calibrated', async () => {
        const onSetMode = mock(() => {});
        const onSetCount = mock(() => {});
        const onSetDays = mock(() => {});
        const onSetUseDateFilter = mock(() => {});

        const user = userEvent.setup();

        const { rerender } = render(
            <App
                state={makeState({
                    calibrationStatus: 'ready',
                    settings: { ...createDefaultSettings(), fetchingCountType: FETCH_MODE.BY_POST_COUNT },
                    step: 'START',
                })}
                onOpen={mock(() => {})}
                onStart={mock(async () => {})}
                onStop={mock(() => {})}
                onContinue={mock(async () => {})}
                onDownload={mock(async () => {})}
                onDownloadLogs={mock(async () => {})}
                onSetMode={onSetMode}
                onSetCount={onSetCount}
                onSetDays={onSetDays}
                onSetUseDateFilter={onSetUseDateFilter}
                onCalibrationStart={mock(() => {})}
                onCalibrationStop={mock(() => {})}
                onCalibrationSave={mock(async () => {})}
            />,
        );

        await user.selectOptions(screen.getByLabelText(/fetch mode/i), String(FETCH_MODE.BY_DAYS_COUNT));
        expect(onSetMode).toHaveBeenCalledWith(FETCH_MODE.BY_DAYS_COUNT);

        await user.click(screen.getByRole('checkbox', { name: /use date filter/i }));
        expect(onSetUseDateFilter).toHaveBeenCalledWith(true);

        const countInput = screen.getByLabelText(/posts count/i);
        await user.clear(countInput);
        await user.type(countInput, '25');
        expect(onSetCount).toHaveBeenCalled();

        // Switch props to days mode since the App is fully controlled by props.
        rerender(
            <App
                state={makeState({
                    calibrationStatus: 'ready',
                    settings: { ...createDefaultSettings(), fetchingCountType: FETCH_MODE.BY_DAYS_COUNT },
                    step: 'START',
                })}
                onOpen={mock(() => {})}
                onStart={mock(async () => {})}
                onStop={mock(() => {})}
                onContinue={mock(async () => {})}
                onDownload={mock(async () => {})}
                onDownloadLogs={mock(async () => {})}
                onSetMode={onSetMode}
                onSetCount={onSetCount}
                onSetDays={onSetDays}
                onSetUseDateFilter={onSetUseDateFilter}
                onCalibrationStart={mock(() => {})}
                onCalibrationStop={mock(() => {})}
                onCalibrationSave={mock(async () => {})}
            />,
        );

        const daysInput = screen.getByLabelText(/days back/i);
        await user.clear(daysInput);
        await user.type(daysInput, '3');
        expect(onSetDays).toHaveBeenCalled();
    });

    it('should wire the primary action button across states', async () => {
        const onStart = mock(async () => {});
        const onStop = mock(() => {});
        const onContinue = mock(async () => {});
        const onOpen = mock(() => {});

        const user = userEvent.setup();

        const { rerender } = render(
            <App
                state={makeState({ calibrationStatus: 'ready', step: 'START', open: true })}
                onOpen={onOpen}
                onStart={onStart}
                onStop={onStop}
                onContinue={onContinue}
                onDownload={mock(async () => {})}
                onDownloadLogs={mock(async () => {})}
                onSetMode={mock(() => {})}
                onSetCount={mock(() => {})}
                onSetDays={mock(() => {})}
                onSetUseDateFilter={mock(() => {})}
                onCalibrationStart={mock(() => {})}
                onCalibrationStop={mock(() => {})}
                onCalibrationSave={mock(async () => {})}
            />,
        );

        await user.click(screen.getByRole('button', { name: /^start$/i }));
        expect(onStart).toHaveBeenCalledTimes(1);

        rerender(
            <App
                state={makeState({ calibrationStatus: 'ready', step: 'DOWNLOADING', isOnLimit: false, open: true })}
                onOpen={onOpen}
                onStart={onStart}
                onStop={onStop}
                onContinue={onContinue}
                onDownload={mock(async () => {})}
                onDownloadLogs={mock(async () => {})}
                onSetMode={mock(() => {})}
                onSetCount={mock(() => {})}
                onSetDays={mock(() => {})}
                onSetUseDateFilter={mock(() => {})}
                onCalibrationStart={mock(() => {})}
                onCalibrationStop={mock(() => {})}
                onCalibrationSave={mock(async () => {})}
            />,
        );

        await user.click(screen.getByRole('button', { name: /^stop$/i }));
        expect(onStop).toHaveBeenCalledTimes(1);

        rerender(
            <App
                state={makeState({ calibrationStatus: 'ready', step: 'DOWNLOADING', isOnLimit: true, open: true })}
                onOpen={onOpen}
                onStart={onStart}
                onStop={onStop}
                onContinue={onContinue}
                onDownload={mock(async () => {})}
                onDownloadLogs={mock(async () => {})}
                onSetMode={mock(() => {})}
                onSetCount={mock(() => {})}
                onSetDays={mock(() => {})}
                onSetUseDateFilter={mock(() => {})}
                onCalibrationStart={mock(() => {})}
                onCalibrationStop={mock(() => {})}
                onCalibrationSave={mock(async () => {})}
            />,
        );

        await user.click(screen.getByRole('button', { name: /^continue$/i }));
        expect(onContinue).toHaveBeenCalledTimes(1);

        rerender(
            <App
                state={makeState({ calibrationStatus: 'ready', step: 'DONE', open: true })}
                onOpen={onOpen}
                onStart={onStart}
                onStop={onStop}
                onContinue={onContinue}
                onDownload={mock(async () => {})}
                onDownloadLogs={mock(async () => {})}
                onSetMode={mock(() => {})}
                onSetCount={mock(() => {})}
                onSetDays={mock(() => {})}
                onSetUseDateFilter={mock(() => {})}
                onCalibrationStart={mock(() => {})}
                onCalibrationStop={mock(() => {})}
                onCalibrationSave={mock(async () => {})}
            />,
        );

        await user.click(screen.getByRole('button', { name: /^close$/i }));
        expect(onOpen).toHaveBeenCalledWith(false);
    });
});
