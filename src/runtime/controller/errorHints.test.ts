import { describe, expect, it } from 'bun:test';
import { shouldSuggestRecalibrationFromError } from '@/runtime/controller/errorHints';

describe('error hints', () => {
    it('should detect stale-calibration graphql retry errors', () => {
        const message =
            'GraphQL request failed after retries. endpoint=/api/graphql/ params=19 error=GraphQL request failed: 500 preview="<html lang=\\"en\\" id=\\"facebook\\">"';
        expect(shouldSuggestRecalibrationFromError(message)).toBe(true);
    });

    it('should ignore unrelated errors', () => {
        expect(shouldSuggestRecalibrationFromError('network disconnected')).toBe(false);
        expect(shouldSuggestRecalibrationFromError(null)).toBe(false);
    });
});
