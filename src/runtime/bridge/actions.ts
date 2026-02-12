import type { ResumeCursorRecord } from '@/domain/types';

export type BridgeAction =
    | 'getUIMemoSettings'
    | 'setUIMemoSettings'
    | 'getPersistLocalStorage'
    | 'setPersistLocalStorage'
    | 'removePersistLocalStorage'
    | 'clearPersistLocalStorage'
    | 'getAllPersistLocalStorage'
    | 'getResumeCursors'
    | 'setResumeCursors'
    | 'removeResumeCursors'
    | 'downloadTextAsFile'
    | 'downloadFileByUri';

export type BridgeRequestPayloadMap = {
    getUIMemoSettings: [];
    setUIMemoSettings: [Record<string, unknown> | null];
    getPersistLocalStorage: [string, unknown?];
    setPersistLocalStorage: [string, unknown];
    removePersistLocalStorage: [string];
    clearPersistLocalStorage: [];
    getAllPersistLocalStorage: [];
    getResumeCursors: [string];
    setResumeCursors: [string, string, string];
    removeResumeCursors: [string, string];
    downloadTextAsFile: [string, string, string?, boolean?];
    downloadFileByUri: [string, string?];
};

export type BridgeResponsePayloadMap = {
    getUIMemoSettings: Record<string, unknown> | null;
    setUIMemoSettings: boolean;
    getPersistLocalStorage: unknown;
    setPersistLocalStorage: boolean;
    removePersistLocalStorage: boolean;
    clearPersistLocalStorage: boolean;
    getAllPersistLocalStorage: Record<string, unknown>;
    getResumeCursors: Record<string, ResumeCursorRecord>;
    setResumeCursors: boolean;
    removeResumeCursors: boolean;
    downloadTextAsFile: { ok: boolean; method?: 'blob' | 'data'; id?: number; error?: string };
    downloadFileByUri: { ok: boolean; id?: number; error?: string };
};

export type BridgeRequest<A extends BridgeAction = BridgeAction> = {
    action: A;
    payload: BridgeRequestPayloadMap[A];
};

export type BridgeResponse<A extends BridgeAction = BridgeAction> = BridgeResponsePayloadMap[A];
