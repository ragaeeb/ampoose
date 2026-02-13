import { loadStoredLogLevel, runtimeLogLevels, saveStoredLogLevel } from '@/runtime/settings/logLevelStorage';
import type { RuntimeLogLevel } from '@/runtime/settings/types';

const selectNode = document.getElementById('log-level');

if (!(selectNode instanceof HTMLSelectElement)) {
    throw new Error('popup: missing log-level select');
}

void loadStoredLogLevel().then((level) => {
    selectNode.value = level;
});

selectNode.addEventListener('change', () => {
    const next = selectNode.value as RuntimeLogLevel;
    if (!runtimeLogLevels.includes(next)) {
        return;
    }
    void saveStoredLogLevel(next);
});
